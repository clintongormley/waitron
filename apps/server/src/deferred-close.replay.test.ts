import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { workingOrders, type StagedInvoiceDelivery } from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { deploymentEnvironment } from "./config.js";
import { systemClock } from "./till-backend.js";
import { readDeferredClosure } from "./deferred-close.js";
import type { CloseDeferredRequest } from "./deferred-close-types.js";
import { readOrderRevision } from "./working-order.js";
import { setOrderInvoiceChoice } from "./testing/order-writer-fixture.js";
import {
  fiscalRecordCount,
  inTx,
  placedCounterBillMovedTo,
  seatedWith,
  tendersOfBill,
} from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import {
  MINUTE,
  RECIPIENT,
  clockAt,
  refusal,
  deferredCloseVenue,
  type DeferredCloseKit,
} from "./testing/deferred-close-fixture.js";
import type { AppError } from "@waitron/shared";
import "./errors.js";

// Strict replay of a deferred close: the same submission answers with what it
// answered first, and anything that is not the same request is refused before it writes.
let t: DeferredCloseKit;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await deferredCloseVenue(db);
  },
});

function recorded() {
  const facts: Parameters<AttendanceRecorder>[1][] = [];
  const attendance: AttendanceRecorder = (_tx, fact) => {
    facts.push(fact);
    return Promise.resolve();
  };
  return { facts, attendance };
}

function closures(billId: string) {
  return t.venue.db.all(sql`select id from deferred_closures where working_order_id = ${billId}`);
}

async function closedCounterBill(deps = t.depsWith()) {
  const billId = await t.counterOrder("placed");
  const request = await t.requestFor(billId, "18.00", null);
  const result = await t.close(request, deps);
  return { billId, request, result };
}

/** A table bill staged as an F1 to be emailed, closed; with `twoBills`, its party holds another. */
async function closedStagedF1(twoBills = false) {
  const party = await seatedWith(t.venue, "House salad");
  if (twoBills) await placedCounterBillMovedTo(t.venue, t.counterZone, party);
  await setOrderInvoiceChoice(t.venue.db, t.venue.backend, t.venue.cfg, party.tabId, {
    revision: await inTx(t.venue, (tx) => readOrderRevision(tx, party.tabId)),
    invoiceType: "F1",
    recipient: RECIPIENT,
  });
  await stageDelivery(party.tabId, {
    medium: "email",
    recipient: "customer@example.com",
    personId: t.venue.operatorId,
  });
  const request = await t.requestFor(party.tabId, "12.00", party.partyId, {
    delivery: { medium: "email", recipient: "customer@example.com" },
  });
  const result = await t.close(request);
  return { party, request, result };
}

function stageDelivery(billId: string, delivery: StagedInvoiceDelivery) {
  return inTx(t.venue, (tx) =>
    tx.update(workingOrders).set({ invoiceDelivery: delivery }).where(eq(workingOrders.id, billId)),
  );
}

const changes: [string, (request: CloseDeferredRequest) => CloseDeferredRequest][] = [
  ["total", (r) => ({ ...r, expectedTotal: "12.01" })],
  ["revision", (r) => ({ ...r, expectedRevision: r.expectedRevision + 1 })],
  ["invoice type", (r) => ({ ...r, invoiceType: "F2", recipient: null, delivery: null })],
  ["recipient", (r) => ({ ...r, recipient: { ...RECIPIENT, legalName: "Otro Cliente SL" } })],
  ["receipt language", (r) => ({ ...r, receiptLanguage: "en" })],
  [
    "delivery destination",
    (r) => ({ ...r, delivery: { medium: "email", recipient: "other@example.com" } }),
  ],
  ["delivery medium", (r) => ({ ...r, delivery: { medium: "receipt" } })],
  ["bill edit", (r) => ({ ...r, expectedEdit: { ...r.expectedEdit!, editorVersion: 99 } })],
  ["party finish", (r) => ({ ...r, partyFinish: null })],
  [
    "party revision",
    (r) => ({
      ...r,
      partyFinish: {
        ...r.partyFinish!,
        expectedPartyRevision: r.partyFinish!.expectedPartyRevision + 1,
      },
    }),
  ],
];

describe("closeBillDeferredTx, replay", () => {
  it("answers an exact replay with the stored result and writes nothing more", async () => {
    const { facts, attendance } = recorded();
    const billId = await t.counterOrder("placed");
    const request = await t.requestFor(billId, "18.00", null);
    const result = await t.close(request, t.depsWith({ attendance }));
    const recordedFirst = facts.length;
    const before = await t.ledger();

    const again = await t.close(request, t.depsWith({ attendance }));

    expect(again).toEqual(result);
    expect(await t.ledger()).toEqual(before);
    expect(facts).toHaveLength(recordedFirst);
    expect(fiscalRecordCount(t.venue, billId)).toBe(1);
    expect(await tendersOfBill(t.venue, billId)).toHaveLength(1);
    expect(closures(billId)).toEqual([{ id: request.submissionId }]);
  });

  it("answers the same after a restart, with fresh dependencies over the same database", async () => {
    const { request, result } = await closedCounterBill();
    const clock = systemClock();
    const backend = new VerifactuBackend({
      clock,
      db: t.venue.db,
      environment: deploymentEnvironment(process.env),
      deploymentEnvironment: deploymentEnvironment(process.env),
      resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
    });
    const before = await t.ledger();

    const again = await t.close(
      request,
      t.depsWith({ backend, clock, admission: testTradingAdmission() }),
    );

    expect(again).toEqual(result);
    expect(await t.ledger()).toEqual(before);
  });

  it("answers a replay whose first answer was lost with what was kept", async () => {
    const billId = await t.counterOrder("placed");
    const request = await t.requestFor(billId, "18.00", null);
    await t.close(request);
    const kept = await inTx(t.venue, (tx) => readDeferredClosure(tx, billId));

    expect(await t.close(request)).toEqual(kept);
    expect(closures(billId)).toHaveLength(1);
  });

  it("treats spelling differences of the same request as the same request", async () => {
    const { party, request, result } = await closedStagedF1(true);
    const [first, ...rest] = request.partyFinish!.expectedEdits;
    expect(rest).toHaveLength(1);
    const respelled: CloseDeferredRequest = {
      ...request,
      id: request.id.toUpperCase(),
      submissionId: request.submissionId.toUpperCase(),
      expectedTotal: "12",
      recipient: { ...RECIPIENT, legalName: ` ${RECIPIENT.legalName} `, countryCode: "es" },
      delivery: { medium: "email", recipient: " customer@example.com " },
      partyFinish: {
        ...request.partyFinish!,
        partyId: party.partyId.toUpperCase(),
        expectedEdits: [...rest, { ...first!, billId: first!.billId.toUpperCase() }],
      },
    };

    expect(await t.close(respelled)).toEqual(result);
    expect(await t.close({ ...respelled, submissionId: randomUUID() })).toEqual(result);
  });

  it.each(changes)("refuses the same submission id with a changed %s", async (_name, change) => {
    const { request } = await closedStagedF1();
    const before = await t.ledger();

    const error = await refusal(t.close(change(request)));

    expect(error.code).toBe("submission.id_reused");
    expect(error.params).toEqual({ submissionId: request.submissionId });
    expect(await t.ledger()).toEqual(before);
  });

  it.each(changes)(
    "refuses another submission id on a closed bill with a changed %s",
    async (_name, change) => {
      const { request } = await closedStagedF1();
      const before = await t.ledger();

      const error = await refusal(t.close({ ...change(request), submissionId: randomUUID() }));

      expect(error.code).toBe("deferred_close.conflict");
      expect(error.params).toEqual({ workingOrderId: request.id });
      expect(await t.ledger()).toEqual(before);
    },
  );

  it("answers another submission id on a closed bill with the stored result when nothing else differs", async () => {
    const { billId, request, result } = await closedCounterBill();

    const again = await t.close({ ...request, submissionId: randomUUID() });

    expect(again).toEqual(result);
    expect(closures(billId)).toEqual([{ id: request.submissionId }]);
  });

  // Each close is its own withTransaction, as a route makes it; the store runs them in turn.
  it("closes once when the same request arrives twice at once, answering both alike", async () => {
    const billId = await t.counterOrder("placed");
    const request = await t.requestFor(billId, "18.00", null);

    const [first, second] = await Promise.all([t.close(request), t.close(request)]);

    expect(second).toEqual(first);
    expect(fiscalRecordCount(t.venue, billId)).toBe(1);
    expect(await tendersOfBill(t.venue, billId)).toHaveLength(1);
    expect(
      t.venue.db.all(
        sql`select s.id from sale_settlements s join sales on sales.id = s.sale_id where sales.working_order_id = ${billId}`,
      ),
    ).toHaveLength(1);
    expect(closures(billId)).toEqual([{ id: request.submissionId }]);
  });

  it("closes once when two different requests for one bill arrive at once, refusing the other", async () => {
    const party = await seatedWith(t.venue, "House salad");
    const billId = party.tabId;
    const request = await t.requestFor(billId, "12.00", party.partyId);
    // Either request alone would close the bill; only the replay can refuse the later one.
    const changed = { ...request, submissionId: randomUUID(), partyFinish: null };

    const outcomes = await Promise.allSettled([t.close(request), t.close(changed)]);

    const served = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason as AppError] : [],
    );
    expect(served).toHaveLength(1);
    expect(refused.map((error): [string, unknown] => [error.code, error.params])).toEqual([
      ["deferred_close.conflict", { workingOrderId: billId }],
    ]);
    expect(fiscalRecordCount(t.venue, billId)).toBe(1);
    expect(closures(billId)).toHaveLength(1);
  });

  it("refuses the same request from another person or another device", async () => {
    const { request } = await closedCounterBill();
    const otherDevice = {
      ...t.venue.cfg,
      origin: { ...t.venue.cfg.origin, deviceId: t.venue.device2Id },
    } as typeof t.venue.cfg;

    const byPerson = await refusal(t.close(request, t.depsWith(), { actorId: t.venue.adminId }));
    const fromDevice = await refusal(t.close(request, t.depsWith(), { cfg: otherDevice }));

    for (const error of [byPerson, fromDevice]) expect(error.code).toBe("submission.id_reused");
  });

  it("refuses a submission id already used on another bill", async () => {
    const { request } = await closedCounterBill();
    const otherBill = await t.counterOrder("placed");
    const before = await t.ledger();

    const error = await refusal(
      t.close(await t.requestFor(otherBill, "18.00", null, { submissionId: request.submissionId })),
    );

    expect(error.code).toBe("submission.id_reused");
    expect(error.params).toEqual({ submissionId: request.submissionId });
    expect(await t.ledger()).toEqual(before);
  });

  it("answers an exact replay while the disk is stopped, and refuses new work", async () => {
    const { request, result } = await closedCounterBill();
    const fresh = await t.requestFor(await t.counterOrder("placed"), "18.00", null);
    const stopped = t.depsWith({ diskBlockedBeforeQueue: true });

    expect(await t.close(request, stopped)).toEqual(result);
    expect((await refusal(t.close(fresh, stopped))).code).toBe("storage.disk_full");
  });

  it("answers an exact replay while the clock is behind the latest record, and refuses new work", async () => {
    const { request, result } = await closedCounterBill();
    const fresh = await t.requestFor(await t.counterOrder("placed"), "18.00", null);
    const behind = t.depsWith({ clock: clockAt(t.latestRecordMs() - 10 * MINUTE) });

    expect(await t.close(request, behind)).toEqual(result);
    expect((await refusal(t.close(fresh, behind))).code).toBe("clock.behind_chain");
  });

  // Freezes today's business day, so it runs last.
  it("answers an exact replay once the day is frozen, and refuses new work on that day", async () => {
    const sameDay = t.depsWith({ clock: t.sameDayClock() });
    const { request, result } = await closedCounterBill(sameDay);
    const fresh = await t.requestFor(await t.counterOrder("placed"), "18.00", null);
    await t.freezeDay(result.businessDay);
    const before = await t.ledger();

    expect(await t.close(request, sameDay)).toEqual(result);
    const error = await refusal(t.close(fresh, sameDay));
    expect(error.code).toBe("deferred_close.day_frozen");
    expect(error.params).toEqual({ nodeId: t.venue.cfg.nodeId, businessDay: result.businessDay });
    expect(await t.ledger()).toEqual(before);
  });
});
