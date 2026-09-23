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
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired — the same
 * fixture reconcile.test.ts already uses, so the orphan shape below is not
 * an artifact of a boundary this suite happens to dodge. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/**
 * `reconcilePayments`'s single-winner guarantee for an orphan rests on TWO independent primitives:
 * `markReconcileRemediated`'s state-guarded UPDATE (store.ts, matches only a row whose
 * `reconcile_remediated_at` is still NULL) and `recordIncidentOnce`'s partial unique index on
 * `(till_id, code, <sale_id or ''>) WHERE acknowledged_at IS NULL` (@waitron/core). Every other
 * proof of either primitive runs a single sweep (reconcile.test.ts) or raises bare store calls in
 * turn. None of them proves the thing that actually matters in production: two independent,
 * unsynchronised SCHEDULER RUNS of the whole `reconcilePayments` sweep landing on the same orphan.
 * A regression here — either primitive losing its single-winner property, or a future refactor
 * moving the marker stamp after the reversal, or reordering claim-then-raise inside T2 — would
 * surface as a SECOND `reverse()` call: a real customer's card refunded twice, with two open
 * incidents nobody would think to cross-reference.
 *
 * ## What changed with the engine, and what the race is now
 *
 * This suite used to take two `pg.connect()` handles, which were two backend PROCESSES, and let
 * PostgreSQL serialise the conflicting UPDATE/INSERT statements the two sweeps issued against the
 * same row. There is one connection per venue file here and no row locks, so both sweeps run on
 * the one handle and the venue file's write queue is what keeps their transactions apart
 * (`packages/store/src/write-queue.ts`, which issues `begin immediate`, awaits the body, then
 * `commit`s).
 *
 * **The interleaving the suite needs survives that, and it is not an accident of timing.** Each
 * sweep is T1 (read the reconcilable rows) then T2 (claim, reverse, raise), each its own
 * transaction. `Promise.all` starts both sweeps in the same tick, so their four transactions go
 * onto one queue in arrival order — A's T1, B's T1, A's T2, B's T2 — and B's T1 snapshot is
 * therefore taken BEFORE A's T2 has stamped anything. That is exactly the shape the old version
 * arranged with two backends: both sweeps see the unremediated orphan, and only
 * `markReconcileRemediated`'s `isNull` guard decides the winner. `listReconcilable` (T1)
 * deliberately does not filter already-remediated rows, which is what leaves that guard as the
 * only arbiter.
 *
 * LOSS, stated rather than left to be noticed: this can no longer distinguish "the loser was made
 * to WAIT on the winner's row lock" from "the loser ran afterwards". Nothing observes waiting here
 * and nothing can. What it still discriminates is the single-winner outcome, and the proof by
 * deletion at the end of this comment is the receipt for that.
 *
 * Proof by deletion, 2026-09-22: with `isNull(payments.reconcileRemediatedAt)` removed from
 * `markReconcileRemediated`'s `where` (store.ts) and nothing else changed, this case fails on
 * `expect(a.remediated + b.remediated).toBe(1)` — `expected 2 to be 1`. Both sweeps claimed, which
 * is also the receipt that B's T1 snapshot really is taken before A's T2 stamps: if the two sweeps
 * were not interleaved that way, B would have had nothing to claim and the count would have been
 * 1 with the guard gone too. The guard was restored immediately. Command:
 * `pnpm --filter @waitron/payments exec vitest run src/reconcile.concurrency.test.ts`.
 *
 * The settlement report below deliberately MATCHES the local row (same reference, same amount) —
 * the shape reconcile.test.ts's own orphan-remediation tests use, `auto-reverses an orphan on an
 * ABANDONED order and stamps the marker` among them, against this same OLD_SETTLED/PERIOD fixture.
 * A report that does NOT mention the reference makes the row genuinely BOTH `orphan` and
 * `unsettled` (classify()'s classes are independent predicates, not a switch). Reusing that shape
 * here would race TWO independent single-winner incident codes at once and dilute this suite's one
 * job: isolating the orphan-reversal race alone.
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
      nodeId: "11111111-1111-4111-8111-111111111111", // origin irrelevant here (proven in server suite)
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
    // exactly one sweep counted it. The predicate names the index the assertion actually
    // arbitrates — `incidents_open_dedup` is PARTIAL on `acknowledged_at IS NULL`, so counting
    // without it would still pass if a future change (e.g. auto-acknowledging one of the two
    // insert attempts) let a second row slip in unacknowledged-then-immediately-closed.
    const { rows } = await suite.db.execute<{ n: number; params: string }>(sql`
      select count(*) over () as n, params from incidents
      where code = 'payment.reconcile_orphan'
        and acknowledged_at is null`);
    // `count(*) over ()` returns ZERO rows (not one row with n = 0) when no incident matches, so
    // this guards the failure mode explicitly: without it, a regression that raised no orphan
    // incident at all would throw `Cannot read properties of undefined` on the next line instead
    // of failing cleanly on the count assertion this suite exists to make.
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.n)).toBe(1);
    // `params` arrives as the stored TEXT, not as an object: a raw `select` skips the json column's
    // read mapping that `incidents.params` declares (`packages/db/src/schema/incidents.ts`), so it
    // is parsed here. The PostgreSQL version read it as an object because `jsonb` decoded in the
    // driver.
    const params = JSON.parse(rows[0]!.params) as { payments: { remediation: string }[] };
    // The surviving incident is the WINNER's. The loser's T2 runs after the winner's has
    // committed — incident and all — so its own `alreadyClaimed` insert is deduplicated away. If a
    // future change let the loser's incident win instead, a human would read "another sweep owns
    // this" about the sweep that is actually doing the reversal.
    expect(params.payments[0]!.remediation).toBe("claimed");
    expect(a.incidentsRaised + b.incidentsRaised).toBe(1);
  });
});
