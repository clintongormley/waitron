import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { reconcilePayments, DEFAULT_SETTLEMENT_LAG_MS } from "./reconcile.js";
import type { ReconcileDeps, SettlementRecord } from "./reconcile.js";
import {
  insertAcceptedOffline,
  insertCapturedPayment,
  insertInitiated,
  settleForwarded,
} from "./store.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";
import type { Seeded } from "../test/seed.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

// Child before parent: deleting `payments` while a `payment_refunds` row still points at it is
// refused with `FOREIGN KEY constraint failed`.
beforeEach(async () => {
  await pg.db.execute(sql`delete from incidents`);
  await pg.db.execute(sql`delete from payment_refunds`);
  await pg.db.execute(sql`delete from payments`);
});

/** A raw `select` skips the json column's read mapping, so `incidents.params` arrives as TEXT. */
function parseParams<T, R extends { params: string } = { params: string }>(result: {
  rows: R[];
}): { rows: (Omit<R, "params"> & { params: T })[] } {
  return {
    rows: result.rows.map(({ params, ...rest }) => ({
      ...rest,
      params: JSON.parse(params) as T,
    })),
  };
}

const PROVIDER = "fake";
const NOW = new Date("2026-07-25T12:00:00Z");
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

function recordingReverse() {
  const calls: string[] = [];
  const fn = async (paymentRef: string): Promise<void> => {
    calls.push(paymentRef);
  };
  return { calls, fn };
}

function deps(report: FakeSettlementReport, reverse = recordingReverse().fn): ReconcileDeps {
  return {
    db: pg.db,
    provider: PROVIDER,
    report,
    reverse,
    incidents: recordIncidentOnce,
    settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
    nodeId: "11111111-1111-4111-8111-111111111111",
  };
}

async function capture(seeded: Seeded, paymentRef: string, externalRef: string, amount = "10.00") {
  await withTransaction(pg.db, (tx) =>
    insertCapturedPayment(tx, {
      workingOrderId: seeded.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      externalRef,
      amount: decimal(amount),
      settledAt: OLD_SETTLED,
    }),
  );
}

/** Drives a payment to state `settled` the only way the state machine permits: an offline-accepted
 * tender that a later `forward()` pass cleared. `settled` is auditable (so it reaches the orphan
 * class) but has no reversal path, which is exactly what the claim gate has to respect. */
async function forwardedOffline(seeded: Seeded, paymentRef: string, externalRef: string) {
  await withTransaction(pg.db, async (tx) => {
    await insertAcceptedOffline(tx, {
      workingOrderId: seeded.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      externalRef,
      amount: decimal("10.00"),
      settledAt: OLD_SETTLED,
    });
    await settleForwarded(tx, { provider: PROVIDER, paymentRef });
  });
}

/** Seeds a second till, node and open working order at the same location as `seeded`. */
async function seedSecondTill(seeded: Seeded): Promise<Seeded> {
  const [till] = (
    await pg.db.execute<{ location_id: string }>(
      sql`select location_id from tills where id = ${seeded.tillId}`,
    )
  ).rows;
  // A raw insert runs no drizzle `$defaultFn`, so `id` and the timestamps are supplied by hand.
  const stamp = new Date().toISOString();
  const till2 = await pg.db.execute<{ id: string }>(sql`
    insert into tills (id, location_id, name, created_at)
    values (${randomUUID()}, ${till.location_id}, 'Till 2', ${stamp}) returning id`);
  const tillId = till2.rows[0].id;
  const node2 = await pg.db.execute<{ id: string }>(sql`
    insert into nodes (id, location_id, name, created_at)
    values (${randomUUID()}, ${till.location_id}, 'Node 2', ${stamp}) returning id`);
  const wo2 = await pg.db.execute<{ id: string }>(sql`
    insert into working_orders (id, till_id, order_number, opened_at)
    values (${randomUUID()}, ${tillId}, 1, ${stamp}) returning id`);
  return {
    tillId,
    nodeId: node2.rows[0].id,
    workingOrderId: wo2.rows[0].id,
  };
}

async function openIncidentCodes(): Promise<string[]> {
  const { rows } = await pg.db.execute<{ code: string }>(
    sql`select code from incidents order by code`,
  );
  return rows.map((r) => r.code);
}

function settlement(over: Partial<SettlementRecord> = {}): SettlementRecord {
  return { references: ["ext-1"], amount: decimal("10.00"), settledAt: OLD_SETTLED, ...over };
}

describe("reconcilePayments", () => {
  it("answers all-empty for a tenant with nothing to check", async () => {
    const result = await reconcilePayments(deps(new FakeSettlementReport([])), PERIOD, NOW);
    expect(result).toMatchObject({
      checked: 0,
      unsettled: [],
      lostSettlement: [],
      orphan: [],
      missingLocal: [],
      drift: [],
      incidentsRaised: 0,
      remediated: 0,
    });
  });

  it("reports a clean, fully-settled period with no incidents", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      PERIOD,
      NOW,
    );
    expect(result.checked).toBe(1);
    expect(result.incidentsRaised).toBe(0);
    expect(await openIncidentCodes()).toEqual([]);
  });

  it("raises one aggregated unsettled incident covering every stale payment on the till", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    // Not associated with a sale, and the working order stays "open", so these two rows are
    // unsettled only, never orphans.
    const result = await reconcilePayments(deps(new FakeSettlementReport([])), PERIOD, NOW);
    expect(result.unsettled).toHaveLength(2);
    expect(result.incidentsRaised).toBe(1);
    const { rows } = parseParams<{
      count: number;
      payments: { paymentRef: string; settledAt: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_unsettled'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].params.count).toBe(2);
    expect(rows[0].params.payments.map((p) => p.settledAt)).toEqual([
      OLD_SETTLED.toISOString(),
      OLD_SETTLED.toISOString(),
    ]);
  });

  it("aggregates per (till, class), not per class alone — two tills stay two incidents", async () => {
    // A single-till fixture cannot tell the `${tillId}|${klass}` grouping key from a bare `klass`.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    const second = await seedSecondTill(seeded);
    await capture(seeded, "p1", "ext-1");
    await capture(second, "p2", "ext-2", "20.00");
    const result = await reconcilePayments(deps(new FakeSettlementReport([])), PERIOD, NOW);
    expect(result.unsettled).toHaveLength(2);
    expect(result.incidentsRaised).toBe(2);
    // Both type arguments: once one is written TypeScript stops inferring `R`, which would leave
    // `till_id` off the row.
    const { rows } = parseParams<{ count: number }, { till_id: string; params: string }>(
      await pg.db.execute<{ till_id: string; params: string }>(
        sql`select till_id, params from incidents where code = 'payment.reconcile_unsettled' order by till_id`,
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.till_id).sort()).toEqual([seeded.tillId, second.tillId].sort());
    expect(rows.every((r) => r.params.count === 1)).toBe(true);
  });

  it("does not re-count an incident a second sweep re-detects", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const d = deps(new FakeSettlementReport([]));
    const first = await reconcilePayments(d, PERIOD, NOW);
    const second = await reconcilePayments(d, PERIOD, NOW);
    expect(first.incidentsRaised).toBe(1);
    // Still reported as a mismatch — the audit finding is always reported — but the open incident
    // already exists, so nothing new was inserted.
    expect(second.unsettled).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0);
  });

  it("classifies a differing settled amount as drift and raises its incident", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("9.00") })])),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({ localAmount: "10.00", settledAmount: "9.00" });
    expect(await openIncidentCodes()).toEqual(["payment.reconcile_drift"]);
    const { rows } = parseParams<{
      count: number;
      payments: { paymentRef: string; captured: string; settled: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_drift'`,
      ),
    );
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p1", captured: "10.00", settled: "9.00" }],
    });
  });

  it("classifies an initiated row the report settled as lostSettlement", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await withTransaction(pg.db, (tx) =>
      insertInitiated(tx, {
        workingOrderId: seeded.workingOrderId,
        provider: PROVIDER,
        paymentRef: "p-init",
        amount: decimal("10.00"),
        externalRef: "ext-1",
      }),
    );
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      now,
      NOW,
    );
    expect(result.lostSettlement).toHaveLength(1);
    expect(await openIncidentCodes()).toEqual(["payment.reconcile_lost_settlement"]);
    const { rows } = parseParams<{
      count: number;
      payments: { paymentRef: string; amount: string; workingOrderId: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_lost_settlement'`,
      ),
    );
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p-init", amount: "10.00", workingOrderId: seeded.workingOrderId }],
    });
  });

  it("reports an unattributable missingLocal WITHOUT raising an incident", async () => {
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ references: ["ext-ghost"] })])),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0]).toMatchObject({ paymentRef: null, references: ["ext-ghost"] });
    expect(result.incidentsRaised).toBe(0);
    expect(await openIncidentCodes()).toEqual([]);
  });

  it("raises an incident for a missingLocal the processor attributed via a hint", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement({
            references: ["ext-ghost"],
            hint: { workingOrderId: seeded.workingOrderId, paymentRef: "p-lost" },
          }),
        ]),
      ),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.incidentsRaised).toBe(1);
    expect(await openIncidentCodes()).toEqual(["payment.reconcile_missing_local"]);
    const { rows } = parseParams<{
      count: number;
      settlements: {
        references: string[];
        amount: string;
        settledAt: string;
        paymentRef: string;
      }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_missing_local'`,
      ),
    );
    expect(rows[0].params).toEqual({
      count: 1,
      settlements: [
        {
          references: ["ext-ghost"],
          amount: "10.00",
          settledAt: OLD_SETTLED.toISOString(),
          paymentRef: "p-lost",
        },
      ],
    });
  });

  it("resolves each missingLocal candidate independently — one settlement's existing row must not clear another's", async () => {
    // The existence check is one batched query: a non-empty answer must not clear every candidate.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    // ext-2's local row settled outside PERIOD; the existence check is unbounded by period.
    await withTransaction(pg.db, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: seeded.workingOrderId,
        provider: PROVIDER,
        paymentRef: "p-elsewhere",
        externalRef: "ext-2",
        amount: decimal("10.00"),
        settledAt: new Date("2026-06-15T12:00:00Z"),
      }),
    );
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement({ references: ["ext-1"] }),
          settlement({ references: ["ext-2"] }),
        ]),
      ),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0]).toMatchObject({ references: ["ext-1"] });
  });

  it("does not call a settlement missingLocal when a local row exists outside the period", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    // A period that excludes the payment entirely, while the report still carries its settlement.
    const elsewhere = {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      elsewhere,
      NOW,
    );
    expect(result.checked).toBe(0);
    expect(result.missingLocal).toEqual([]);
  });

  it("fetches the report even when there are no local rows at all", async () => {
    const report = new FakeSettlementReport([settlement({ references: ["ext-ghost"] })]);
    await reconcilePayments(deps(report), PERIOD, NOW);
    expect(report.windows).toHaveLength(1);
  });

  it("fetches the report over a window widened by the settlement lag", async () => {
    const report = new FakeSettlementReport([]);
    await reconcilePayments(deps(report), PERIOD, NOW);
    expect(report.windows[0].from).toEqual(PERIOD.from);
    expect(report.windows[0].to).toEqual(new Date(PERIOD.to.getTime() + DEFAULT_SETTLEMENT_LAG_MS));
  });
});

/** Associates a payment with a freshly-seeded sale, so it is not an orphan. */
async function associate(seeded: Seeded, paymentRef: string): Promise<void> {
  const saleId = await seedSale(pg.db, seeded);
  await pg.db.execute(sql`
    update payments set sale_id = ${saleId}
    where payment_ref = ${paymentRef}`);
}

/** `settled` also needs `settled_at` (the biconditional CHECK `working_orders_settled_at_ck`);
 * `abandoned` must leave it null. */
async function setOrderStatus(seeded: Seeded, status: "settled" | "abandoned"): Promise<void> {
  await pg.db.execute(sql`
    update working_orders
    set status = ${status}, settled_at = ${status === "settled" ? new Date().toISOString() : null}
    where id = ${seeded.workingOrderId}`);
}

describe("orphan remediation", () => {
  it("auto-reverses an orphan on an ABANDONED order and stamps the marker", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    const { rows } = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).not.toBeNull();
    const incident = parseParams<{
      count: number;
      payments: {
        paymentRef: string;
        amount: string;
        workingOrderId: string;
        workingOrderStatus: string;
        remediation: string;
      }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_orphan'`,
      ),
    );
    expect(incident.rows[0].params).toEqual({
      count: 1,
      payments: [
        {
          paymentRef: "p1",
          amount: "10.00",
          workingOrderId: seeded.workingOrderId,
          workingOrderStatus: "abandoned",
          remediation: "claimed",
        },
      ],
    });
  });

  it("stamps the marker BEFORE calling reverse, never after", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    // Reads the marker at call time: a stamp moved after the network call would read null here.
    const markersAtCallTime: (string | null)[] = [];
    const reverse = async (paymentRef: string): Promise<void> => {
      const { rows } = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
        sql`select reconcile_remediated_at from payments where payment_ref = ${paymentRef}`,
      );
      markersAtCallTime.push(rows[0]?.reconcile_remediated_at ?? null);
    };
    await reconcilePayments(deps(new FakeSettlementReport([settlement()]), reverse), PERIOD, NOW);
    expect(markersAtCallTime).toHaveLength(1);
    expect(markersAtCallTime[0]).not.toBeNull();
  });

  it("does NOT reverse an orphan on a SETTLED order — it reports and raises only", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "settled");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(reverse.calls).toEqual([]);
    expect(await openIncidentCodes()).toEqual(["payment.reconcile_orphan"]);
    const { rows } = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
    const incident = parseParams<{
      payments: { workingOrderStatus: string; remediation: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_orphan'`,
      ),
    );
    expect(incident.rows[0].params.payments).toEqual([
      {
        paymentRef: "p1",
        amount: "10.00",
        workingOrderId: seeded.workingOrderId,
        workingOrderStatus: "settled",
        remediation: "workingOrderNotAbandoned",
      },
    ]);
  });

  it("does NOT claim a SETTLED-state orphan on an abandoned order — nothing can reverse it", async () => {
    // An offline-accepted tender forwarded to `settled`, on an abandoned order: the working-order
    // gate alone would claim it.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await forwardedOffline(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0]).toMatchObject({ paymentRef: "p1", localState: "settled" });
    expect(result.remediated).toBe(0);
    expect(result.remediationFailures).toEqual([]);
    expect(reverse.calls).toEqual([]);
    expect(await openIncidentCodes()).toEqual(["payment.reconcile_orphan"]);
    const incident = parseParams<{ payments: { remediation: string }[] }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_orphan'`,
      ),
    );
    expect(incident.rows[0].params.payments[0].remediation).toBe("stateNotCaptured");
    const { rows } = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
  });

  it("reverses each orphan at most once, however many sweeps run", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const d = deps(new FakeSettlementReport([settlement()]), reverse.fn);
    await reconcilePayments(d, PERIOD, NOW);
    const second = await reconcilePayments(d, PERIOD, NOW);
    // Still REPORTED — the audit finding never disappears — but not reversed again.
    expect(second.orphan).toHaveLength(1);
    expect(second.remediated).toBe(0);
    expect(reverse.calls).toEqual(["p1"]);
  });

  it("raises a remediation-failed incident when the processor refuses the reversal", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const refusing = async (): Promise<void> => {
      throw new AppError("payment.not_refundable", { paymentRef: "p1", state: "refunded" });
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), refusing),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(0);
    expect(result.remediationFailures).toEqual([
      { paymentRef: "p1", reason: "payment.not_refundable" },
    ]);
    // One orphan aggregate + one remediation-failed aggregate.
    expect(result.incidentsRaised).toBe(2);
    expect(await openIncidentCodes()).toEqual([
      "payment.reconcile_orphan",
      "payment.reconcile_remediation_failed",
    ]);
    const { rows } = parseParams<{
      count: number;
      payments: { paymentRef: string; amount: string; reason: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p1", amount: "10.00", reason: "payment.not_refundable" }],
    });
    // The marker is stamped even on failure, so this is not retried every sweep.
    const marker = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(marker.rows[0].reconcile_remediated_at).not.toBeNull();
  });

  it("reports a non-AppError reversal failure with an unknown reason and keeps sweeping", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    await setOrderStatus(seeded, "abandoned");
    const calls: string[] = [];
    const flaky = async (paymentRef: string): Promise<void> => {
      calls.push(paymentRef);
      if (paymentRef === "p1") throw new Error("socket hang up");
    };
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement(),
          settlement({ references: ["ext-2"], amount: decimal("20.00") }),
        ]),
        flaky,
      ),
      PERIOD,
      NOW,
    );
    // One failure does not abort the pass: p2 was still reversed.
    expect(calls).toEqual(["p1", "p2"]);
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([{ paymentRef: "p1", reason: "unknown" }]);
    // One orphan aggregate (both p1 and p2) + one remediation-failed aggregate (p1 only).
    expect(result.incidentsRaised).toBe(2);
    const { rows } = parseParams<{
      count: number;
      payments: { paymentRef: string; amount: string; reason: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p1", amount: "10.00", reason: "unknown" }],
    });
  });

  it("aggregates two failed reversals on the same till into ONE incident, not two racing for one dedup slot", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    await setOrderStatus(seeded, "abandoned");
    const refusingBoth = async (paymentRef: string): Promise<void> => {
      throw new AppError("payment.not_refundable", { paymentRef, state: "refunded" });
    };
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement(),
          settlement({ references: ["ext-2"], amount: decimal("20.00") }),
        ]),
        refusingBoth,
      ),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(0);
    // Both orphans share a null sale_id and the same till: without aggregation, the second
    // `payment.reconcile_remediation_failed` insert would collide on the open-incident dedup key
    // (till, code, sale_id) and be silently dropped.
    const { rows } = parseParams<{
      count: number;
      payments: { paymentRef: string; amount: string; reason: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].params.count).toBe(2);
    expect(rows[0].params.payments.map((p) => p.paymentRef).sort()).toEqual(["p1", "p2"]);
    expect(rows[0].params.payments.map((p) => p.reason)).toEqual([
      "payment.not_refundable",
      "payment.not_refundable",
    ]);
    expect(result.remediationFailures).toEqual([
      { paymentRef: "p1", reason: "payment.not_refundable" },
      { paymentRef: "p2", reason: "payment.not_refundable" },
    ]);
  });

  it("records a failure on the RESULT even when its incident is swallowed by an open one", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const refusing = async (paymentRef: string): Promise<void> => {
      throw new AppError("payment.not_refundable", { paymentRef, state: "refunded" });
    };
    const d = deps(
      new FakeSettlementReport([
        settlement(),
        settlement({ references: ["ext-2"], amount: decimal("20.00") }),
      ]),
      refusing,
    );
    const first = await reconcilePayments(d, PERIOD, NOW);
    expect(first.remediationFailures).toEqual([
      { paymentRef: "p1", reason: "payment.not_refundable" },
    ]);

    // A new orphan on the same till while the first failure's incident is still open: its own
    // incident is deduplicated away, so the result is the only record of it.
    await capture(seeded, "p2", "ext-2", "20.00");
    const second = await reconcilePayments(d, PERIOD, NOW);
    expect(second.incidentsRaised).toBe(0);
    expect(second.remediationFailures).toEqual([
      { paymentRef: "p2", reason: "payment.not_refundable" },
    ]);
  });

  it("reports alreadyClaimed for an orphan an earlier sweep already stamped", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const first = recordingReverse();
    await reconcilePayments(deps(new FakeSettlementReport([settlement()]), first.fn), PERIOD, NOW);
    expect(first.calls).toEqual(["p1"]);

    // While the first sweep's incident stays open, the second sweep's insert is deduplicated away.
    await pg.db.execute(sql`
      update incidents set acknowledged_at = ${new Date().toISOString()}
      where code = 'payment.reconcile_orphan'`);

    const second = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), second.fn),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(second.calls).toEqual([]);
    const incident = parseParams<{ payments: { remediation: string }[] }>(
      await pg.db.execute<{ params: string }>(sql`
      select params from incidents
      where code = 'payment.reconcile_orphan' and acknowledged_at is null`),
    );
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].params.payments[0].remediation).toBe("alreadyClaimed");
  });

  it("reports alreadyClaimed, not amountDrifted, for a row that is both already-claimed and drifting", async () => {
    // Pins the gate order: already-claimed precedes drift.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const first = recordingReverse();
    await reconcilePayments(deps(new FakeSettlementReport([settlement()]), first.fn), PERIOD, NOW);
    expect(first.calls).toEqual(["p1"]);

    // Acknowledged for the same reason as in the test above.
    await pg.db.execute(sql`
      update incidents set acknowledged_at = ${new Date().toISOString()}
      where code = 'payment.reconcile_orphan'`);

    // The second sweep's report now drifts the amount for the already-claimed row.
    const second = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), second.fn),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(second.calls).toEqual([]);
    const incident = parseParams<{ payments: { remediation: string }[] }>(
      await pg.db.execute<{ params: string }>(sql`
      select params from incidents
      where code = 'payment.reconcile_orphan' and acknowledged_at is null`),
    );
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].params.payments[0].remediation).toBe("alreadyClaimed");
  });

  it("does NOT claim an orphan whose amount has DRIFTED — it reports both instead", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), reverse.fn),
      PERIOD,
      NOW,
    );

    expect(result.orphan).toHaveLength(1);
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(0);
    // Not a failed remediation — one correctly never attempted.
    expect(result.remediationFailures).toEqual([]);
    expect(reverse.calls).toEqual([]);
    // No marker, unlike a claimed-then-failed reversal: a later sweep can still claim this row.
    const { rows } = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
    expect(await openIncidentCodes()).toEqual([
      "payment.reconcile_drift",
      "payment.reconcile_orphan",
    ]);
    const orphan = parseParams<{ payments: { remediation: string }[] }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_orphan'`,
      ),
    );
    expect(orphan.rows[0].params.payments[0].remediation).toBe("amountDrifted");
    const drift = parseParams<{
      payments: { paymentRef: string; captured: string; settled: string }[];
    }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_drift'`,
      ),
    );
    expect(drift.rows[0].params.payments).toEqual([
      { paymentRef: "p1", captured: "10.00", settled: "12.50" },
    ]);
  });

  it("still claims an orphan whose amount MATCHES — this is a gate, not a disabling", async () => {
    // Guards the test above: a drift set built over every classified row would stop all reversals.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      PERIOD,
      NOW,
    );
    expect(result.drift).toEqual([]);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
  });

  it("still claims and reverses an abandoned orphan whose reference matches NOTHING in the report", async () => {
    // An unmatched row produces no `drift` entry, so the orphan is reversed with no amount
    // comparison. A gate written as `entry.settled === null || driftedRefs.has(ref)` would pass
    // every other test in this file. The row is also `unsettled`: the classes are independent.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-nomatch");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([]), reverse.fn),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0]).toMatchObject({ paymentRef: "p1", settledAmount: null });
    expect(result.unsettled).toHaveLength(1);
    expect(result.drift).toEqual([]);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    const { rows } = await pg.db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).not.toBeNull();
  });

  it("reports the FIRST gate when a row trips several — not the drift one", async () => {
    // A settled-order orphan whose amount also drifted: the settled working order forbids the
    // reversal whatever the amount says.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "settled");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), reverse.fn),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(reverse.calls).toEqual([]);
    const orphan = parseParams<{ payments: { remediation: string }[] }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_orphan'`,
      ),
    );
    expect(orphan.rows[0].params.payments[0].remediation).toBe("workingOrderNotAbandoned");
  });

  it("gates only the DRIFTING orphan, not every orphan in the sweep", async () => {
    // The single-payment tests above would all pass a gate of the shape `if (driftedRefs.size > 0)`.
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement(),
          settlement({ references: ["ext-2"], amount: decimal("22.00") }),
        ]),
        reverse.fn,
      ),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    // One aggregate orphan incident carrying both reasons.
    const orphan = parseParams<{ payments: { paymentRef: string; remediation: string }[] }>(
      await pg.db.execute<{ params: string }>(
        sql`select params from incidents where code = 'payment.reconcile_orphan'`,
      ),
    );
    expect(orphan.rows).toHaveLength(1);
    expect(
      orphan.rows[0].params.payments
        .map(({ paymentRef, remediation }) => ({ paymentRef, remediation }))
        .sort((a, b) => a.paymentRef.localeCompare(b.paymentRef)),
    ).toEqual([
      { paymentRef: "p1", remediation: "claimed" },
      { paymentRef: "p2", remediation: "amountDrifted" },
    ]);
  });
});
