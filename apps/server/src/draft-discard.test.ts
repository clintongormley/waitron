import { testTradingAdmission } from "./testing/trading-admission.js";
import { observedPaymentSender } from "./testing/bill-payment-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  billPayments,
  sales,
  saleLines,
  tenders,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  parties,
  printJobs,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { adjustments } from "@waitron/adjustments";
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
import { AppError, PERSON_HEADER } from "@waitron/shared";
import { fiscalRecordCount, send as rawPaymentSend } from "./testing/bill-venue.js";
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
async function billRevision(billId: string) {
  const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, billId));
  return bill!.revision;
}
async function setup(paidWater = false, discounted = false) {
  const p = await billWith(
    venue,
    [
      { name: "Pizza", quantity: "2", olives: 2 },
      { name: "Burger", quantity: "3" },
      { name: "Water" },
    ],
    { release: "hold", shape: "grouped" },
  );
  const [pizza, extra, burger, water] = await rowsOf(venue, p.billId);
  if (paidWater) {
    const payment = await call("POST", `/api/working-orders/${p.billId}/payments`, {
      submissionId: randomUUID(),
      kind: "items",
      lines: [{ lineNo: water!.lineNo, quantity: "1" }],
      method: "cash",
      tendered: "2.00",
      applied: "2.00",
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
  let draft: Draft;
  for (let revision = 0; revision < 2; revision++) {
    const saved = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
      billId: p.billId,
      expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
      draftId: revision === 0 ? null : draft!.id,
      revision: 0,
      lines: [{ menuItemId: venue.item("Bread"), quantity: "1" }],
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    draft = (saved.json as unknown as BillDraftSnapshot).draft!;
  }
  if (paidWater) {
    for (const line of [pizza!, burger!]) {
      const path = `/api/parties/${p.partyId}/lines/${line.id}`;
      const read = await call("GET", `${path}/cancellation`);
      expect(read.status, JSON.stringify(read.json)).toBe(200);
      const current = read.json as unknown as {
        context: unknown;
        revision: number;
        billRevision: number;
      };
      const cancelled = await call("POST", `${path}/cancel-item`, {
        quantity: line.quantity,
        outcome: "remove_charge",
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, p.billId)),
        expectedPartyRevision: current.revision,
        expectedBillRevision: current.billRevision,
        expectedContext: current.context,
        submissionId: randomUUID(),
        reasonId: venue.reasonId.houseVoid,
      });
      expect(cancelled.status, JSON.stringify(cancelled.json)).toBe(200);
    }
  }
  return { ...p, pizza: pizza!, extra: extra!, burger: burger!, draft: draft! };
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
        { ...body, admission: testTradingAdmission() },
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
          { ...body, admission: testTradingAdmission() },
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

  it("rolls back the fresh discard and attendance together if final capture refuses", async () => {
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
          { ...body, admission: testTradingAdmission() },
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

  it("keeps another owner's other-bill draft while the current owner discards fresh dishes", async () => {
    const p = await setup();
    const otherBill = await inTx(venue, (tx) =>
      seedWorkingOrder(tx, { source: "dashboard", orderNumber: 2, partyId: p.partyId }),
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
    expect(after.fresh).toEqual(before.fresh.filter((row) => row.draftId !== p.draft.id));
    const read = await call("GET", `/api/parties/${p.partyId}/drafts`);
    expect(read.json).toEqual({ drafts: [otherDraft], billEdits: expect.any(Array) });
  });

  it("allows the new owner after takeover and records that owner as the discard actor", async () => {
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
      (await frozen()).events.filter((r) => r.draftId === p.draft.id && r.kind === "discarded"),
    ).toMatchObject([
      { actorId: venue.managerId, fromPerson: venue.managerId, toPerson: venue.managerId },
    ]);
  });

  it("removes discarded fresh allergy ticks and keeps each guest and the bill's tick", async () => {
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
        { draftLineId: p.draft.lines[0]!.id, guestId: saved.guests[0]!.id },
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
      before.allergyTicks.filter((t) => t.draftLineId !== p.draft.lines[0]!.id),
    );
    expect(
      after.allergyTicks.some((t) => t.workingLineId === water.id && t.guestId === guestId),
    ).toBe(true);
  });

  it.each([
    ["revision", null],
    ["revision", -1],
    ["expectedRevision", null],
    ["expectedRevision", "1"],
    ["submissionId", ""],
  ])("refuses malformed %s before changing the draft", async (field, value) => {
    const p = await setup();
    const before = await frozen();
    const answer = await discard(p, { ...(await request(p)), [field as string]: value });
    expect(answer.status).toBe(400);
    expect(answer.json).toMatchObject({ code: "management.request_invalid", params: { field } });
    expect(await frozen()).toEqual(before);
  });

  it("discards fresh work once while keeping discounted bill families and other drafts unchanged", async () => {
    const p = await setup(false, true);
    const other = await setup();
    const before = await frozen();
    const records = fiscalRecordCount(venue);
    const body = await request(p);
    const answer = await discard(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await frozen();
    expect(after.lines).toEqual(before.lines);
    expect(after.adjustments).toEqual(before.adjustments);
    expect(after.sales).toEqual(before.sales);
    expect(after.saleLines).toEqual(before.saleLines);
    expect(after.tenders).toEqual(before.tenders);
    expect(fiscalRecordCount(venue)).toBe(records);
    expect(after.drafts.find((r) => r.id === p.draft.id)).toMatchObject({
      state: "discarded",
      revision: p.draft.revision + 1,
    });
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
    expect(after.items).toEqual(before.items);
    expect(after.jobs).toEqual(before.jobs);
    expect(answer.json).toMatchObject({
      draftId: p.draft.id,
      revision: p.draft.revision + 1,
      adjustmentIds: [],
    });
    expect((await discard(p, body)).json).toEqual(answer.json);
    expect(await frozen()).toEqual(after);
    expect(
      (
        await discard(p, {
          ...body,
          revision: body.revision + 1,
          expectedEdit: { ...body.expectedEdit, draftRevision: body.revision + 1 },
        })
      ).json,
    ).toMatchObject({
      code: "submission.id_reused",
    });
    expect(await frozen()).toEqual(after);
    const loaded = await call("GET", `/api/parties/${p.partyId}/drafts`);
    expect(loaded.json).toEqual({ drafts: [], billEdits: expect.any(Array) });
  });

  it.each([false, true])(
    "rolls back the discard and its cached answer when issuance refuses (recorded=%s)",
    async (recordFirst) => {
      const p = await setup(true);
      const body = await request(p);
      const before = await frozen();
      const records = fiscalRecordCount(venue);
      const recordSale = venue.backend.recordSale.bind(venue.backend);
      let attempted = false;
      const probe = vi.spyOn(venue.backend, "recordSale").mockImplementation(async (tx, sale) => {
        if (recordFirst) await recordSale(tx, sale);
        attempted = true;
        throw new AppError("clock.unusable", {
          clockAt: "2001-01-01T00:00:00.000Z",
          offsetMinutes: 0,
        });
      });
      try {
        const answer = await discard(p, body);
        expect(answer.json).toMatchObject({ code: "clock.unusable" });
        expect(attempted).toBe(true);
        expect(await frozen()).toEqual(before);
        expect(fiscalRecordCount(venue)).toEqual(records);
      } finally {
        probe.mockRestore();
      }
    },
  );

  it("rolls back the invoice when caching the completed discard refuses", async () => {
    const p = await setup(true);
    const body = await request(p);
    const before = await frozen();
    const records = fiscalRecordCount(venue);
    expect(p.billId).toMatch(/^[a-f0-9-]{36}$/);
    await venue.db
      .execute(sql`create trigger refuse_completed_discard before insert on service_commands
      when new.kind = 'draft.discard' and exists (select 1 from sales where working_order_id = '${sql.raw(p.billId)}')
      begin select raise(abort, 'completed discard probe'); end`);
    try {
      const answer = await discard(p, body);
      expect(answer.json).toMatchObject({ code: "server.internal" });
      expect(await frozen()).toEqual(before);
      expect(fiscalRecordCount(venue)).toEqual(records);
    } finally {
      await venue.db.execute(sql`drop trigger refuse_completed_discard`);
    }
  });

  it("issues the paid bill once after the final fresh draft is discarded", async () => {
    const p = await setup(true);
    const body = await request(p);
    const before = await frozen();
    const recordsBefore = fiscalRecordCount(venue);
    const answer = await discard(p, body);
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const after = await frozen();
    const issued = after.sales.filter((s) => s.workingOrderId === p.billId);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ total: 200 });
    expect(answer.json).toMatchObject({ invoice: { total: "2.00", invoiceType: "F2" } });
    expect(after.saleLines.filter((l) => l.saleId === issued[0]!.id)).toMatchObject([
      { quantity: 1000, lineGross: 200 },
    ]);
    expect(after.tenders.filter((t) => t.saleId === issued[0]!.id)).toMatchObject([
      { amount: 200, method: "cash" },
    ]);
    expect(after.bills.find((b) => b.id === p.billId)).toMatchObject({ status: "settled" });
    expect(after.payments).toEqual(before.payments);
    const records = fiscalRecordCount(venue);
    expect(records).toBe(recordsBefore + 1);
    expect((await discard(p, body)).json).toEqual(answer.json);
    expect(fiscalRecordCount(venue)).toEqual(records);
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
    "refuses a %s bill before discarding fresh work",
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

  it("refuses a discard naming another person signed in on the device, and serves the session's own", async () => {
    // Both sessions are open on the one till; the staff member edits the draft.
    const p = await setup();
    const ana = venue.managerId;
    const ben = venue.staffId;
    const discardNaming = async (person: string) => {
      const res = await venue.app.request(
        `/api/parties/${p.partyId}/drafts/${p.draft.id}/discard`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: venue.cookie.staff,
            [PERSON_HEADER]: person,
          },
          body: JSON.stringify(await request(p)),
        },
      );
      return { status: res.status, json: (await res.json()) as unknown };
    };
    const before = await frozen();
    expect(await discardNaming(ana)).toEqual({
      status: 409,
      json: { error: { code: "session.person_not_signed_in", params: { personId: ana } } },
    });
    expect(await frozen()).toEqual(before);
    const answer = await discardNaming(ben.toUpperCase());
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((await frozen()).drafts.find((r) => r.id === p.draft.id)).toMatchObject({
      state: "discarded",
    });
  });

  it("hides a draft addressed through another party", async () => {
    const p = await setup();
    const other = await setup();
    const before = await frozen();
    const answer = await discard({ ...p, partyId: other.partyId }, await request(p));
    expect(answer.json).toMatchObject({ code: "draft.not_found" });
    expect(await frozen()).toEqual(before);
  });

  it("discards a fresh draft without an adjustment reason", async () => {
    const p = await setup();
    const before = await frozen();
    const answer = await discard(p, await request(p));
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(answer.json).toMatchObject({
      draftId: p.draft.id,
      revision: p.draft.revision + 1,
      adjustmentIds: [],
    });
    const after = await frozen();
    expect(after.lines).toEqual(before.lines);
    expect(after.adjustments).toEqual(before.adjustments);
    expect(after.drafts.find((r) => r.id === p.draft.id)).toMatchObject({ state: "discarded" });
  });
});

const send = observedPaymentSender(() => venue.db, rawPaymentSend);
