import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { workingOrders } from "@waitron/db";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import type { ReconcileDeps, SettlementRecord, SettlementReportSource } from "./reconcile.js";
import { insertCapturedPayment } from "./store.js";
import { listOpenHolds, recordHoldOutcome } from "./holds.js";
import { refreshHeldAlert } from "./held-alert.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const NOW = new Date("2026-07-25T12:00:00Z");
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/**
 * Two sweeps started together must reverse an orphan once. Their four transactions queue in
 * arrival order — A's T1, B's T1, A's T2, B's T2 — so both T1 reads see the unremediated orphan and
 * only `markReconcileRemediated`'s null-marker guard (store.ts) picks the winner. Weaker than its
 * name: it asserts the single-winner outcome and cannot observe one sweep waiting on the other.
 */
describe("concurrent reconcile sweeps", () => {
  it("reverse an orphan exactly once and raise one incident, however they interleave", async () => {
    const seeded = await seedWorkingOrder(suite.db, "B66666666");
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "race-1",
        externalRef: "ext-race-1",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    // Abandoned + no sale_id is the orphan shape: the sweep both reports it AND self-heals it.
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, seeded.workingOrderId));

    const reversed: string[] = [];
    const make = (db: Database): ReconcileDeps => ({
      db,
      provider: "fake",
      // Matches the local row exactly, so classify() fires only `orphan`, not also `unsettled`,
      // and this suite races the orphan reversal alone.
      report: new FakeSettlementReport([
        { references: ["ext-race-1"], amount: decimal("10.00"), settledAt: OLD_SETTLED },
      ]),
      reverse: async (ref) => {
        reversed.push(ref);
      },
      incidents: recordIncidentOnce,
      heldAlerts: {
        raise: recordIncidentOnce,
        current: currentIncidentsOf,
        handle: markIncidentHandled,
      },
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
    });

    // Both sweeps take the one handle a host can build; the queue, not this test, orders them.
    const [a, b] = await Promise.all([
      reconcilePayments(make(suite.db), PERIOD, NOW),
      reconcilePayments(make(suite.db), PERIOD, NOW),
    ]);

    // Both sweeps REPORT the orphan — the audit finding is not a claim on it. Only one stamped
    // the marker, so only one reversal was issued.
    expect(a.orphan).toHaveLength(1);
    expect(b.orphan).toHaveLength(1);
    expect(a.remediated + b.remediated).toBe(1);
    expect(reversed).toEqual(["race-1"]);

    // The open-incident dedup index is the arbiter for the incident: exactly one row, and
    // exactly one sweep counted it.
    const { rows } = await suite.db.execute<{ n: number; params: string }>(sql`
      select count(*) over () as n, params from incidents
      where code = 'payment.reconcile_orphan'
        and acknowledged_at is null`);
    // `count(*) over ()` returns no rows, not n = 0, when no incident matches.
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(1);
    // A raw `select` skips the json column's read mapping, so `params` arrives as TEXT.
    const params = JSON.parse(rows[0]!.params) as { payments: { remediation: string }[] };
    // The surviving incident is the WINNER's: the loser's T2 runs after the winner's has
    // committed, so its own `alreadyClaimed` insert is deduplicated away.
    expect(params.payments[0]!.remediation).toBe("claimed");
    expect(a.incidentsRaised + b.incidentsRaised).toBe(1);
  });

  it("write one hold for a drifted orphan, however they interleave", async () => {
    const seeded = await seedWorkingOrder(suite.db, "B77777777");
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "race-held",
        externalRef: "ext-race-held",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, seeded.workingOrderId));

    const reversed: string[] = [];
    const make = (db: Database): ReconcileDeps => ({
      db,
      provider: "fake",
      report: new FakeSettlementReport([
        { references: ["ext-race-held"], amount: decimal("12.50"), settledAt: OLD_SETTLED },
      ]),
      reverse: async (ref) => {
        reversed.push(ref);
      },
      incidents: recordIncidentOnce,
      heldAlerts: {
        raise: recordIncidentOnce,
        current: currentIncidentsOf,
        handle: markIncidentHandled,
      },
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
    });

    await Promise.all([
      reconcilePayments(make(suite.db), PERIOD, NOW),
      reconcilePayments(make(suite.db), PERIOD, NOW),
    ]);

    expect(reversed).toEqual([]);
    const { rows } = await suite.db.execute<{ provider_amount: number }>(
      sql`select provider_amount from payment_holds`,
    );
    expect(rows).toEqual([{ provider_amount: 1250 }]);
  });
});

/** A report whose `fetch` waits until released, so a sweep can be held between its T1 and T2. */
function gatedReport(records: SettlementRecord[]) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let entered!: () => void;
  const fetching = new Promise<void>((resolve) => (entered = resolve));
  const source: SettlementReportSource = {
    async fetch() {
      entered();
      await gate;
      return records;
    },
  };
  return { source, release, fetching };
}

/**
 * Sweep X reads its rows, then waits on its report while sweep Y runs to the end; then X finishes
 * from its earlier read. A payment must end either held and not claimed, or claimed and not held.
 */
describe("a sweep overtaken between its read and its writes", () => {
  const matching = (ref: string) => ({
    references: [`ext-${ref}`],
    amount: decimal("10.00"),
    settledAt: OLD_SETTLED,
  });
  const drifted = (ref: string) => ({ ...matching(ref), amount: decimal("12.50") });

  async function orphan(nif: string, ref: string) {
    const seeded = await seedWorkingOrder(suite.db, nif);
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: ref,
        externalRef: `ext-${ref}`,
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, seeded.workingOrderId));
  }

  async function overtake(ref: string, xRecords: SettlementRecord[], yRecords: SettlementRecord[]) {
    const reversed: string[] = [];
    const make = (report: SettlementReportSource): ReconcileDeps => ({
      db: suite.db,
      provider: "fake",
      report,
      reverse: async (ref) => {
        reversed.push(ref);
      },
      incidents: recordIncidentOnce,
      heldAlerts: {
        raise: recordIncidentOnce,
        current: currentIncidentsOf,
        handle: markIncidentHandled,
      },
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
    });
    const x = gatedReport(xRecords);
    const sweepX = reconcilePayments(make(x.source), PERIOD, NOW);
    await x.fetching;
    await reconcilePayments(make(new FakeSettlementReport(yRecords)), PERIOD, NOW);
    // So the orphan alert read below is the one X raises, not one Y left open.
    await suite.db.execute(sql`
      update incidents set acknowledged_at = ${NOW.toISOString()}
      where code = 'payment.reconcile_orphan' and acknowledged_at is null`);
    x.release();
    await sweepX;

    const holds = await suite.db.execute(sql`
      select h.id from payment_holds h join payments p on p.id = h.payment_id
      where p.payment_ref = ${ref}`);
    const claim = await suite.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = ${ref}`,
    );
    const alerts = await suite.db.execute<{ code: string; params: string }>(
      sql`select code, params from incidents where acknowledged_at is null`,
    );
    const named = (code: string) =>
      alerts.rows
        .filter((row) => row.code === code)
        .flatMap(
          (row) => (JSON.parse(row.params) as { payments: { paymentRef: string }[] }).payments,
        )
        .map((payment) => payment.paymentRef)
        .filter((named) => named === ref);
    return {
      held: holds.rows.length > 0,
      claimed: claim.rows[0]!.reconcile_remediated_at !== null,
      reversed,
      named,
    };
  }

  it("leaves the payment held and unclaimed when the overtaking sweep holds it", async () => {
    const ref = "race-overtaken-hold";
    await orphan("B88888888", ref);
    const end = await overtake(ref, [matching(ref)], [drifted(ref)]);
    expect(end).toMatchObject({ held: true, claimed: false, reversed: [] });
    expect(end.named("payment.reconcile_held")).toEqual([ref]);
    expect(end.named("payment.reconcile_orphan")).toEqual([]);
  });

  it("leaves the payment claimed and unheld when the overtaking sweep claims it", async () => {
    const ref = "race-overtaken-claim";
    await orphan("B99999999", ref);
    const end = await overtake(ref, [drifted(ref)], [matching(ref)]);
    expect(end).toMatchObject({ held: false, claimed: true, reversed: [ref] });
    expect(end.named("payment.reconcile_held")).toEqual([]);
    expect(end.named("payment.reconcile_orphan")).toEqual([ref]);
  });
});

/** A manager records a held payment's outcome while a sweep that read it as unresolved is waiting
 * on its report; the sweep's writes must not bring the payment back. */
describe("an outcome recorded while a sweep fetches its report", () => {
  const ref = "race-outcome";
  const drifted = { references: [`ext-${ref}`], amount: decimal("12.50"), settledAt: OLD_SETTLED };
  const heldAlerts = {
    raise: recordIncidentOnce,
    current: currentIncidentsOf,
    handle: markIncidentHandled,
  };
  const reversed: string[] = [];
  const make = (report: SettlementReportSource): ReconcileDeps => ({
    db: suite.db,
    provider: "fake",
    report,
    reverse: async (paymentRef) => {
      reversed.push(paymentRef);
    },
    incidents: recordIncidentOnce,
    heldAlerts,
    settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
  });

  async function sweepRacingAnOutcome(nif: string, records: SettlementRecord[]) {
    await suite.db.execute(sql`delete from incidents`);
    reversed.length = 0;
    const seeded = await seedWorkingOrder(suite.db, nif);
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: ref,
        externalRef: `ext-${ref}`,
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    await suite.db
      .update(workingOrders)
      .set({ status: "abandoned" })
      .where(eq(workingOrders.id, seeded.workingOrderId));
    await reconcilePayments(make(new FakeSettlementReport([drifted])), PERIOD, NOW);
    const [hold] = await withTransaction(suite.db, (tx) => listOpenHolds(tx));

    const x = gatedReport(records);
    const sweep = reconcilePayments(make(x.source), PERIOD, NOW);
    await x.fetching;
    const personId = "22222222-2222-4222-8222-222222222222";
    await withTransaction(suite.db, async (tx) => {
      await recordHoldOutcome(tx, {
        holdId: hold!.holdId,
        outcome: "kept",
        note: null,
        personId,
        at: NOW,
      });
      await refreshHeldAlert(tx, heldAlerts, { now: NOW, by: personId });
    });
    x.release();
    const result = await sweep;
    const open = await suite.db.execute<{ code: string }>(
      sql`select code from incidents where acknowledged_at is null`,
    );
    const claim = await suite.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = ${ref}`,
    );
    return {
      result,
      openCodes: open.rows.map((row) => row.code),
      claimed: claim.rows[0]!.reconcile_remediated_at !== null,
    };
  }

  it("raises nothing for it when the report omits its settlement", async () => {
    const end = await sweepRacingAnOutcome("B12121212", []);
    expect(end.openCodes).toEqual([]);
    expect(end.result.unsettled).toEqual([]);
    expect(end.result.orphan).toEqual([]);
    expect(end.result.drift).toEqual([]);
    expect(end.claimed).toBe(false);
    expect(reversed).toEqual([]);
  });

  it("leaves it out of every finding when the report includes its settlement", async () => {
    const end = await sweepRacingAnOutcome("B13131313", [drifted]);
    expect(end.openCodes).toEqual([]);
    expect(end.result.unsettled).toEqual([]);
    expect(end.result.orphan).toEqual([]);
    expect(end.result.drift).toEqual([]);
    expect(end.result.missingLocal).toEqual([]);
    expect(end.claimed).toBe(false);
    expect(reversed).toEqual([]);
  });
});
