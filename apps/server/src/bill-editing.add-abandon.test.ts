import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { billPayments, workingOrderLines, workingOrders } from "@waitron/db";
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
import { addTabRound, abandonHeldOrder, parkOrder } from "./working-order.js";
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
const edit = (id: string) => inTx(venue, (tx) => readBillEditState(tx, id));
async function fixture(counter = false) {
  const id = counter ? randomUUID() : await tabWith(venue, "Tarta");
  if (counter)
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
    });
  const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, id));
  return order!;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function save(p: Fixture, operatorId = venue.operatorId) {
  const current = await edit(p.id);
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, p.partyId!, operatorId, {
      billId: p.id,
      expectedEdit: current,
      draftId: current.draftId,
      revision: current.draftRevision ?? 0,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    }),
  );
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
const operations = ["add", "abandon"] as const;
type Operation = (typeof operations)[number];
function run(
  p: Fixture,
  op: Operation,
  expectedEdit: BillEditExpected | null,
  operatorId: string | undefined = venue.operatorId,
) {
  const authority = { operatorId, expectedEdit };
  return op === "add"
    ? inTx(venue, (tx) =>
        addTabRound(
          tx,
          venue.cfg,
          p.id,
          [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
          authority,
        ),
      )
    : abandonHeldOrder({ db: venue.db }, venue.cfg, p.id, authority);
}

for (const op of operations)
  describe(`${op} requires observed bill authority`, () => {
    it("refuses another editor without line, status, kitchen or audit writes", async () => {
      const p = await fixture(),
        owned = await save(p, venue.adminId),
        before = frozen();
      await expect(run(p, op, owned.edit)).rejects.toMatchObject({
        code: "draft.taken_over",
        params: foreign(owned.edit),
      });
      expect(frozen()).toEqual(before);
    });
    it("refuses an outdated same-person observation before writes", async () => {
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
    it.each(["absent", "null", "wrong-bill", "malformed", "no-actor"] as const)(
      "requires the %s authority",
      async (kind) => {
        const p = await fixture(),
          other = await fixture(),
          before = frozen();
        const current = await edit(p.id);
        const wanted =
          kind === "absent"
            ? undefined
            : kind === "null"
              ? null
              : kind === "wrong-bill"
                ? await edit(other.id)
                : kind === "malformed"
                  ? { ...current, editorVersion: -1 }
                  : current;
        const authority = {
          operatorId: kind === "no-actor" ? undefined : venue.operatorId,
          expectedEdit: wanted,
        };
        const attempt =
          op === "add"
            ? inTx(venue, (tx) =>
                addTabRound(
                  tx,
                  venue.cfg,
                  p.id,
                  [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
                  authority as never,
                ),
              )
            : abandonHeldOrder({ db: venue.db }, venue.cfg, p.id, authority as never);
        await expect(attempt).rejects.toMatchObject({
          code: "management.request_invalid",
          params: {
            field:
              kind === "wrong-bill"
                ? "expectedEdit.billId"
                : kind === "malformed"
                  ? "expectedEdit.editorVersion"
                  : kind === "no-actor"
                    ? "operatorId"
                    : "expectedEdit",
          },
        });
        expect(frozen()).toEqual(before);
      },
    );
    it("accepts a current unowned observation without acquiring an editor", async () => {
      const p = await fixture(),
        before = await edit(p.id);
      await run(p, op, before);
      expect(await edit(p.id)).toEqual(before);
      const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.id));
      expect(order!.status).toBe(op === "add" ? "open" : "abandoned");
      const lines = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.id));
      expect(lines).toHaveLength(op === "add" ? 2 : 1);
      if (op === "add")
        expect(lines.find((line) => line.lineNo === 2)).toMatchObject({
          name: "Caña",
          quantity: 1000,
          unitPriceGross: 300,
        });
    });
  });

it("adding to the current editor's bill preserves both independently owned outboxes", async () => {
  const p = await fixture();
  const other = await inTx(venue, async (tx) => {
    const [bill] = await tx
      .insert(workingOrders)
      .values({
        source: "dashboard",
        orderNumber: 2,
        partyId: p.partyId,
        locationId: venue.cfg.locationId,
      })
      .returning();
    await VENUE_SERVICE.recordOrderContext(tx, venue.cfg, bill!.id, venue.zoneId);
    return bill!;
  });
  await save(p);
  await save(other, venue.adminId);
  const states = [await edit(p.id), await edit(other.id)];
  const drafts = await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId!));
  await run(p, "add", states[0]!);
  expect([await edit(p.id), await edit(other.id)]).toEqual(states);
  expect(await inTx(venue, (tx) => readDrafts(tx, venue.cfg, p.partyId!))).toEqual(drafts);
  const lines = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.id));
  expect(lines).toHaveLength(2);
});

it.each(operations)("%s retains the bill's pending-payment refusal", async (op) => {
  const p = await fixture();
  await inTx(venue, (tx) =>
    tx.insert(billPayments).values({
      workingOrderId: p.id,
      submissionId: randomUUID(),
      fingerprint: "pending-payment-fixture",
      kind: "contribution",
      method: "card",
      applied: 100,
      state: "pending",
      requestedBy: venue.operatorId,
      source: "device",
      deviceId: venue.deviceId,
    }),
  );
  const current = await edit(p.id),
    before = frozen();
  await expect(run(p, op, current)).rejects.toMatchObject({ code: "order.payment_in_flight" });
  expect(frozen()).toEqual(before);
});

it("abandon refuses its editor's fresh outbox rather than stranding it on an abandoned bill", async () => {
  const p = await fixture(),
    owned = await save(p),
    before = frozen();
  await expect(run(p, "abandon", owned.edit)).rejects.toMatchObject({
    code: "bill.unsent_dishes",
    params: { billId: p.id },
  });
  expect(frozen()).toEqual(before);
});

it("abandon refuses a reserved recalled family with the current draft facts", async () => {
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
  await expect(run(p, "abandon", current)).rejects.toMatchObject({
    code: "draft.out_of_date",
    params: stale(current),
  });
  expect(frozen()).toEqual(before);
});

describe("DELETE held order checks the session's editor", () => {
  it("refuses a body actor spoof before any abandonment", async () => {
    const p = await fixture(),
      owned = await save(p, venue.adminId),
      before = frozen(true);
    const answer = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${p.id}`, {
      operatorId: venue.adminId,
      expectedEdit: owned.edit,
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "draft.taken_over", params: foreign(owned.edit) });
    expect(frozen(true)).toEqual(before);
  });
  it("refuses the same person's stale observation", async () => {
    const p = await fixture(),
      old = await edit(p.id),
      owned = await save(p),
      before = frozen(true);
    const answer = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${p.id}`, {
      expectedEdit: old,
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "draft.out_of_date", params: stale(owned.edit) });
    expect(frozen(true)).toEqual(before);
  });
  it("requires an expectation on bodyless party requests", async () => {
    const p = await fixture(),
      before = frozen(true);
    const answer = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${p.id}`);
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "expectedEdit" },
    });
    expect(frozen(true)).toEqual(before);
  });
  it("accepts a current unowned party request and acquires nothing", async () => {
    const p = await fixture(),
      current = await edit(p.id);
    const answer = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${p.id}`, {
      expectedEdit: current,
    });
    expect(answer.status).toBe(200);
    expect(await edit(p.id)).toEqual(current);
    const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.id));
    expect(order!.status).toBe("abandoned");
  });
  it("keeps bodyless counter abandonment independent of bill editing", async () => {
    const p = await fixture(true);
    const answer = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${p.id}`);
    expect(answer.status).toBe(200);
    const [order] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.id));
    expect(order!.status).toBe("abandoned");
  });
  it("preserves the current editor's unsent work on refusal", async () => {
    const p = await fixture(),
      owned = await save(p),
      before = frozen(true);
    const answer = await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${p.id}`, {
      expectedEdit: owned.edit,
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({ code: "bill.unsent_dishes", params: { billId: p.id } });
    expect(frozen(true)).toEqual(before);
  });
});
