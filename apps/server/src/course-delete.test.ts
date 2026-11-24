import { addTabRound } from "./testing/order-writer-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenCourses,
  departmentCourses,
  floorZones,
  menuItems,
  products,
  orderDraftLines,
  workingOrderLines,
  ticketItems,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { deleteCourse, readCourseDeleteImpact } from "./course-delete.js";
import { createCourse, listCourses, requireCourse, updateCourse } from "./kitchen.js";
import {
  inTx,
  setupPartyVenue,
  seatWithNoAllergies as seat,
  OPERATOR,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("permanent course deletion", () => {
  it("deleting a course clears and counts its set-menu line choices and dish overrides", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id: starter } = await inTx(v, (tx) => createCourse(tx, { name: "Starters" }));
    const { id: main } = await inTx(v, (tx) => createCourse(tx, { name: "Mains" }));
    const productId = v.productId("Flan");
    await inTx(v, async (tx) => {
      await tx.execute(sql`
        insert into menus (id, name, kind, set_price, set_vat_class, created_at, updated_at)
        values ('lunch', 'Lunch', 'set_menu', 1400, 'reduced',
                '2026-11-18T12:00:00Z', '2026-11-18T12:00:00Z')
      `);
      await tx.update(products).set({ courseId: main }).where(eq(products.id, productId));
      await tx.insert(menuItems).values({ id: "offer", menuId: "lunch", productId });
      await tx.execute(sql`
        insert into set_menu_lines (id, menu_id, position, count)
        values ('first', 'lunch', 0, 1), ('second', 'lunch', 1, 1)
      `);
      await tx.execute(sql`
        insert into set_menu_line_courses (line_id, course_id)
        values ('first', ${starter}), ('second', ${starter}), ('second', ${main})
      `);
      await tx.execute(sql`
        insert into set_menu_dish_courses (menu_item_id, course_id) values ('offer', ${starter})
      `);
      await tx.execute(sql`
        insert into menus (id, name, kind, set_price, set_vat_class, active, created_at, updated_at)
        values ('winter', 'Winter', 'set_menu', 1400, 'reduced', 0,
                '2026-11-18T12:00:00Z', '2026-11-18T12:00:00Z')
      `);
      await tx.insert(menuItems).values({ id: "winter-offer", menuId: "winter", productId });
      await tx.execute(sql`
        insert into set_menu_lines (id, menu_id, position, count)
        values ('winter-line', 'winter', 0, 1)
      `);
      await tx.execute(sql`
        insert into set_menu_line_courses (line_id, course_id) values ('winter-line', ${starter})
      `);
      await tx.execute(sql`
        insert into set_menu_dish_courses (menu_item_id, course_id) values ('winter-offer', ${starter})
      `);
    });
    const removes = [
      { key: "course_set_menu_lines", count: 2, targets: [] },
      { key: "course_set_menu_dishes", count: 1, targets: [] },
    ];
    expect((await inTx(v, (tx) => readCourseDeleteImpact(tx, starter))).removes).toEqual(removes);
    expect((await inTx(v, (tx) => deleteCourse(tx, starter))).removes).toEqual(removes);
    expect(
      (
        await v.db.execute(
          sql`select id from set_menu_lines where menu_id = 'lunch' order by position`,
        )
      ).rows,
    ).toEqual([{ id: "first" }, { id: "second" }]);
    expect(
      (await v.db.execute(sql`select line_id, course_id from set_menu_line_courses`)).rows,
    ).toEqual([{ line_id: "second", course_id: main }]);
    const { rows } = await v.db.execute(sql`
      select coalesce(set_menu_dish_courses.course_id, products.course_id) as course_id
      from menu_items join products on products.id = menu_items.product_id
      left join set_menu_dish_courses on set_menu_dish_courses.menu_item_id = menu_items.id
      where menu_items.id = 'offer'
    `);
    expect(rows).toEqual([{ course_id: main }]);
  });

  it("deleting a product-default course clears all defaults and retains its row", async () => {
    const v = await setupPartyVenue(suite.db);
    const initialCourses = await inTx(v, (tx) => listCourses(tx));
    const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Desserts" }));
    const parentId = v.productId("Flan");
    const variantId = randomUUID();
    await inTx(v, async (tx) => {
      await tx.update(products).set({ courseId: id }).where(eq(products.id, parentId));
      await tx.insert(products).values({
        id: variantId,
        parentId,
        name: "Small",
        courseId: id,
      });
      await tx
        .update(products)
        .set({ courseId: id, active: false })
        .where(eq(products.id, v.productId("Tarta")));
    });
    const [zone] = await v.db.select().from(floorZones).where(eq(floorZones.id, v.tables.zoneId));
    await v.db
      .insert(departmentCourses)
      .values({ departmentId: zone!.departmentId, courseId: id, reminderMinutes: null });
    const before = await inTx(v, (tx) => tx.select().from(products).orderBy(products.id));
    const courseBefore = await inTx(v, (tx) =>
      tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id)),
    );
    const impact = {
      target: { id, name: "Desserts" },
      refusals: [],
      ends: [],
      removes: [{ key: "course_products", count: 3, targets: [] }],
    };
    expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, id))).toEqual(impact);
    expect(await inTx(v, (tx) => tx.select().from(products).orderBy(products.id))).toEqual(before);
    expect(await inTx(v, (tx) => deleteCourse(tx, id))).toEqual(impact);
    expect(await inTx(v, (tx) => tx.select().from(products).orderBy(products.id))).toEqual(
      before.map((row) => (row.courseId === id ? { ...row, courseId: null } : row)),
    );
    expect(
      await inTx(v, (tx) => tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id))),
    ).toEqual(courseBefore.map((row) => ({ ...row, active: false })));
    expect(
      await v.db.select().from(departmentCourses).where(eq(departmentCourses.courseId, id)),
    ).toEqual([]);
    await inTx(v, (tx) => requireCourse(tx, id));
    for (const action of [
      () => inTx(v, (tx) => deleteCourse(tx, id)),
      () => inTx(v, (tx) => readCourseDeleteImpact(tx, id)),
      ...[{}, { name: "Changed" }, { displayOrder: 9 }].map(
        (patch) => () => inTx(v, (tx) => updateCourse(tx, id, patch)),
      ),
    ]) {
      await expect(action()).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: id },
      });
    }
    expect(await inTx(v, (tx) => listCourses(tx))).toEqual(initialCourses);
  });

  it.each(["product", "draft", "order", "ticket"] as const)(
    "retains a course referenced only by %s without rewriting recorded rows",
    async (reference) => {
      const v = await setupPartyVenue(suite.db);
      const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Retained" }));
      const table =
        reference === "product"
          ? products
          : reference === "draft"
            ? orderDraftLines
            : reference === "order"
              ? workingOrderLines
              : ticketItems;
      if (reference === "product") {
        await inTx(v, (tx) =>
          tx
            .update(products)
            .set({ courseId: id })
            .where(eq(products.id, v.productId("Flan"))),
        );
      } else {
        const { partyId, tabId } = await seat(v, await v.table("Reference"));
        if (reference === "draft") {
          await inTx(v, (tx) =>
            saveDraft(tx, partyId, OPERATOR, {
              billId: tabId,
              draftId: null,
              revision: 0,
              lines: [
                {
                  menuItemId: v.item("Flan"),
                  variantId: null,
                  menuVersionId: null,
                  options: [],
                  extras: [],
                  note: null,
                  quantity: "1",
                  courseId: id,
                  noMerge: false,
                },
              ],
            }),
          );
        } else {
          await inTx(v, (tx) =>
            addTabRound(tx, v.cfg, tabId, [
              { menuItemId: v.item("Flan"), quantity: "1", courseId: id },
            ]),
          );
          await inTx(v, (tx) =>
            reference === "order"
              ? tx
                  .update(ticketItems)
                  .set({ courseId: null })
                  .where(
                    inArray(
                      ticketItems.workingOrderLineId,
                      sql`(select id from working_order_lines where working_order_id = ${tabId})`,
                    ),
                  )
              : tx
                  .update(workingOrderLines)
                  .set({ courseId: null })
                  .where(eq(workingOrderLines.workingOrderId, tabId)),
          );
        }
      }
      const before = await inTx(v, async (tx) =>
        tx.execute(sql`select * from ${table} where course_id = ${id}`),
      );
      expect(before.rows).toHaveLength(1);
      expect(await inTx(v, (tx) => deleteCourse(tx, id))).toEqual({
        target: { id, name: "Retained" },
        refusals: [],
        ends: [],
        removes: reference === "product" ? [{ key: "course_products", count: 1, targets: [] }] : [],
      });
      expect(
        await inTx(v, (tx) =>
          tx
            .select({ id: kitchenCourses.id, active: kitchenCourses.active })
            .from(kitchenCourses)
            .where(eq(kitchenCourses.id, id)),
        ),
      ).toEqual([{ id, active: false }]);
      if (reference !== "product")
        expect(
          (
            await inTx(v, async (tx) =>
              tx.execute(sql`select * from ${table} where course_id = ${id}`),
            )
          ).rows,
        ).toEqual(before.rows);
    },
  );

  it("unreferenced course is physically removed and omits zero impact", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Unused" }));
    const expected = { target: { id, name: "Unused" }, refusals: [], ends: [], removes: [] };
    expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, id))).toEqual(expected);
    expect(await inTx(v, (tx) => deleteCourse(tx, id))).toEqual(expected);
    expect(
      await inTx(v, (tx) => tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id))),
    ).toEqual([]);
    await expect(inTx(v, (tx) => deleteCourse(tx, id))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: id },
    });
  });

  it("recomputes product cleanup after the preview", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Latest" }));
    expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, id))).toEqual({
      target: { id, name: "Latest" },
      refusals: [],
      ends: [],
      removes: [],
    });
    await inTx(v, (tx) =>
      tx
        .update(products)
        .set({ courseId: id })
        .where(eq(products.id, v.productId("Flan"))),
    );
    expect(await inTx(v, (tx) => deleteCourse(tx, id))).toEqual({
      target: { id, name: "Latest" },
      refusals: [],
      ends: [],
      removes: [{ key: "course_products", count: 1, targets: [] }],
    });
    expect(
      await inTx(v, (tx) =>
        tx
          .select({ courseId: products.courseId })
          .from(products)
          .where(eq(products.id, v.productId("Flan"))),
      ),
    ).toEqual([{ courseId: null }]);
  });

  it.each([true, false, null, undefined, "true", 0])(
    "rejects an own active patch key with value %s",
    async (active) => {
      const v = await setupPartyVenue(suite.db);
      const initialCourses = await inTx(v, (tx) => listCourses(tx));
      const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Live" }));
      await expect(
        inTx(v, (tx) => updateCourse(tx, id, { active, name: "Changed" } as never)),
      ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "active" } });
      expect(await inTx(v, (tx) => listCourses(tx))).toEqual([
        { id, name: "Live", displayOrder: 0, active: true, fireNowZoneIds: [] },
        ...initialCourses,
      ]);
    },
  );

  it("refuses unknown impact/delete/empty edits without changing rows", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Scoped" }));
    await inTx(v, (tx) =>
      tx
        .update(products)
        .set({ courseId: id })
        .where(eq(products.id, v.productId("Flan"))),
    );
    const beforeProducts = await inTx(v, (tx) => tx.select().from(products).orderBy(products.id));
    const beforeCourses = await inTx(v, (tx) =>
      tx.select().from(kitchenCourses).orderBy(kitchenCourses.id),
    );
    for (const target of [randomUUID()]) {
      for (const action of [readCourseDeleteImpact, deleteCourse])
        await expect(inTx(v, (tx) => action(tx, target))).rejects.toMatchObject({
          code: "course.not_found",
          params: { courseId: target },
        });
      await expect(inTx(v, (tx) => updateCourse(tx, target, {}))).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: target },
      });
    }
    expect(await inTx(v, (tx) => tx.select().from(products).orderBy(products.id))).toEqual(
      beforeProducts,
    );
    expect(
      await inTx(v, (tx) => tx.select().from(kitchenCourses).orderBy(kitchenCourses.id)),
    ).toEqual(beforeCourses);
  });

  it("creates and renames to deleted names while refusing duplicate live names", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, { name: "Reusable" }));
    await inTx(v, (tx) =>
      tx
        .update(products)
        .set({ courseId: id })
        .where(eq(products.id, v.productId("Flan"))),
    );
    await inTx(v, (tx) => deleteCourse(tx, id));
    const replacement = await inTx(v, (tx) => createCourse(tx, { name: "Reusable" }));
    expect(replacement.id).not.toBe(id);
    await inTx(v, (tx) => updateCourse(tx, replacement.id, { name: "Other" }));
    const renamed = await inTx(v, (tx) => createCourse(tx, { name: "Rename me" }));
    await inTx(v, (tx) => updateCourse(tx, renamed.id, { name: "Reusable" }));
    await expect(inTx(v, (tx) => createCourse(tx, { name: "Reusable" }))).rejects.toMatchObject({
      code: "course.name_taken",
      params: { name: "Reusable" },
    });
    await expect(
      inTx(v, (tx) => updateCourse(tx, replacement.id, { name: "Reusable" })),
    ).rejects.toMatchObject({ code: "course.name_taken", params: { name: "Reusable" } });
  });
});
