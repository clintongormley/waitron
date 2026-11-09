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
import { readTransferClosure } from "./transfer-close.js";
import type { CloseByTransferRequest } from "./transfer-close-types.js";
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
  RECIPIENT,
  clockAt,
  refusal,
  transferCloseVenue,
  type TransferCloseKit,
} from "./testing/transfer-close-fixture.js";
import "./errors.js";

// Strict replay of a close by transfer (A275 Task 2): the same operation answers with what it
// answered first, and anything that is not the same request is refused before it writes.
let t: TransferCloseKit;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await transferCloseVenue(db);
  },
});

const MINUTE = 60_000;

function recorded() {
  const facts: Parameters<AttendanceRecorder>[1][] = [];
  const attendance: AttendanceRecorder = (_tx, fact) => {
    facts.push(fact);
    return Promise.resolve();
  };
  return { facts, attendance };
}

function closures(billId: string) {
  return t.venue.db.all(sql`select id from transfer_closures where working_order_id = ${billId}`);
}

async function closedCounterBill() {
  const billId = await t.counterOrder("placed");
  const request = await t.requestFor(billId, "18.00", null);
  const result = await t.close(request);
  return { billId, request, result };
}

/** A table bill staged as an F1 to be emailed, closed; with `twoBills`, its party holds another. */
async function closedStagedF1(twoBills = false) {
  const party = await seatedWith(t.venue, "Ensalada");
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

const changes: [string, (request: CloseByTransferRequest) => CloseByTransferRequest][] = [
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

describe("closeBillByTransferTx, replay", () => {
  it("answers an exact replay with the stored result and writes nothing more", async () => {
    const { facts, attendance } = recorded();
    const billId = await t.counterOrder("placed");
    const request = await t.requestFor(billId, "18.00", null);
    const result = await t.close(request, t.depsWith({ attendance }));
    const recordedFirst = facts.length;
    const before = t.ledger();

    const again = await t.close(request, t.depsWith({ attendance }));

    expect(again).toEqual(result);
    expect(t.ledger()).toEqual(before);
    expect(facts).toHaveLength(recordedFirst);
    expect(fiscalRecordCount(t.venue, billId)).toBe(1);
    expect(await tendersOfBill(t.venue, billId)).toHaveLength(1);
    expect(closures(billId)).toEqual([{ id: request.operationId }]);
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
    const before = t.ledger();

    const again = await t.close(
      request,
      t.depsWith({ backend, clock, admission: testTradingAdmission() }),
    );

    expect(again).toEqual(result);
    expect(t.ledger()).toEqual(before);
  });

  it("answers a replay whose first answer was lost with what was kept", async () => {
    const billId = await t.counterOrder("placed");
    const request = await t.requestFor(billId, "18.00", null);
    await t.close(request);
    const kept = await inTx(t.venue, (tx) => readTransferClosure(tx, billId));

    expect(await t.close(request)).toEqual(kept);
    expect(closures(billId)).toHaveLength(1);
  });

  it("treats spelling differences of the same request as the same request", async () => {
    const { party, request, result } = await closedStagedF1(true);
    const [first, ...rest] = request.partyFinish!.expectedEdits;
    expect(rest).toHaveLength(1);
    const respelled: CloseByTransferRequest = {
      ...request,
      id: request.id.toUpperCase(),
      operationId: request.operationId.toUpperCase(),
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
    expect(await t.close({ ...respelled, operationId: randomUUID() })).toEqual(result);
  });

  it.each(changes)("refuses the same operation id with a changed %s", async (_name, change) => {
    const { request } = await closedStagedF1();
    const before = t.ledger();

    const error = await refusal(t.close(change(request)));

    expect(error.code).toBe("submission.id_reused");
    expect(error.params).toEqual({ submissionId: request.operationId });
    expect(t.ledger()).toEqual(before);
  });

  it.each(changes)(
    "refuses another operation id on a closed bill with a changed %s",
    async (_name, change) => {
      const { request } = await closedStagedF1();
      const before = t.ledger();

      const error = await refusal(t.close({ ...change(request), operationId: randomUUID() }));

      expect(error.code).toBe("transfer_close.conflict");
      expect(error.params).toEqual({ workingOrderId: request.id });
      expect(t.ledger()).toEqual(before);
    },
  );

  it("answers another operation id on a closed bill with the stored result when nothing else differs", async () => {
    const { billId, request, result } = await closedCounterBill();

    const again = await t.close({ ...request, operationId: randomUUID() });

    expect(again).toEqual(result);
    expect(closures(billId)).toEqual([{ id: request.operationId }]);
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

  it("refuses an operation id already used on another bill", async () => {
    const { request } = await closedCounterBill();
    const otherBill = await t.counterOrder("placed");
    const before = t.ledger();

    const error = await refusal(
      t.close(await t.requestFor(otherBill, "18.00", null, { operationId: request.operationId })),
    );

    expect(error.code).toBe("submission.id_reused");
    expect(error.params).toEqual({ submissionId: request.operationId });
    expect(t.ledger()).toEqual(before);
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
    const { request, result } = await closedCounterBill();
    const fresh = await t.requestFor(await t.counterOrder("placed"), "18.00", null);
    await t.freezeDay(result.businessDay);
    const before = t.ledger();

    expect(await t.close(request)).toEqual(result);
    const error = await refusal(t.close(fresh));
    expect(error.code).toBe("transfer_close.day_frozen");
    expect(error.params).toEqual({ nodeId: t.venue.cfg.nodeId, businessDay: result.businessDay });
    expect(t.ledger()).toEqual(before);
  });
});
