import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { workingOrders } from "@waitron/db";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import type { ReconcileDeps } from "./reconcile.js";
import { insertCapturedPayment } from "./store.js";
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
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
      nodeId: "11111111-1111-4111-8111-111111111111",
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
});
