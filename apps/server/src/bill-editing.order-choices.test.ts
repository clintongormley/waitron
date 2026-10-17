import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workingOrders, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writeEditSentLines } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import {
  saveDraft,
  readDrafts,
  type BillEditExpected,
  type BillEditState,
} from "./order-drafts.js";
import { recallToDraft } from "./draft-recall.js";
import { partyRevisionOfOrder } from "./parties.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  setWorkingOrderLabel,
  setOrderReceiptLanguage,
  setOrderInvoiceChoice,
  placeOrder,
  parkOrder,
} from "./working-order.js";
import { fireAll } from "./testing/serve-line.js";
import { inTx, provisionBillVenue, tabWith, send, type BillVenue } from "./testing/bill-venue.js";

let venue: BillVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});
const operations = ["label", "receipt-language", "invoice-choice", "place"] as const;
type Operation = (typeof operations)[number];
const edit = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));
async function fixture(counter = false) {
  const id = counter ? randomUUID() : await tabWith(venue, "Tarta");
  if (counter)
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      operatorId: venue.operatorId,
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    });
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  return order!;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function sibling(p: Fixture) {
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: p.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning();
    await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, order!.id, venue.zoneId);
    return order!;
  });
}
async function save(p: Fixture, operatorId = venue.operatorId) {
  const expectedEdit = await edit(p.id);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId!, operatorId, {
      billId: p.id,
      expectedEdit,
      draftId: expectedEdit.draftId,
      revision: expectedEdit.draftRevision ?? 0,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    }),
  );
}
function body(p: Fixture, op: Operation, expectedEdit: BillEditExpected | null | undefined) {
  return {
    expectedEdit,
    revision: p.revision,
    operatorId: venue.adminId,
    ...(op === "label"
      ? { label: "new label" }
      : op === "receipt-language"
        ? { language: "es-ES" }
        : op === "invoice-choice"
          ? { invoiceType: "F2" as const, recipient: null }
          : {}),
  };
}
function run(
  p: Fixture,
  op: Operation,
  expectedEdit: BillEditExpected | null,
  operatorId = venue.operatorId,
) {
  const authority = { operatorId, expectedEdit };
  switch (op) {
    case "label":
      return setWorkingOrderLabel(venue.db, p.id, {
        label: "new label",
        revision: p.revision,
        ...authority,
      });
    case "receipt-language":
      return setOrderReceiptLanguage(venue.db, venue.cfg, p.id, {
        revision: p.revision,
        language: "es-ES",
        ...authority,
      });
    case "invoice-choice":
      return setOrderInvoiceChoice(venue.db, venue.backend, venue.cfg, p.id, {
        revision: p.revision,
        invoiceType: "F2",
        recipient: null,
        ...authority,
      });
    case "place":
      return placeOrder(
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        p.id,
        operatorId,
        expectedEdit,
      );
  }
}
function frozen(http = false) {
  return Object.fromEntries(
    venue.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        venue.db
          .all<Record<string, unknown>>(sql`select * from ${sql.identifier(name)} order by rowid`)
          .map((row) => (http && name === "devices" ? { ...row, last_seen_at: null } : row)),
      ]),
  );
}
const stale = (e: BillEditState) => ({
  billId: e.billId,
  draftId: e.draftId,
  revision: e.draftRevision,
  edit: e,
});
const foreign = (e: BillEditState) => ({
  billId: e.billId,
  draftId: e.draftId,
  ownerId: e.editorId,
  ownerName: e.editorName,
  edit: e,
});
async function accepted(p: Fixture, op: Operation) {
  const [after] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.id));
  expect({
    label: after!.label,
    receipt: after!.receiptLocale,
    invoice: after!.invoiceType,
    status: after!.status,
    revision: after!.revision,
  }).toEqual({
    label: op === "label" ? "new label" : p.label,
    receipt: op === "receipt-language" ? "es-ES" : p.receiptLocale,
    invoice: op === "invoice-choice" ? "F2" : p.invoiceType,
    status: op === "place" ? "placed" : "open",
    revision: op === "place" ? p.revision : p.revision + 1,
  });
}
for (const op of operations)
  describe(`${op} checks bill editing authority`, () => {
    it("refuses a colleague before any order, kitchen, invoice or audit write", async () => {
      const p = await fixture(),
        owned = await save(p, venue.adminId),
        before = frozen();
      await expect(run(p, op, owned.edit)).rejects.toMatchObject({
        code: "draft.taken_over",
        params: foreign(owned.edit),
      });
      expect(frozen()).toEqual(before);
    });
    it("refuses an outdated same-person observation", async () => {
      const p = await fixture(),
        old = await edit(p.id),
        owned = await save(p),
        before = frozen();
      await expect(run(p, op, old)).rejects.toMatchObject({
        code: "draft.out_of_date",
        params: stale(owned.edit),
      });
      expect(frozen()).toEqual(before);
    });
    it.each(["absent", "other-bill"] as const)(
      "requires the %s observation to name this bill",
      async (kind) => {
        const p = await fixture(),
          other = await fixture(),
          before = frozen();
        await expect(
          run(p, op, kind === "absent" ? undefined! : await edit(other.id)),
        ).rejects.toMatchObject({
          code: "management.request_invalid",
          params: { field: kind === "absent" ? "expectedEdit" : "expectedEdit.billId" },
        });
        expect(frozen()).toEqual(before);
      },
    );
    it("allows the current editor and preserves both bills' saved outboxes", async () => {
      const p = await fixture(),
        other = await sibling(p);
      await save(p);
      await save(other, venue.adminId);
      const states = [await edit(p.id), await edit(other.id)];
      const drafts = await inTx(venue, async (tx) => [
        await readDrafts(tx, venue.cfg, p.partyId!),
        await readDrafts(tx, venue.cfg, other.partyId!),
      ]);
      await run(p, op, states[0]!);
      await accepted(p, op);
      expect([await edit(p.id), await edit(other.id)]).toEqual(states);
      expect(
        await inTx(venue, async (tx) => [
          await readDrafts(tx, venue.cfg, p.partyId!),
          await readDrafts(tx, venue.cfg, other.partyId!),
        ]),
      ).toEqual(drafts);
    });
    it("does not acquire an unowned bill", async () => {
      const p = await fixture(),
        before = await edit(p.id);
      await run(p, op, before);
      await accepted(p, op);
      expect(await edit(p.id)).toEqual(before);
    });
    it("keeps the counter path independent of bill editing", async () => {
      const p = await fixture(true);
      await run(p, op, null);
      await accepted(p, op);
      expect(await edit(p.id)).toEqual({
        billId: p.id,
        editorId: null,
        editorName: null,
        editorVersion: 0,
        draftId: null,
        draftRevision: null,
      });
    });
    it("uses the authenticated actor at the HTTP boundary", async () => {
      const p = await fixture(),
        owned = await save(p, venue.adminId),
        before = frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        op === "place" ? "POST" : "PUT",
        `/api/working-orders/${p.id}/${op}`,
        body(p, op, owned.edit),
      );
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "draft.taken_over", params: foreign(owned.edit) });
      expect(frozen(true)).toEqual(before);
    });
    it("forwards the observed state through HTTP", async () => {
      const p = await fixture(),
        owned = await save(p);
      const answer = await send(
        venue.app,
        venue.cookie,
        op === "place" ? "POST" : "PUT",
        `/api/working-orders/${p.id}/${op}`,
        body(p, op, owned.edit),
      );
      expect(answer.status).toBe(200);
      await accepted(p, op);
      expect(await edit(p.id)).toEqual(owned.edit);
    });
    it("refuses an old HTTP observation without writes", async () => {
      const p = await fixture(),
        old = await edit(p.id),
        owned = await save(p),
        before = frozen(true);
      const answer = await send(
        venue.app,
        venue.cookie,
        op === "place" ? "POST" : "PUT",
        `/api/working-orders/${p.id}/${op}`,
        body(p, op, old),
      );
      expect(answer.status).toBe(409);
      expect(answer.json).toMatchObject({ code: "draft.out_of_date", params: stale(owned.edit) });
      expect(frozen(true)).toEqual(before);
    });
  });

it("Place refuses a reserved recalled source before kitchen or status writes", async () => {
  const p = await fixture();
  await inTx(venue, async (tx) => {
    await writeEditSentLines(tx, true);
    await fireAll(tx, venue.cfg, p.id);
    const [line] = await tx
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.id));
    const party = await partyRevisionOfOrder(tx, p.id);
    await recallToDraft(tx, venue.cfg, p.partyId!, line!.id, {
      operatorId: venue.operatorId,
      expectedEdit: await readBillEditState(tx, p.id),
      expectedPartyRevision: party!.revision,
      submissionId: randomUUID(),
    });
  });
  const current = await edit(p.id),
    before = frozen();
  await expect(run(p, "place", current)).rejects.toMatchObject({
    code: "draft.out_of_date",
    params: stale(current),
  });
  expect(frozen()).toEqual(before);
});

it("Place keeps bodyless counter requests working", async () => {
  const p = await fixture(true);
  const answer = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${p.id}/place`);
  expect(answer.status).toBe(200);
  await accepted(p, "place");
});

it("Place requires the observed editor for a bodyless party request", async () => {
  const p = await fixture(),
    before = frozen(true);
  const answer = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${p.id}/place`);
  expect(answer.status).toBe(400);
  expect(answer.json).toMatchObject({
    code: "management.request_invalid",
    params: { field: "expectedEdit" },
  });
  expect(frozen(true)).toEqual(before);
});
