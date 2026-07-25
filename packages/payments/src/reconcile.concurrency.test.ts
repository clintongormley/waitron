import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { decimal, tenantId as brandTenantId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { withTenant } from "@waitron/db";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import type { ReconcileDeps } from "./reconcile.js";
import { insertCapturedPayment } from "./store.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { seedWorkingOrder } from "../test/seed.js";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});

afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const NOW = new Date("2026-07-25T12:00:00Z");
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired — the same
 * fixture reconcile.test.ts / reconcile.rls.test.ts already use, so the orphan shape below is not
 * an artifact of a boundary this suite happens to dodge. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/**
 * `reconcilePayments`'s single-winner guarantee for an orphan rests on TWO independent primitives:
 * `markReconcileRemediated`'s state-guarded UPDATE (store.ts, matches only a row whose
 * `reconcile_remediated_at` is still NULL) and `recordIncidentOnce`'s partial unique index on
 * `(tenant_id, till_id, code, sale_id) WHERE acknowledged_at IS NULL` (@waitron/core). Every
 * existing proof of either primitive runs a single sweep (reconcile.test.ts,
 * reconcile.rls.test.ts) or races bare store calls against each other by hand
 * (incident-dedup.concurrency.test.ts, reversal.concurrency.test.ts). None of them proves the thing
 * that actually matters in production: two independent, unsynchronised SCHEDULER RUNS of the whole
 * `reconcilePayments` sweep landing on the same orphan at once. A regression here — either
 * primitive losing its single-winner property, or a future refactor moving the marker stamp after
 * the reversal, or reordering claim-then-raise inside T2 — would surface as a SECOND `reverse()`
 * call: a real customer's card refunded twice, with two open incidents nobody would think to
 * cross-reference. This suite is what stands between that class of bug and a merge.
 *
 * The race has to be genuine, not simulated: two separate `pg.connect()` handles are two separate
 * backend processes, so Postgres itself — not this test's code — serialises the conflicting
 * UPDATE/INSERT statements the two concurrent sweeps issue against the same row. `Promise.all`
 * starts both full sweeps together and lets Postgres decide who wins; every assertion below checks
 * only that exactly one of them did, never which.
 *
 * The settlement report below deliberately MATCHES the local row (same reference, same amount),
 * unlike reconcile.rls.test.ts's empty report against this same OLD_SETTLED/PERIOD fixture. That
 * empty-report shape is correct there — it exists specifically to prove the row is genuinely BOTH
 * `orphan` and `unsettled` (classify()'s classes are independent predicates, not a switch) and to
 * exercise the extra incidents-table grant a second class needs. Reusing it here would race TWO
 * independent single-winner incident codes at once and dilute this suite's one job: isolating the
 * orphan-reversal race alone, exactly as reconcile.test.ts's own orphan-remediation tests do with a
 * matching `settlement()`.
 */
describe("concurrent reconcile sweeps", () => {
  it("reverse an orphan exactly once and raise one incident, however they interleave", async () => {
    const seeded = await seedWorkingOrder(admin, "B66666666");
    await withTenant(admin, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "race-1",
        externalRef: "ext-race-1",
        amount: decimal("10.00"),
        settledAt: OLD_SETTLED,
      }),
    );
    // Abandoned + no sale_id is the orphan shape: the sweep both reports it AND self-heals it.
    await admin.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    const one = await pg.connect();
    const two = await pg.connect();
    const reversed: string[] = [];
    const make = (db: Database): ReconcileDeps => ({
      db,
      provider: "fake",
      // Matches the local row exactly (reference + amount), so it settles cleanly and classify()
      // fires ONLY `orphan` — not also `unsettled` — for the reason explained above.
      report: new FakeSettlementReport([
        { references: ["ext-race-1"], amount: decimal("10.00"), settledAt: OLD_SETTLED },
      ]),
      reverse: async (ref) => {
        reversed.push(ref);
      },
      incidents: recordIncidentOnce,
      settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
    });

    try {
      const [a, b] = await Promise.all([
        reconcilePayments(make(one), brandTenantId(seeded.tenantId), PERIOD, NOW),
        reconcilePayments(make(two), brandTenantId(seeded.tenantId), PERIOD, NOW),
      ]);

      // Both sweeps REPORT the orphan — the audit finding is not a claim on it. Only one stamped
      // the marker, so only one reversal was issued.
      expect(a.orphan).toHaveLength(1);
      expect(b.orphan).toHaveLength(1);
      expect(a.remediated + b.remediated).toBe(1);
      expect(reversed).toEqual(["race-1"]);

      // The open-incident dedup index is the arbiter for the incident: exactly one row, and
      // exactly one sweep counted it. The predicate names the index the assertion actually
      // arbitrates — `incidents_open_dedup` is PARTIAL on `acknowledged_at IS NULL`, so counting
      // without it would still pass if a future change (e.g. auto-acknowledging one of the two
      // insert attempts) let a second row slip in unacknowledged-then-immediately-closed.
      //
      // The race itself is genuine, not an artifact of this test's own timing: `listReconcilable`
      // (T1) deliberately does NOT filter out already-remediated rows, so both sweeps' T1 snapshots
      // are taken before either reaches T2, and only `markReconcileRemediated`'s state-guarded
      // UPDATE — which genuinely contends on the row lock at the database level — decides the
      // winner. If a future change added a pre-filter (or an advisory lock) that serialised the two
      // sweeps instead, every assertion here would stay green while the thing this suite exists to
      // prove — the DB-level `isNull` guard under real concurrent contention — went untested.
      const { rows } = await admin.execute<{ n: string }>(sql`
        select count(*) as n from incidents
        where tenant_id = ${seeded.tenantId} and code = 'payment.reconcile_orphan'
          and acknowledged_at is null`);
      expect(Number(rows[0].n)).toBe(1);
      expect(a.incidentsRaised + b.incidentsRaised).toBe(1);
    } finally {
      // `reconcilePayments` owns its own transaction boundaries internally — T1 and T2 each commit
      // before the call returns — so neither `one` nor `two` can be left mid-transaction by the
      // race itself. Closing unconditionally here is what keeps a genuine regression (the invariant
      // above breaking) a clean assertion failure rather than a hung suite: see this package's own
      // incident-dedup.concurrency.test.ts for the shape of a race that DOES hold a transaction
      // open, and where its release lives.
      await one.close();
      await two.close();
    }
  });
});
