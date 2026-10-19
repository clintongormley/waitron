import { observedPaymentSender } from "./testing/bill-payment-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billPayments,
  sales,
  saleLines,
  tenders,
  orderDraftEvents,
  orderDraftLines,
  orderDraftRecalledLines,
  orderDrafts,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  allergyLineTicks,
  partyAllergyGuests,
  savePartyAllergy,
  setAllergyLineTicks,
} from "@waitron/venue-service";
import { discardDraft, type Draft, type BillDraftSnapshot } from "./order-drafts.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { attendanceOperationFacts } from "@waitron/workforce";
import { AppError } from "@waitron/shared";
import {
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);
afterEach(async () => {
  await watchedOrder();
});
import { send as rawPaymentSend } from "./testing/bill-venue.js";
import {
  billWith,
  inTx,
  PINS,
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
async function billRevision(billId: string) {
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return bill!.revision;
}
async function recall(partyId: string, lineId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  const [line] = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.id, lineId));
  const answer = await call("POST", `/api/parties/${partyId}/lines/${lineId}/recall`, {
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, line!.workingOrderId)),
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return (answer.json as unknown as { draft: Draft }).draft;
}
async function setup(
  paidLast = false,
  paidWater = false,
  discounted = false,
  release: "hold" | "fire" = "hold",
) {
  const p = await billWith(
    venue,
    [
      { name: "Pizza", quantity: "2", olives: 2 },
      { name: "Burger", quantity: "3" },
      { name: "Water" },
    ],
    { release },
  );
  const [pizza, extra, burger, water] = await rowsOf(venue, p.billId);
  if (paidLast || paidWater) {
    const payment = await call("POST", `/api/working-orders/${p.billId}/payments`, {
      submissionId: randomUUID(),
      kind: "items",
      lines: [{ lineNo: (paidWater ? water : burger)!.lineNo, quantity: paidWater ? "1" : "2" }],
      method: "cash",
      tendered: paidWater ? "2.00" : "24.00",
      applied: paidWater ? "2.00" : "24.00",
      tip: "0.00",
    });
    expect(payment.status, JSON.stringify(payment.json)).toBe(200);
  }
  if (discounted) {
    const discount = await call("POST", `/api/working-orders/${p.billId}/adjustments`, {
      expectedEdit: await readBillEditState(venue.db, p.billId),
      submissionId: randomUUID(),
      expectedRevision: await billRevision(p.billId),
      action: "discount_percent",
      percentBp: 1000,
      lineId: null,
      reasonId: venue.reasonId.house,
      note: null,
    });
    expect(discount.status, JSON.stringify(discount.json)).toBe(200);
  }
  await recall(p.partyId, pizza!.id);
  const draft = await recall(p.partyId, burger!.id);
  return { ...p, pizza: pizza!, extra: extra!, burger: burger!, draft };
}
async function request(
  p: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    submissionId: randomUUID(),
    revision: p.draft.revision,
    expectedRevision: await billRevision(p.billId),
    expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
    reasonId: venue.reasonId.houseVoid,
    note: null,
    ...overrides,
  };
}
function discard(p: { partyId: string; draft: Draft }, body: unknown, cookie = venue.cookie.staff) {
  return call("POST", `/api/parties/${p.partyId}/drafts/${p.draft.id}/discard`, body, cookie);
}
async function frozen() {
  return {
    sales: await venue.db.select().from(sales).orderBy(sales.id),
    saleLines: await venue.db.select().from(saleLines).orderBy(saleLines.id),
    tenders: await venue.db.select().from(tenders).orderBy(tenders.id),
    bills: await venue.db.select().from(workingOrders).orderBy(workingOrders.id),
    lines: await venue.db.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    drafts: await venue.db.select().from(orderDrafts).orderBy(orderDrafts.id),
    fresh: await venue.db.select().from(orderDraftLines).orderBy(orderDraftLines.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    events: await venue.db.select().from(orderDraftEvents).orderBy(orderDraftEvents.id),
    parties: await venue.db.select().from(parties).orderBy(parties.id),
    commands: await venue.db.select().from(serviceCommands).orderBy(serviceCommands.id),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
    items: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    payments: await venue.db.select().from(billPayments).orderBy(billPayments.id),
    allergyTicks: await venue.db.select().from(allergyLineTicks).orderBy(allergyLineTicks.id),
    allergyGuests: await venue.db.select().from(partyAllergyGuests).orderBy(partyAllergyGuests.id),
  };
}

describe("Discard resolves the whole owned draft atomically", () => {
  it("captures the final draft discard once under its acting owner", async () => {
    const p = await setup();
    const body = await request(p);
    const attendance = { recorder: recordAttendanceFact, clock: venue.clock };
    const answer = await inTx(venue, (tx) =>
      discardDraft(
        tx,
        venue.cfg,
        p.partyId,
        p.draft.id,
        venue.staffId,
        body,
        venue.venueLocale,
        undefined,
        attendance,
      ),
    );
    const facts = await venue.db
      .select()
      .from(attendanceOperationFacts)
      .orderBy(attendanceOperationFacts.sequence);
    const own = facts.filter((f) => f.key === `${p.draft.id}:${answer.revision}:discard`);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      personId: venue.staffId,
      locationId: venue.cfg.locationId,
      kind: "order",
    });
    expect(
      await inTx(venue, (tx) =>
        discardDraft(
          tx,
          venue.cfg,
          p.partyId,
          p.draft.id,
          venue.staffId,
          body,
          venue.venueLocale,
          undefined,
          attendance,
        ),
      ),
    ).toEqual(answer);
    expect(
      await venue.db
        .select()
        .from(attendanceOperationFacts)
        .orderBy(attendanceOperationFacts.sequence),
    ).toEqual(facts);
  });

  it("rolls back cancelled families, discard and attendance together if final capture refuses", async () => {
    const p = await setup();
    const body = await request(p);
    const facts = await venue.db
      .select()
      .from(attendanceOperationFacts)
      .orderBy(attendanceOperationFacts.sequence);
    const before = await frozen();
    await expect(
      inTx(venue, (tx) =>
        discardDraft(
          tx,
          venue.cfg,
          p.partyId,
          p.draft.id,
          venue.staffId,
          body,
          venue.venueLocale,
          undefined,
          {
            clock: venue.clock,
            recorder: async (recordTx, fact) => {
              await recordAttendanceFact(recordTx, fact);
              if (fact.key.endsWith(":discard"))
                throw new AppError("attendance.invalid", { reason: "discard refused" });
            },
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "attendance.invalid" });
    expect(await frozen()).toEqual(before);
    expect(
      await venue.db
        .select()
        .from(attendanceOperationFacts)
        .orderBy(attendanceOperationFacts.sequence),
    ).toEqual(facts);
  });

  it.each(["foreign-owner", "paying"] as const)(
    "protects fresh-only drafts from %s discard",
    async (refusal) => {
      const p = await billWith(venue, [{ name: "Water" }], { release: "hold" });
      const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
        billId: p.billId,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: venue.item("Bread"), quantity: "1" }],
      });
      expect(saved.status).toBe(200);
      const draft = (saved.json as unknown as BillDraftSnapshot).draft!;
      if (refusal === "paying")
        await inTx(venue, (tx) =>
          tx
            .update(workingOrders)
            .set({ paymentAttemptAt: "2026-10-17T05:00:00.000Z" })
            .where(eq(workingOrders.id, p.billId)),
        );
      const before = await frozen();
      const answer = await discard(
        { ...p, draft },
        {
          submissionId: randomUUID(),
          revision: draft.revision,
          expectedRevision: await billRevision(p.billId),
          expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
        },
        refusal === "foreign-owner" ? venue.cookie.manager : venue.cookie.staff,
      );
      expect(answer.json).toMatchObject({
        code: refusal === "foreign-owner" ? "draft.taken_over" : "order.payment_in_flight",
      });
      expect(await frozen()).toEqual(before);
    },
  );

  it("keeps another owner's other-bill draft while the current owner discards recalled dishes", async () => {
    const p = await setup();
    const [otherBill] = await inTx(venue, (tx) =>
      tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          orderNumber: 2,
          partyId: p.partyId,
          locationId: venue.cfg.locationId,
        })
        .returning(),
    );
    const saved = await call(
      "PUT",
      `/api/parties/${p.partyId}/drafts`,
      {
        billId: otherBill!.id,
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, otherBill!.id)),
        draftId: null,
        revision: 0,
        lines: [{ menuItemId: venue.item("Bread"), quantity: "1" }],
      },
      venue.cookie.manager,
    );
    expect(saved.status).toBe(200);
    const otherDraft = (saved.json as unknown as BillDraftSnapshot).draft!;
    const before = await frozen();
    expect((await discard(p, await request(p))).status).toBe(200);
    const after = await frozen();
    expect(after.drafts.find((r) => r.id === otherDraft.id)).toEqual(
      before.drafts.find((r) => r.id === otherDraft.id),
    );
    expect(after.fresh).toEqual(before.fresh);
    const read = await call("GET", `/api/parties/${p.partyId}/drafts`);
    expect(read.json).toEqual({ drafts: [otherDraft], billEdits: expect.any(Array) });
  });

  it("allows the new owner after takeover while retaining the adjustment actor", async () => {
    const p = await setup();
    const taken = await call(
      "POST",
      `/api/parties/${p.partyId}/drafts/${p.draft.id}/take-over`,
      {
        revision: p.draft.revision,
        submissionId: randomUUID(),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
      },
      venue.cookie.manager,
    );
    expect(taken.status).toBe(200);
    p.draft = (taken.json as unknown as BillDraftSnapshot).draft!;
    const answer = await discard(p, await request(p), venue.cookie.manager);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(
      (await frozen()).adjustments.filter(
        (r) => r.workingOrderId === p.billId && r.action === "cancel",
      ),
    ).toMatchObject([{ requestedBy: venue.managerId }, { requestedBy: venue.managerId }]);
  });

  it("removes cancelled sources' allergy ticks and keeps each guest and another dish's tick", async () => {
    const p = await setup();
    const water = (await rowsOf(venue, p.billId))[3]!;
    const allergy = await inTx(venue, async (tx) => {
      const [party] = await tx.select().from(parties).where(eq(parties.id, p.partyId));
      const saved = await savePartyAllergy(
        tx,
        p.partyId,
        party!.revision,
        {
          answer: "allergies",
          guests: [{ who: "Seat 2", allergens: { peanuts: {} }, note: null }],
        },
        venue.staffId,
      );
      await setAllergyLineTicks(tx, p.partyId, [
        { workingLineId: p.pizza.id, guestId: saved.guests[0]!.id },
        { workingLineId: water.id, guestId: saved.guests[0]!.id },
      ]);
      return saved;
    });
    const guestId = allergy.guests[0]!.id;
    const before = await frozen();
    expect((await discard(p, await request(p))).status).toBe(200);
    const after = await frozen();
    expect(after.allergyGuests).toEqual(before.allergyGuests);
    expect(after.allergyTicks).toEqual(
      before.allergyTicks.filter((t) => t.workingLineId !== p.pizza.id),
    );
    expect(
      after.allergyTicks.some((t) => t.workingLineId === water.id && t.guestId === guestId),
    ).toBe(true);
  });

  it("derives one manager key outside the write lock for all recalled families", async () => {
    const p = await setup();
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Discard-key-${randomUUID()}`,
        names: {},
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
        noteRequired: false,
      }),
    );
    const body = await request(p, {
      reasonId: reason.id,
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    watchDerivationsAndLock(venue.db, PINS.manager, () =>
      withTransaction(venue.db, (tx) => tx.execute(sql`select 1`)),
    );
    const answer = await discard(p, body);
    expect(answer.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(watchedDerivationCount()).toBe(1);
  });

  it("rejects a wrong approver PIN without partially cancelling", async () => {
    const p = await setup(false, false, false, "fire");
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Discard-pin-${randomUUID()}`,
        names: {},
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
        noteRequired: false,
      }),
    );
    const body = await request(p, {
      reasonId: reason.id,
      approver: { personId: venue.managerId, pin: "9999" },
    });
    const before = await frozen();
    const answer = await discard(p, body);
    expect(answer.status).toBe(401);
    expect(answer.json).toMatchObject({ code: "pin.invalid" });
    expect(await frozen()).toEqual(before);
  });

  it.each([
    ["revision", null],
    ["revision", -1],
    ["expectedRevision", null],
    ["expectedRevision", "1"],
    ["reasonId", null],
    ["reasonId", ["not-a-uuid"]],
    ["note", 123],
    ["note", "x".repeat(501)],
    ["submissionId", ""],
  ])("refuses malformed %s before changing the draft", async (field, value) => {
    const p = await setup();
    const before = await frozen();
    const answer = await discard(p, { ...(await request(p)), [field as string]: value });
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
    expect(await frozen()).toEqual(before);
  });

  it("cancels both frozen discounted families, discards fresh work and replays once", async () => {
    const p = await setup(false, false, true);
    const read = await call("GET", `/api/parties/${p.partyId}/drafts`);
    const current = (read.json as unknown as { drafts: Draft[] }).drafts[0]!;
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.billId,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
      draftId: current.id,
      revision: current.revision,
      lines: [...current.lines, { menuItemId: venue.item("Bread"), quantity: "1" }],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    p.draft = (saved.json as unknown as BillDraftSnapshot).draft!;
    const other = await setup();
    const before = await frozen();
    const body = await request(p);
    const answer = await discard(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await rowsOf(venue, p.billId)).toEqual([
      expect.objectContaining({ name: "Water", quantity: "1.000", lineTotal: "1.80" }),
    ]);
    const after = await frozen();
    const cancelled = after.adjustments.filter(
      (r) => r.workingOrderId === p.billId && r.action === "cancel",
    );
    expect(cancelled).toHaveLength(2);
    expect(cancelled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lineId: p.pizza.id,
          quantity: 2000,
          reduction: 2160,
          nominalValue: 2400,
        }),
        expect.objectContaining({
          lineId: p.burger.id,
          quantity: 3000,
          reduction: 3240,
          nominalValue: 3600,
        }),
      ]),
    );
    expect(
      after.adjustments.filter((r) => before.adjustments.some((old) => old.id === r.id)),
    ).toEqual(before.adjustments);
    expect(after.drafts.find((r) => r.id === p.draft.id)).toMatchObject({
      state: "discarded",
      revision: p.draft.revision + 3,
    });
    expect(after.sources.filter((r) => r.draftId === p.draft.id)).toEqual([]);
    expect(
      after.events.filter((r) => r.draftId === p.draft.id && r.kind === "discarded"),
    ).toMatchObject([
      { actorId: venue.staffId, fromPerson: venue.staffId, toPerson: venue.staffId },
    ]);
    expect(
      after.events.filter((r) => r.draftId === p.draft.id && r.kind === "discarded"),
    ).toHaveLength(1);
    expect(after.fresh).toEqual(before.fresh.filter((row) => row.draftId !== p.draft.id));
    expect(after.drafts.find((r) => r.id === other.draft.id)).toEqual(
      before.drafts.find((r) => r.id === other.draft.id),
    );
    expect(after.sources.filter((r) => r.draftId === other.draft.id)).toEqual(
      before.sources.filter((r) => r.draftId === other.draft.id),
    );
    expect(after.items).toEqual(before.items);
    expect(after.jobs).toEqual(before.jobs);
    expect(answer.json).toMatchObject({
      draftId: p.draft.id,
      revision: p.draft.revision + 3,
      adjustmentIds: [
        cancelled.find((r) => r.lineId === p.pizza.id)!.id,
        cancelled.find((r) => r.lineId === p.burger.id)!.id,
      ],
    });
    expect((await discard(p, body)).json).toEqual(answer.json);
    expect(await frozen()).toEqual(after);
    expect((await discard(p, { ...body, note: "Another request" })).json).toMatchObject({
      code: "submission.id_reused",
    });
    expect(await frozen()).toEqual(after);
    const loaded = await call("GET", `/api/parties/${p.partyId}/drafts`);
    expect(loaded.json).toEqual({ drafts: [], billEdits: expect.any(Array) });
  });

  it("uses the existing settlement when cancelling sources leaves the remaining bill fully paid", async () => {
    const p = await setup(false, true);
    const body = await request(p);
    const before = await frozen();
    const answer = await discard(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await frozen();
    const issued = after.sales.filter((s) => s.workingOrderId === p.billId);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ total: 200 });
    expect(after.saleLines.filter((l) => l.saleId === issued[0]!.id)).toMatchObject([
      { quantity: 1000, lineGross: 200 },
    ]);
    expect(after.tenders.filter((t) => t.saleId === issued[0]!.id)).toMatchObject([
      { amount: 200, method: "cash" },
    ]);
    expect(after.bills.find((b) => b.id === p.billId)).toMatchObject({ status: "settled" });
    expect(after.payments).toEqual(before.payments);
    expect((await discard(p, body)).json).toEqual(answer.json);
    expect(await frozen()).toEqual(after);
  });

  it("replays the first response after the party has moved on", async () => {
    const p = await setup();
    const body = await request(p);
    const first = await discard(p, body);
    expect(first.status).toBe(200);
    await inTx(venue, (tx) =>
      tx
        .update(parties)
        .set({ revision: sql`${parties.revision} + 1` })
        .where(eq(parties.id, p.partyId)),
    );
    const before = await frozen();
    expect((await discard(p, body)).json).toEqual(first.json);
    expect(await frozen()).toEqual(before);
  });

  it("rolls back the first family when a later recalled family contains paid units", async () => {
    const p = await setup(true);
    const before = await frozen();
    const answer = await discard(p, await request(p));
    expect(answer.json).toMatchObject({
      code: "bill.line_paid",
      params: { lineNo: p.burger.lineNo },
    });
    expect(await frozen()).toEqual(before);
  });

  it("retains reason, required-note and manager-PIN policy for the whole Discard", async () => {
    const p = await setup(false, false, false, "fire");
    const reason = await inTx(venue, (tx) =>
      createAdjustmentReason(tx, {
        name: `Discard-${randomUUID()}`,
        names: {},
        kind: "void",
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRoles: [],
        approverRoles: [],
        noteRequired: true,
      }),
    );
    const before = await frozen();
    const body = await request(p, { reasonId: reason.id });
    expect((await discard(p, body)).json).toMatchObject({ code: "adjustment.note_required" });
    expect(await frozen()).toEqual(before);
    expect((await discard(p, { ...body, note: "Duplicate order" })).json).toMatchObject({
      code: "adjustment.approval_required",
    });
    expect(await frozen()).toEqual(before);
    const approved = await discard(p, {
      ...body,
      note: "Duplicate order",
      approver: { personId: venue.managerId, pin: PINS.manager },
    });
    expect(approved.status, JSON.stringify(approved.json)).toBe(200);
    const rows = (await frozen()).adjustments.filter(
      (r) => r.workingOrderId === p.billId && r.action === "cancel",
    );
    expect(rows).toMatchObject([
      {
        requestedBy: venue.staffId,
        approvedBy: venue.managerId,
        note: "Duplicate order",
        reasonId: reason.id,
      },
      {
        requestedBy: venue.staffId,
        approvedBy: venue.managerId,
        note: "Duplicate order",
        reasonId: reason.id,
      },
    ]);
    expect(rows).toHaveLength(2);
    const commands = (await frozen()).commands.filter(
      (r) => r.scopeId === p.billId || r.scopeId === p.partyId,
    );
    expect(JSON.stringify(commands)).not.toContain(PINS.manager);
    expect(JSON.stringify(commands)).not.toContain('"pin"');
  });

  it("does not take over another person's draft", async () => {
    const p = await setup();
    const before = await frozen();
    const answer = await discard(p, await request(p), venue.cookie.manager);
    expect(answer.json).toMatchObject({
      code: "draft.taken_over",
      params: { draftId: p.draft.id, ownerId: venue.staffId, ownerName: p.draft.ownerName },
    });
    expect(await frozen()).toEqual(before);
  });

  it.each(["draft", "bill"] as const)(
    "refuses the stale %s before changing anything",
    async (stale) => {
      const p = await setup();
      const body = await request(p);
      const before = await frozen();
      const answer = await discard(p, {
        ...body,
        ...(stale === "draft"
          ? {
              revision: body.revision - 1,
              expectedEdit: { ...body.expectedEdit, draftRevision: body.revision - 1 },
            }
          : { expectedRevision: body.expectedRevision - 1 }),
      });
      expect(answer.json).toMatchObject({
        code: stale === "draft" ? "draft.out_of_date" : "working_order.out_of_date",
      });
      expect(await frozen()).toEqual(before);
    },
  );

  it.each(["placed", "settled", "paying"] as const)(
    "refuses a %s bill before discarding sources",
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
      const answer = await discard(p, await request(p));
      expect(answer.json).toMatchObject({
        code: { placed: "bill.presented", settled: "bill.paid", paying: "order.payment_in_flight" }[
          status
        ],
      });
      expect(await frozen()).toEqual(before);
    },
  );

  it("hides a draft addressed through another party", async () => {
    const p = await setup();
    const other = await setup();
    const before = await frozen();
    const answer = await discard({ ...p, partyId: other.partyId }, await request(p));
    expect(answer.json).toMatchObject({ code: "draft.not_found" });
    expect(await frozen()).toEqual(before);
  });

  it("requires a reason only when the draft holds recalled charges", async () => {
    const p = await setup();
    const body = await request(p);
    delete (body as { reasonId?: string }).reasonId;
    const before = await frozen();
    expect((await discard(p, body)).json).toMatchObject({
      code: "management.request_invalid",
      params: { field: "reasonId" },
    });
    expect(await frozen()).toEqual(before);
    const freshParty = await billWith(venue, [{ name: "Water" }], { release: "hold" });
    const saved = await call("PUT", `/api/parties/${freshParty.partyId}/drafts`, {
      billId: freshParty.billId,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, freshParty.billId)),
      draftId: null,
      revision: 0,
      lines: [{ menuItemId: venue.item("Bread"), quantity: "1" }],
    });
    expect(saved.status).toBe(200);
    const draft = (saved.json as unknown as BillDraftSnapshot).draft!;
    const freshBefore = await frozen();
    const answer = await discard(
      { ...freshParty, draft },
      {
        submissionId: randomUUID(),
        revision: draft.revision,
        expectedRevision: await billRevision(freshParty.billId),
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, freshParty.billId)),
      },
    );
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      draftId: draft.id,
      revision: draft.revision + 1,
      adjustmentIds: [],
    });
    const after = await frozen();
    expect(after.lines).toEqual(freshBefore.lines);
    expect(after.adjustments).toEqual(freshBefore.adjustments);
    expect(after.drafts.find((r) => r.id === draft.id)).toMatchObject({ state: "discarded" });
  });
});

const send = observedPaymentSender(() => venue.db, rawPaymentSend);
