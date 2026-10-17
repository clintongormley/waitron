import { addTabRound } from "./testing/order-writer-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  kitchenCourses,
  locations,
  products,
  orderDraftLines,
  workingOrderLines,
  ticketItems,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { deleteCourse, readCourseDeleteImpact } from "./course-delete.js";
import { createCourse, listCourses, requireCourse, updateCourse } from "./kitchen.js";
import { inTx, setupPartyVenue, seat, OPERATOR } from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

describe("permanent course deletion", () => {
  it("deleting a product-default course clears all defaults and retains its row", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Postres" }));
    const parentId = v.productId("Flan");
    const [parent] = await inTx(v, (tx) =>
      tx.select().from(products).where(eq(products.id, parentId)),
    );
    const variantId = randomUUID();
    await inTx(v, async (tx) => {
      await tx.update(products).set({ courseId: id }).where(eq(products.id, parentId));
      await tx.insert(products).values({
        id: variantId,
        catalogueId: parent!.catalogueId,
        parentId,
        name: "Small",
        courseId: id,
      });
      await tx
        .update(products)
        .set({ courseId: id, active: false })
        .where(eq(products.id, v.productId("Tarta")));
    });
    const before = await inTx(v, (tx) => tx.select().from(products).orderBy(products.id));
    const courseBefore = await inTx(v, (tx) =>
      tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id)),
    );
    const impact = {
      target: { id, name: "Postres" },
      refusals: [],
      ends: [],
      removes: [{ key: "course_products", count: 3, targets: [] }],
    };
    expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, v.cfg, id))).toEqual(impact);
    expect(await inTx(v, (tx) => tx.select().from(products).orderBy(products.id))).toEqual(before);
    expect(await inTx(v, (tx) => deleteCourse(tx, v.cfg, id))).toEqual(impact);
    expect(await inTx(v, (tx) => tx.select().from(products).orderBy(products.id))).toEqual(
      before.map((row) => (row.courseId === id ? { ...row, courseId: null } : row)),
    );
    expect(
      await inTx(v, (tx) => tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id))),
    ).toEqual(courseBefore.map((row) => ({ ...row, active: false })));
    await inTx(v, (tx) => requireCourse(tx, v.cfg, id));
    for (const action of [
      () => inTx(v, (tx) => deleteCourse(tx, v.cfg, id)),
      () => inTx(v, (tx) => readCourseDeleteImpact(tx, v.cfg, id)),
      ...[{}, { name: "Changed" }, { displayOrder: 9 }].map(
        (patch) => () => inTx(v, (tx) => updateCourse(tx, v.cfg, id, patch)),
      ),
    ]) {
      await expect(action()).rejects.toMatchObject({
        code: "course.not_found",
        params: { courseId: id },
      });
    }
    expect(await inTx(v, (tx) => listCourses(tx, v.cfg))).toEqual([]);
  });

  it.each(["product", "draft", "order", "ticket"] as const)(
    "retains a course referenced only by %s without rewriting recorded rows",
    async (reference) => {
      const v = await setupPartyVenue(suite.db);
      const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Retained" }));
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
            saveDraft(tx, v.cfg, partyId, OPERATOR, {
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
                  .where(eq(ticketItems.workingOrderId, tabId))
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
      expect(await inTx(v, (tx) => deleteCourse(tx, v.cfg, id))).toEqual({
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
    const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Unused" }));
    const expected = { target: { id, name: "Unused" }, refusals: [], ends: [], removes: [] };
    expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, v.cfg, id))).toEqual(expected);
    expect(await inTx(v, (tx) => deleteCourse(tx, v.cfg, id))).toEqual(expected);
    expect(
      await inTx(v, (tx) => tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id))),
    ).toEqual([]);
    await expect(inTx(v, (tx) => deleteCourse(tx, v.cfg, id))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: id },
    });
  });

  it("recomputes product cleanup after the preview", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Latest" }));
    expect(await inTx(v, (tx) => readCourseDeleteImpact(tx, v.cfg, id))).toEqual({
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
    expect(await inTx(v, (tx) => deleteCourse(tx, v.cfg, id))).toEqual({
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
      const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Live" }));
      await expect(
        inTx(v, (tx) => updateCourse(tx, v.cfg, id, { active, name: "Changed" } as never)),
      ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "active" } });
      expect(await inTx(v, (tx) => listCourses(tx, v.cfg))).toEqual([
        { id, name: "Live", displayOrder: 0, active: true, heldUntilFired: true },
      ]);
    },
  );

  it("refuses unknown and wrong-location impact/delete/empty edits without changing rows", async () => {
    const v = await setupPartyVenue(suite.db);
    const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Scoped" }));
    await inTx(v, (tx) =>
      tx
        .update(products)
        .set({ courseId: id })
        .where(eq(products.id, v.productId("Flan"))),
    );
    const [other] = await inTx(v, (tx) =>
      tx
        .insert(locations)
        .values({ name: "Other", invoiceLocales: ["es-ES"], operationDescription: "Bar" })
        .returning({ id: locations.id }),
    );
    const beforeProducts = await inTx(v, (tx) => tx.select().from(products).orderBy(products.id));
    const beforeCourses = await inTx(v, (tx) =>
      tx.select().from(kitchenCourses).orderBy(kitchenCourses.id),
    );
    for (const [cfg, target] of [
      [v.cfg, randomUUID()],
      [{ ...v.cfg, locationId: other!.id as typeof v.cfg.locationId }, id],
    ] as const) {
      for (const action of [readCourseDeleteImpact, deleteCourse])
        await expect(inTx(v, (tx) => action(tx, cfg, target))).rejects.toMatchObject({
          code: "course.not_found",
          params: { courseId: target },
        });
      await expect(inTx(v, (tx) => updateCourse(tx, cfg, target, {}))).rejects.toMatchObject({
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
    const { id } = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Reusable" }));
    await inTx(v, (tx) =>
      tx
        .update(products)
        .set({ courseId: id })
        .where(eq(products.id, v.productId("Flan"))),
    );
    await inTx(v, (tx) => deleteCourse(tx, v.cfg, id));
    const replacement = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Reusable" }));
    expect(replacement.id).not.toBe(id);
    await inTx(v, (tx) => updateCourse(tx, v.cfg, replacement.id, { name: "Other" }));
    const renamed = await inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Rename me" }));
    await inTx(v, (tx) => updateCourse(tx, v.cfg, renamed.id, { name: "Reusable" }));
    await expect(
      inTx(v, (tx) => createCourse(tx, v.cfg, { name: "Reusable" })),
    ).rejects.toMatchObject({ code: "course.name_taken", params: { name: "Reusable" } });
    await expect(
      inTx(v, (tx) => updateCourse(tx, v.cfg, replacement.id, { name: "Reusable" })),
    ).rejects.toMatchObject({ code: "course.name_taken", params: { name: "Reusable" } });
  });
});
