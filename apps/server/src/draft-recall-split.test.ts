import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  billPayments,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { adjustments } from "@waitron/adjustments";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readPartyAllergy, savePartyAllergy, setAllergyLineTicks } from "@waitron/venue-service";
import type { Draft } from "./order-drafts.js";
import { send } from "./testing/bill-venue.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

function call(method: string, path: string, body?: unknown, cookie = venue.cookie.staff) {
  return send(venue.app, cookie, method, path, body);
}
async function revision(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return party!.revision;
}
async function readDraft(partyId: string, draftId: string) {
  const answer = await call("GET", `/api/parties/${partyId}/drafts`);
  expect(answer.status).toBe(200);
  return (answer.json as unknown as { drafts: Draft[] }).drafts.find((d) => d.id === draftId)!;
}
async function setup(
  release: "hold" | "fire" = "hold",
  dish = "Pizza",
  quantity = "3",
  paidQuantity?: string,
) {
  const p = await billWith(
    venue,
    [{ name: dish, quantity, ...(dish === "Pizza" ? { olives: 2 } : {}) }, { name: "Water" }],
    { release },
  );
  const [line] = await rowsOf(venue, p.billId);
  if (paidQuantity !== undefined) {
    const paid = await call("POST", `/api/working-orders/${p.billId}/payments`, {
      submissionId: randomUUID(),
      kind: "items",
      lines: [{ lineNo: line!.lineNo, quantity: paidQuantity }],
      method: "cash",
      tendered: "24.00",
      applied: "24.00",
      tip: "0.00",
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
  }
  const answer = await call("POST", `/api/parties/${p.partyId}/lines/${line!.id}/recall`, {
    submissionId: randomUUID(),
    expectedPartyRevision: await revision(p.partyId),
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return { ...p, line: line!, draft: (answer.json as unknown as { draft: Draft }).draft };
}
async function split(partyId: string, lineId: string, cookie = venue.cookie.staff) {
  const body = {
    submissionId: randomUUID(),
    expectedPartyRevision: await revision(partyId),
    lineId,
  };
  const path = `/api/parties/${partyId}/groups/split-line`;
  return { body, path, answer: await call("POST", path, body, cookie) };
}
async function frozen() {
  return {
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    parties: await venue.db.select().from(parties).orderBy(parties.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
    items: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    payments: await venue.db.select().from(billPayments).orderBy(billPayments.id),
  };
}

describe("splitting a recalled dish through the public group command", () => {
  it.each(["hold", "fire"] as const)(
    "splits a %s source and its discounted extras without another charge",
    async (release) => {
      const p = await setup(release);
      const [bill] = await venue.db
        .select()
        .from(workingOrders)
        .where(eq(workingOrders.id, p.billId));
      const discount = await call("POST", `/api/working-orders/${p.billId}/adjustments`, {
        submissionId: randomUUID(),
        expectedRevision: bill!.revision,
        action: "discount_percent",
        percentBp: 1000,
        lineId: p.line.id,
        reasonId: venue.reasonId.house,
        note: null,
      });
      expect(discount.status, JSON.stringify(discount.json)).toBe(200);
      const draft = await readDraft(p.partyId, p.draft.id);
      const before = await frozen();
      const { answer, body, path } = await split(p.partyId, p.line.id);
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect(answer.json).toEqual({ revision: body.expectedPartyRevision + 1 });
      const after = await frozen();
      const read = await readDraft(p.partyId, p.draft.id);
      expect(read.revision).toBe(draft.revision + 1);
      expect(read.lines).toHaveLength(3);
      expect(read.lines[0]!.id).toBe(draft.lines[0]!.id);
      expect(read.lines[0]!.sourceLineId).toBe(p.line.id);
      expect(new Set(read.lines.map((row) => row.sourceLineId)).size).toBe(3);
      for (const row of read.lines) {
        expect(row).toMatchObject({
          quantity: "1.000",
          slot: draft.lines[0]!.slot,
          joinGroupId: draft.lines[0]!.joinGroupId,
          afterGroupId: draft.lines[0]!.afterGroupId,
          source: {
            netAmount: "10.80",
            line: { unitPriceGross: "8.10", listUnitPriceGross: "9.00" },
            extras: [{ quantity: "2.000", unitPriceGross: "1.35", listUnitPriceGross: "1.50" }],
          },
        });
      }
      expect(
        after.lines
          .filter((row) => row.workingOrderId === p.billId)
          .reduce((sum, row) => sum + row.lineTotal, 0),
      ).toBe(3440);
      expect(after.adjustments).toEqual(before.adjustments);
      expect(after.items).toEqual(before.items);
      expect(after.jobs).toEqual(before.jobs);
      const sent = await call("GET", `/api/parties/${p.partyId}/groups?billId=${p.billId}`);
      for (const row of read.lines)
        expect(JSON.stringify(sent.json)).not.toContain(row.sourceLineId);
      const stable = await frozen();
      expect((await call("POST", path, body)).json).toEqual(answer.json);
      expect(await frozen()).toEqual(stable);
    },
  );

  it("refuses another owner and permits the new owner after takeover", async () => {
    const p = await setup("hold", "Burger");
    const takeover = await call(
      "POST",
      `/api/parties/${p.partyId}/drafts/${p.draft.id}/take-over`,
      { revision: p.draft.revision },
      venue.cookie.manager,
    );
    expect(takeover.status).toBe(200);
    const before = await frozen();
    const refused = await split(p.partyId, p.line.id);
    expect(refused.answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { draftId: p.draft.id, ownerId: venue.managerId },
    });
    expect(await frozen()).toEqual(before);
    const answer = await split(p.partyId, p.line.id, venue.cookie.manager);
    expect(answer.answer.status, JSON.stringify(answer.answer.json)).toBe(200);
    expect(await readDraft(p.partyId, p.draft.id)).toMatchObject({
      ownerId: venue.managerId,
      revision: p.draft.revision + 2,
      lines: [{ quantity: "1.000" }, { quantity: "1.000" }, { quantity: "1.000" }],
    });
  });

  it("copies an allergic guest to every resulting source identity", async () => {
    const p = await setup();
    const allergy = await inTx(venue, async (tx) => {
      const state = await savePartyAllergy(
        tx,
        p.partyId,
        await revision(p.partyId),
        {
          answer: "allergies",
          guests: [{ who: "Guest 1", allergens: { peanuts: {} }, note: null }],
        },
        venue.staffId,
      );
      await setAllergyLineTicks(tx, p.partyId, [
        { workingLineId: p.line.id, guestId: state.guests[0]!.id },
      ]);
      return state;
    });
    const { answer } = await split(p.partyId, p.line.id);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const draft = await readDraft(p.partyId, p.draft.id);
    const state = await inTx(venue, (tx) => readPartyAllergy(tx, p.partyId));
    expect(state.guests).toEqual(allergy.guests);
    expect(state.ticks).toHaveLength(3);
    expect(state.ticks).toEqual(
      expect.arrayContaining(
        draft.lines.map((row) => ({
          workingLineId: row.sourceLineId,
          draftLineId: null,
          guestId: allergy.guests[0]!.id,
        })),
      ),
    );
  });

  it("advances draft recency and invalidates the old editor without changing its fresh neighbour", async () => {
    const p = await setup();
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.billId,
      draftId: p.draft.id,
      revision: p.draft.revision,
      lines: [p.draft.lines[0], { menuItemId: venue.item("Bread"), quantity: "1" }],
    });
    expect(saved.status).toBe(200);
    const old = saved.json as unknown as Draft;
    await inTx(venue, (tx) =>
      tx
        .update(orderDrafts)
        .set({ updatedAt: "2026-01-01T00:00:00.000Z" })
        .where(eq(orderDrafts.id, p.draft.id)),
    );
    const before = await frozen();
    const { answer } = await split(p.partyId, p.line.id);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await frozen();
    expect(after.drafts.find((d) => d.id === p.draft.id)!.updatedAt).not.toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(after.bills.find((b) => b.id === p.billId)!.revision).toBe(
      before.bills.find((b) => b.id === p.billId)!.revision + 1,
    );
    expect(after.fresh.find((row) => row.draftId === p.draft.id)).toEqual({
      ...before.fresh.find((row) => row.draftId === p.draft.id)!,
      position: 4,
    });
    const draft = await readDraft(p.partyId, p.draft.id);
    expect(draft.lines[3]).toEqual(old.lines[1]);
    const stable = await frozen();
    const stale = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.billId,
      draftId: p.draft.id,
      revision: old.revision,
      lines: old.lines,
    });
    expect(stale.json).toMatchObject({ code: "draft.out_of_date" });
    expect(await frozen()).toEqual(stable);
  });

  it("rolls back earlier units when paid quantities refuse a later split", async () => {
    const p = await setup("hold", "Burger", "3", "2");
    const before = await frozen();
    const { answer } = await split(p.partyId, p.line.id);
    expect(answer.status).toBe(409);
    expect(answer.json).toMatchObject({
      code: "bill.line_paid",
      params: { lineNo: p.line.lineNo },
    });
    expect(await frozen()).toEqual(before);
  });

  it.each(["placed", "settled", "paying"] as const)(
    "refuses a %s bill and keeps every source",
    async (status) => {
      const p = await setup();
      await inTx(venue, (tx) =>
        tx
          .update(workingOrders)
          .set(
            status === "paying"
              ? { paymentAttemptAt: "2026-10-17T05:00:00.000Z" }
              : {
                  status,
                  ...(status === "settled" ? { settledAt: "2026-10-17T05:00:00.000Z" } : {}),
                },
          )
          .where(eq(workingOrders.id, p.billId)),
      );
      const before = await frozen();
      const { answer } = await split(p.partyId, p.line.id);
      expect(answer.json).toMatchObject({
        code: { placed: "bill.presented", settled: "bill.paid", paying: "order.payment_in_flight" }[
          status
        ],
      });
      expect(await frozen()).toEqual(before);
    },
  );

  it.each([
    ["Burger", "1"],
    ["Ham", "2.5"],
  ])("refuses an unsplittable %s source of %s", async (dish, quantity) => {
    const p = await setup("hold", dish, quantity);
    const before = await frozen();
    const { answer } = await split(p.partyId, p.line.id);
    expect(answer.json).toMatchObject({ code: "tab.transfer_quantity_invalid" });
    expect(await frozen()).toEqual(before);
  });

  it("refuses a source outside the path's party", async () => {
    const p = await setup();
    const other = await setup();
    const before = await frozen();
    const { answer } = await split(other.partyId, p.line.id);
    expect(answer.json).toMatchObject({ code: "group.not_found" });
    expect(await frozen()).toEqual(before);
  });

  it("splits a recalled legacy line with no group while retaining its draft destination", async () => {
    const p = await setup("fire");
    await inTx(venue, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ groupId: null })
        .where(eq(workingOrderLines.id, p.line.id));
      await tx
        .update(workingOrderLines)
        .set({ groupId: null })
        .where(eq(workingOrderLines.parentLineId, p.line.id));
    });
    const { answer } = await split(p.partyId, p.line.id);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const draft = await readDraft(p.partyId, p.draft.id);
    expect(draft.lines).toHaveLength(3);
    for (const row of draft.lines)
      expect(row).toMatchObject({ quantity: "1.000", joinGroupId: null });
  });
});
