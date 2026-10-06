import { randomUUID } from "node:crypto";
import { eq, getTableName, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  locations,
  orderDraftLines,
  products,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { referenceQuery } from "./in-use.js";
import {
  COURSE_REFERENCES,
  coursesInUse,
  createCourse,
  listCourses,
  removeCourse,
  setProductCourse,
  updateCourse,
} from "./kitchen.js";
import { saveDraft } from "./order-drafts.js";
import { inTx, OPERATOR, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { addTabRound } from "./working-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function course(v: PartyVenue, name = "Postres"): Promise<string> {
  return (await inTx(v, (tx) => createCourse(tx, v.cfg, { name, displayOrder: 3 }))).id;
}

async function courseRow(v: PartyVenue, id: string) {
  return inTx(v, (tx) => tx.select().from(kitchenCourses).where(eq(kitchenCourses.id, id)));
}

/** A round on a fresh table whose one dish names `courseId` on its line and its kitchen record. */
async function orderedWith(v: PartyVenue, courseId: string): Promise<string> {
  const { tabId } = await seat(v, await v.table(`Mesa ${randomUUID().slice(0, 8)}`));
  await inTx(v, (tx) =>
    addTabRound(tx, v.cfg, tabId, [{ menuItemId: v.item("Flan"), quantity: "1", courseId }]),
  );
  return tabId;
}

describe("removing a course", () => {
  it("deletes a course nothing refers to", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    expect(await inTx(v, (tx) => coursesInUse(tx, [id]))).toEqual(new Set());
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toEqual([]);
  });

  it("disables a course a product names as its default, keeping the row", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    await inTx(v, (tx) => setProductCourse(tx, v.cfg, v.productId("Flan"), id));
    expect(await inTx(v, (tx) => coursesInUse(tx, [id]))).toEqual(new Set([id]));
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toMatchObject([{ id, name: "Postres", active: false }]);
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toMatchObject([{ id, active: false }]);
  });

  it("disables a course only an order's line names", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    const tabId = await orderedWith(v, id);
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ courseId: null }).where(eq(ticketItems.workingOrderId, tabId)),
    );
    expect(
      await inTx(v, (tx) =>
        tx
          .select({ courseId: workingOrderLines.courseId })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, tabId)),
      ),
    ).toEqual([{ courseId: id }]);
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toMatchObject([{ id, active: false }]);
  });

  it("disables a course only a kitchen record names", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    const tabId = await orderedWith(v, id);
    await inTx(v, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ courseId: null })
        .where(eq(workingOrderLines.workingOrderId, tabId)),
    );
    expect(
      await inTx(v, (tx) =>
        tx
          .select({ courseId: ticketItems.courseId })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, tabId)),
      ),
    ).toEqual([{ courseId: id }]);
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toMatchObject([{ id, active: false }]);
  });

  it("disables a course only an unsent draft's line names", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    const { partyId } = await seat(v, await v.table("Borrador"));
    const draft = await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, partyId, OPERATOR, {
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
    expect(
      await inTx(v, (tx) =>
        tx
          .select({ courseId: orderDraftLines.courseId })
          .from(orderDraftLines)
          .where(eq(orderDraftLines.draftId, draft.id)),
      ),
    ).toEqual([{ courseId: id }]);
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toMatchObject([{ id, active: false }]);
  });

  it("only disables a course nothing refers to when the request asks to disable it", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    expect(await inTx(v, (tx) => coursesInUse(tx, [id]))).toEqual(new Set());
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id, true));
    expect(await courseRow(v, id)).toMatchObject([{ id, name: "Postres", active: false }]);
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id, true));
    expect(await courseRow(v, id)).toMatchObject([{ id, active: false }]);
  });

  it("stops reading references once every course asked about is found, counting a repeated id once", async () => {
    const v = await setupPartyVenue(suite.db);
    const used = await course(v, "Used");
    const free = await course(v, "Free");
    await inTx(v, (tx) => setProductCourse(tx, v.cfg, v.productId("Flan"), used));
    const queries = (ids: string[]) =>
      inTx(v, async (tx) => {
        const spy = vi.spyOn(tx, "selectDistinct");
        try {
          return { found: await coursesInUse(tx, ids), queries: spy.mock.calls.length };
        } finally {
          spy.mockRestore();
        }
      });
    expect(await queries([used, used])).toEqual({ found: new Set([used]), queries: 1 });
    expect(await queries([used, free])).toEqual({
      found: new Set([used]),
      queries: COURSE_REFERENCES.length,
    });
  });

  it("finds each of a course's references through an index rather than a scan", async () => {
    for (const reference of COURSE_REFERENCES) {
      const table = getTableName(reference.table);
      const plan = await withTransaction(suite.db, (tx) =>
        tx.execute<{ detail: string }>(
          sql`explain query plan ${referenceQuery(tx, reference, [randomUUID(), randomUUID()]).getSQL()}`,
        ),
      );
      const details = plan.rows.map((row) => row.detail).join("\n");
      expect(details, table).toMatch(
        new RegExp(
          `SEARCH ${table} USING (COVERING )?INDEX \\S+ \\(${reference.column.name}=\\?\\)`,
        ),
      );
      expect(details, table).not.toMatch(new RegExp(`SCAN ${table}\\b`));
    }
  });

  it("deletes a disabled course once nothing refers to it any more", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    await inTx(v, (tx) => setProductCourse(tx, v.cfg, v.productId("Flan"), id));
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    await inTx(v, (tx) =>
      tx.update(products).set({ courseId: null }).where(eq(products.courseId, id)),
    );
    await inTx(v, (tx) => removeCourse(tx, v.cfg, id));
    expect(await courseRow(v, id)).toEqual([]);
  });

  it("refuses an unknown or another venue's course with course.not_found, changing nothing", async () => {
    const v = await setupPartyVenue(suite.db);
    const id = await course(v);
    const missing = randomUUID();
    await expect(inTx(v, (tx) => removeCourse(tx, v.cfg, missing))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: missing },
    });
    const otherLocation = await inTx(v, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({ name: "Elsewhere", invoiceLocales: ["es-ES"], operationDescription: "Bar" })
        .returning({ id: locations.id });
      return location!.id;
    });
    const foreignCfg = { ...v.cfg, locationId: otherLocation as typeof v.cfg.locationId };
    await expect(inTx(v, (tx) => removeCourse(tx, foreignCfg, id))).rejects.toMatchObject({
      code: "course.not_found",
      params: { courseId: id },
    });
    expect(await courseRow(v, id)).toMatchObject([{ id, active: true }]);
  });

  it("reads which of many courses are in use in one call, and lists disabled ones only when asked", async () => {
    const v = await setupPartyVenue(suite.db);
    const used = await course(v, "Used");
    const free = await course(v, "Free");
    await inTx(v, (tx) => setProductCourse(tx, v.cfg, v.productId("Flan"), used));
    expect(await inTx(v, (tx) => coursesInUse(tx, [used, free]))).toEqual(new Set([used]));
    expect(await inTx(v, (tx) => coursesInUse(tx, []))).toEqual(new Set());
    await inTx(v, (tx) => removeCourse(tx, v.cfg, used));
    expect((await inTx(v, (tx) => listCourses(tx, v.cfg))).map((c) => c.id)).toEqual([free]);
    expect(
      (await inTx(v, (tx) => listCourses(tx, v.cfg, true))).map((c) => [c.id, c.active]),
    ).toEqual([
      [free, true],
      [used, false],
    ]);
    await inTx(v, (tx) => updateCourse(tx, v.cfg, used, { active: true }));
    expect((await inTx(v, (tx) => listCourses(tx, v.cfg))).map((c) => c.id)).toEqual([free, used]);
  });
});
