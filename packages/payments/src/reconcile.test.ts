import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError, decimal, tenantId as brandTenantId } from "@waitron/shared";
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

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate incidents, payment_refunds, payments cascade`);
});

const PROVIDER = "fake";
const NOW = new Date("2026-07-25T12:00:00Z");
/** Older than NOW - DEFAULT_SETTLEMENT_LAG_MS, so the in-flight tolerance has expired. */
const OLD_SETTLED = new Date("2026-07-01T12:00:00Z");
const PERIOD = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };

/** Records every reversal the sweep asks for, so a test can assert what money moved. */
function recordingReverse() {
  const calls: string[] = [];
  const fn = async (paymentRef: string): Promise<void> => {
    calls.push(paymentRef);
  };
  return { calls, fn };
}

function deps(report: FakeSettlementReport, reverse = recordingReverse().fn): ReconcileDeps {
  return {
    db,
    provider: PROVIDER,
    report,
    reverse,
    incidents: recordIncidentOnce,
    settlementLagMs: DEFAULT_SETTLEMENT_LAG_MS,
  };
}

async function capture(seeded: Seeded, paymentRef: string, externalRef: string, amount = "10.00") {
  await withTenant(db, seeded.tenantId, (tx) =>
    insertCapturedPayment(tx, {
      tenantId: seeded.tenantId,
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
  await withTenant(db, seeded.tenantId, async (tx) => {
    await insertAcceptedOffline(tx, {
      tenantId: seeded.tenantId,
      workingOrderId: seeded.workingOrderId,
      provider: PROVIDER,
      paymentRef,
      externalRef,
      amount: decimal("10.00"),
      settledAt: OLD_SETTLED,
    });
    await settleForwarded(tx, { tenantId: seeded.tenantId, provider: PROVIDER, paymentRef });
  });
}

/** Seeds a second till + open working order under the SAME tenant/location as `seeded` —
 * `seedWorkingOrder` always mints a fresh tenant, so a two-till test needs this instead. Mirrors
 * store.test.ts's `seedSecondSale`. */
async function seedSecondTill(seeded: Seeded): Promise<Seeded> {
  const [till] = (
    await db.execute<{ location_id: string }>(
      sql`select location_id from tills where id = ${seeded.tillId}`,
    )
  ).rows;
  const till2 = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${seeded.tenantId}, ${till.location_id}, 'Till 2') returning id`);
  const tillId = till2.rows[0].id;
  const wo2 = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id) values (${seeded.tenantId}, ${tillId}) returning id`);
  return { tenantId: seeded.tenantId, tillId, workingOrderId: wo2.rows[0].id };
}

async function openIncidentCodes(tenantId: string): Promise<string[]> {
  const { rows } = await db.execute<{ code: string }>(
    sql`select code from incidents where tenant_id = ${tenantId} order by code`,
  );
  return rows.map((r) => r.code);
}

function settlement(over: Partial<SettlementRecord> = {}): SettlementRecord {
  return { references: ["ext-1"], amount: decimal("10.00"), settledAt: OLD_SETTLED, ...over };
}

describe("reconcilePayments", () => {
  it("answers all-empty for a tenant with nothing to check", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
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
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.checked).toBe(1);
    expect(result.incidentsRaised).toBe(0);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([]);
  });

  it("raises one aggregated unsettled incident covering every stale payment on the till", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await capture(seeded, "p2", "ext-2", "20.00");
    // Deliberately NOT associated with a sale: the working order stays "open", so the orphan rule
    // (which requires a non-open working order) never fires — these two rows are unsettled only.
    // (Associating both would also collide on seedSale's fixed invoice-series code 'A' per till.)
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.unsettled).toHaveLength(2);
    expect(result.incidentsRaised).toBe(1);
    const { rows } = await db.execute<{
      params: { count: number; payments: { paymentRef: string; settledAt: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_unsettled'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].params.count).toBe(2);
    // settledAt is normalised to ISO-8601, not the raw Postgres `mode: "string"` format
    // (`2026-07-01 12:00:00+00`) `row.settledAt` carries on the way in.
    expect(rows[0].params.payments.map((p) => p.settledAt)).toEqual([
      OLD_SETTLED.toISOString(),
      OLD_SETTLED.toISOString(),
    ]);
  });

  it("aggregates per (till, class), not per class alone — two tills stay two incidents", async () => {
    // The grouping key is `${tillId}|${klass}`. A single-till fixture can't distinguish that from
    // a bare `klass` key, which would file every till's money under whichever till's row is seen
    // first and leave every other till's incident silently missing — this is what catches it.
    const seeded = await seedWorkingOrder(db, freshNif());
    const second = await seedSecondTill(seeded);
    await capture(seeded, "p1", "ext-1");
    await capture(second, "p2", "ext-2", "20.00");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.unsettled).toHaveLength(2);
    expect(result.incidentsRaised).toBe(2);
    const { rows } = await db.execute<{ till_id: string; params: { count: number } }>(
      sql`select till_id, params from incidents where code = 'payment.reconcile_unsettled' order by till_id`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.till_id).sort()).toEqual([seeded.tillId, second.tillId].sort());
    expect(rows.every((r) => r.params.count === 1)).toBe(true);
  });

  it("does not re-count an incident a second sweep re-detects", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const d = deps(new FakeSettlementReport([]));
    const first = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    const second = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(first.incidentsRaised).toBe(1);
    // Still reported as a mismatch — the audit finding is always reported — but the open incident
    // already exists, so nothing new was inserted.
    expect(second.unsettled).toHaveLength(1);
    expect(second.incidentsRaised).toBe(0);
  });

  it("classifies a differing settled amount as drift and raises its incident", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await associate(seeded, "p1");
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("9.00") })])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toMatchObject({ localAmount: "10.00", settledAmount: "9.00" });
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_drift"]);
    // The declared params shape, asserted whole: a human resolving this incident needs BOTH
    // figures, and the pair is the entire content of the finding.
    const { rows } = await db.execute<{
      params: {
        count: number;
        payments: { paymentRef: string; captured: string; settled: string }[];
      };
    }>(sql`select params from incidents where code = 'payment.reconcile_drift'`);
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p1", captured: "10.00", settled: "9.00" }],
    });
  });

  it("classifies an initiated row the report settled as lostSettlement", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await withTenant(db, seeded.tenantId, (tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
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
      brandTenantId(seeded.tenantId),
      now,
      NOW,
    );
    expect(result.lostSettlement).toHaveLength(1);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_lost_settlement"]);
    // The declared params shape, asserted whole: this incident names a settlement the processor
    // confirmed for a payment we never locally marked captured — the working order is the only
    // thing pointing a human back at what was actually paid for.
    const { rows } = await db.execute<{
      params: {
        count: number;
        payments: { paymentRef: string; amount: string; workingOrderId: string }[];
      };
    }>(sql`select params from incidents where code = 'payment.reconcile_lost_settlement'`);
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p-init", amount: "10.00", workingOrderId: seeded.workingOrderId }],
    });
  });

  it("reports an unattributable missingLocal WITHOUT raising an incident", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ references: ["ext-ghost"] })])),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0]).toMatchObject({ paymentRef: null, references: ["ext-ghost"] });
    expect(result.incidentsRaised).toBe(0);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([]);
  });

  it("raises an incident for a missingLocal the processor attributed via a hint", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await reconcilePayments(
      deps(
        new FakeSettlementReport([
          settlement({
            references: ["ext-ghost"],
            hint: { workingOrderId: seeded.workingOrderId, paymentRef: "p-lost" },
          }),
        ]),
      ),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.incidentsRaised).toBe(1);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_missing_local"]);
    // The declared params shape, asserted whole: this incident names money we hold NO row for, so
    // every processor reference, the amount, the settlement time and the hinted payment_ref are all
    // a human has to go on.
    const { rows } = await db.execute<{
      params: {
        count: number;
        settlements: {
          references: string[];
          amount: string;
          settledAt: string;
          paymentRef: string;
        }[];
      };
    }>(sql`select params from incidents where code = 'payment.reconcile_missing_local'`);
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
    // The existence check is now ONE batched query over every unmatched settlement's references,
    // not one query per settlement (see existingReferences). A naive translation that treats "the
    // batched query returned a non-empty set" as "every candidate resolved" would wrongly clear
    // BOTH settlements below, when only the second genuinely has a local row.
    const seeded = await seedWorkingOrder(db, freshNif());
    // ext-2 has a local row, but settled OUTSIDE the swept PERIOD — existingReferences still finds
    // it (unbounded by period, same as the single-record test below), so it must not be reported.
    await withTenant(db, seeded.tenantId, (tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
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
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.missingLocal).toHaveLength(1);
    expect(result.missingLocal[0]).toMatchObject({ references: ["ext-1"] });
  });

  it("does not call a settlement missingLocal when a local row exists outside the period", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    // A period that excludes the payment entirely, while the report still carries its settlement.
    const elsewhere = {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()])),
      brandTenantId(seeded.tenantId),
      elsewhere,
      NOW,
    );
    expect(result.checked).toBe(0);
    expect(result.missingLocal).toEqual([]);
  });

  it("fetches the report even when there are no local rows at all", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const report = new FakeSettlementReport([settlement({ references: ["ext-ghost"] })]);
    await reconcilePayments(deps(report), brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(report.windows).toHaveLength(1);
  });

  it("fetches the report over a window widened by the settlement lag", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const report = new FakeSettlementReport([]);
    await reconcilePayments(deps(report), brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(report.windows[0].from).toEqual(PERIOD.from);
    expect(report.windows[0].to).toEqual(new Date(PERIOD.to.getTime() + DEFAULT_SETTLEMENT_LAG_MS));
  });

  it("scopes the report fetch to the tenant being swept", async () => {
    // The port takes the tenant as an ARGUMENT, not at construction: one reconciler sweeps many
    // tenants and the processor account may be shared between them. A source that could not see the
    // tenant would answer with the whole account's settlements, and every other tenant's would fail
    // this tenant's existence check and be reported as `missingLocal` — other people's money in the
    // sweep's authoritative result, every run.
    const seeded = await seedWorkingOrder(db, freshNif());
    const report = new FakeSettlementReport([]);
    await reconcilePayments(deps(report), brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(report.tenants).toEqual([seeded.tenantId]);
  });
});

/** Associates a payment with a freshly-seeded sale, so it is not an orphan. */
async function associate(seeded: Seeded, paymentRef: string): Promise<void> {
  const saleId = await seedSale(db, seeded);
  await db.execute(sql`
    update payments set sale_id = ${saleId}
    where tenant_id = ${seeded.tenantId} and payment_ref = ${paymentRef}`);
}

/** Sets a seeded working order's status. `settled` also needs `settled_at` (the biconditional
 * CHECK `working_orders_settled_at_ck`); `abandoned` must leave it null. */
async function setOrderStatus(seeded: Seeded, status: "settled" | "abandoned"): Promise<void> {
  await db.execute(sql`
    update working_orders
    set status = ${status}, settled_at = ${status === "settled" ? sql`now()` : null}
    where id = ${seeded.workingOrderId}`);
}

describe("orphan remediation", () => {
  it("auto-reverses an orphan on an ABANDONED order and stamps the marker", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).not.toBeNull();
    // `remediation` tells a human whether the sweep is handing this customer their money back and,
    // when it is not, which gate stopped it — so the whole params shape is asserted here and each
    // other reason is asserted in its own test below. Hardcoding any single value must fail one of
    // them.
    const incident = await db.execute<{
      params: {
        count: number;
        payments: {
          paymentRef: string;
          amount: string;
          workingOrderId: string;
          workingOrderStatus: string;
          remediation: string;
        }[];
      };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
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
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    // A reverse fake that peeks at its own paymentRef's marker AT CALL TIME. If a future change
    // moved the stamp into a `finally` (or after the network call), this would still be green for
    // every other test but would catch the marker reading null right here.
    const markersAtCallTime: (string | null)[] = [];
    const reverse = async (paymentRef: string): Promise<void> => {
      const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
        sql`select reconcile_remediated_at from payments where payment_ref = ${paymentRef}`,
      );
      markersAtCallTime.push(rows[0]?.reconcile_remediated_at ?? null);
    };
    await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(markersAtCallTime).toHaveLength(1);
    expect(markersAtCallTime[0]).not.toBeNull();
  });

  it("does NOT reverse an orphan on a SETTLED order — it reports and raises only", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "settled");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(reverse.calls).toEqual([]);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_orphan"]);
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
    const incident = await db.execute<{
      params: { payments: { workingOrderStatus: string; remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
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
    // The mode 2b shape: an offline-accepted tender whose sale write never landed, forwarded to
    // `settled`, on an order staff then abandoned. It is a genuine orphan on an abandoned order, so
    // the working-order gate alone would claim it — but `settled` has no reversal path at all, so
    // claiming it would stamp a permanent marker for a reversal that must fail, and no later sweep
    // would ever look at it again. Incident-only, exactly like a settled-ORDER orphan.
    const seeded = await seedWorkingOrder(db, freshNif());
    await forwardedOffline(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0]).toMatchObject({ paymentRef: "p1", localState: "settled" });
    expect(result.remediated).toBe(0);
    expect(result.remediationFailures).toEqual([]);
    expect(reverse.calls).toEqual([]);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual(["payment.reconcile_orphan"]);
    const incident = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(incident.rows[0].params.payments[0].remediation).toBe("stateNotCaptured");
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
  });

  it("reverses each orphan at most once, however many sweeps run", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const d = deps(new FakeSettlementReport([settlement()]), reverse.fn);
    await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    const second = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    // Still REPORTED — the audit finding never disappears — but not reversed again.
    expect(second.orphan).toHaveLength(1);
    expect(second.remediated).toBe(0);
    expect(reverse.calls).toEqual(["p1"]);
  });

  it("raises a remediation-failed incident when the processor refuses the reversal", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const refusing = async (): Promise<void> => {
      throw new AppError("payment.not_refundable", { paymentRef: "p1", state: "refunded" });
    };
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), refusing),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(0);
    expect(result.remediationFailures).toEqual([
      { paymentRef: "p1", reason: "payment.not_refundable" },
    ]);
    // One orphan aggregate + one remediation-failed aggregate.
    expect(result.incidentsRaised).toBe(2);
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([
      "payment.reconcile_orphan",
      "payment.reconcile_remediation_failed",
    ]);
    const { rows } = await db.execute<{
      params: { count: number; payments: { paymentRef: string; amount: string; reason: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p1", amount: "10.00", reason: "payment.not_refundable" }],
    });
    // The marker is stamped even on failure, so this is not retried every sweep.
    const marker = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(marker.rows[0].reconcile_remediated_at).not.toBeNull();
  });

  it("reports a non-AppError reversal failure with an unknown reason and keeps sweeping", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
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
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    // One failure does not abort the pass: p2 was still reversed.
    expect(calls).toEqual(["p1", "p2"]);
    expect(result.remediated).toBe(1);
    expect(result.remediationFailures).toEqual([{ paymentRef: "p1", reason: "unknown" }]);
    // One orphan aggregate (both p1 and p2) + one remediation-failed aggregate (p1 only).
    expect(result.incidentsRaised).toBe(2);
    const { rows } = await db.execute<{
      params: { count: number; payments: { paymentRef: string; amount: string; reason: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toEqual({
      count: 1,
      payments: [{ paymentRef: "p1", amount: "10.00", reason: "unknown" }],
    });
  });

  it("aggregates two failed reversals on the same till into ONE incident, not two racing for one dedup slot", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
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
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.remediated).toBe(0);
    // Both orphans share a null sale_id and the same till: without aggregation, the second
    // `payment.reconcile_remediation_failed` insert would collide on the open-incident dedup key
    // (tenant, till, code, sale_id) and be silently dropped.
    const { rows } = await db.execute<{
      params: { count: number; payments: { paymentRef: string; amount: string; reason: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_remediation_failed'`);
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
    const seeded = await seedWorkingOrder(db, freshNif());
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
    const first = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(first.remediationFailures).toEqual([
      { paymentRef: "p1", reason: "payment.not_refundable" },
    ]);

    // A NEW orphan on the SAME till, while the first sweep's remediation-failed incident is still
    // open. Its incident collides on the open-incident dedup key (tenant, till, code, sale_id) and
    // is dropped — and unlike the five mismatch classes, this finding is never re-detected, because
    // the marker means no later sweep will ever claim p2 again. The result list is therefore the
    // ONLY record it has, which is exactly why the field exists.
    await capture(seeded, "p2", "ext-2", "20.00");
    const second = await reconcilePayments(d, brandTenantId(seeded.tenantId), PERIOD, NOW);
    expect(second.incidentsRaised).toBe(0);
    expect(second.remediationFailures).toEqual([
      { paymentRef: "p2", reason: "payment.not_refundable" },
    ]);
  });

  it("reports alreadyClaimed for an orphan an earlier sweep already stamped", async () => {
    // The marker is permanent by design, so a second sweep over the same period must not reverse
    // the payment again — and must say WHY it is standing down, rather than reading identically to
    // an orphan it was never allowed to touch.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const first = recordingReverse();
    await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), first.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(first.calls).toEqual(["p1"]);

    // Acknowledge the first sweep's incident before the second runs. Without this the assertion
    // below would read the FIRST incident (`claimed`) and fail for a reason that has nothing to do
    // with what is under test: the open-incident dedup index is partial on `acknowledged_at IS
    // NULL`, so while the first stays open the second sweep's insert is deduplicated away.
    await db.execute(sql`
      update incidents set acknowledged_at = now()
      where tenant_id = ${seeded.tenantId} and code = 'payment.reconcile_orphan'`);

    const second = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), second.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(second.calls).toEqual([]);
    const incident = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`
      select params from incidents
      where code = 'payment.reconcile_orphan' and acknowledged_at is null`);
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].params.payments[0].remediation).toBe("alreadyClaimed");
  });

  it("reports alreadyClaimed, not amountDrifted, for a row that is both already-claimed and drifting", async () => {
    // Pins the gate order: already-claimed precedes drift. An earlier sweep's marker is permanent,
    // so settling THIS sweep's drift can never unblock a reversal this row already either succeeded
    // or permanently failed at — reporting `amountDrifted` here would point a human at a fix that
    // cannot do anything, which is exactly what the reordering exists to prevent.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const first = recordingReverse();
    await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), first.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(first.calls).toEqual(["p1"]);

    // Acknowledge the first sweep's incident before the second runs — as in the test above, the
    // open-incident dedup index is partial on `acknowledged_at IS NULL`, so leaving it open would
    // dedupe away the second sweep's insert and this assertion would read the FIRST incident
    // (`claimed`) instead of the second sweep's.
    await db.execute(sql`
      update incidents set acknowledged_at = now()
      where tenant_id = ${seeded.tenantId} and code = 'payment.reconcile_orphan'`);

    // The second sweep's report now drifts the amount for the already-claimed row.
    const second = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), second.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(0);
    expect(second.calls).toEqual([]);
    const incident = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`
      select params from incidents
      where code = 'payment.reconcile_orphan' and acknowledged_at is null`);
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].params.payments[0].remediation).toBe("alreadyClaimed");
  });

  it("does NOT claim an orphan whose amount has DRIFTED — it reports both instead", async () => {
    // The one case where the sweep would move money at a figure it has, in the same pass, proven it
    // cannot trust. The reversal primitive sends no amount, so the processor refunds ITS figure
    // while we would record OURS; and the marker is permanent, so the row would leave the audited
    // set with the books wrong and nothing to re-examine it. Report both, move nothing.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );

    expect(result.orphan).toHaveLength(1);
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(0);
    // Not a failed remediation — one correctly never attempted.
    expect(result.remediationFailures).toEqual([]);
    expect(reverse.calls).toEqual([]);
    // No marker: the row stays in the audited state set, so any sweep whose period covers it again
    // will re-detect it, and the open drift/orphan incidents persist regardless of cadence until a
    // human settles the difference. This is the whole difference from a claimed-then-failed
    // reversal, whose marker is permanent unconditionally.
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).toBeNull();
    expect(await openIncidentCodes(seeded.tenantId)).toEqual([
      "payment.reconcile_drift",
      "payment.reconcile_orphan",
    ]);
    const orphan = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(orphan.rows[0].params.payments[0].remediation).toBe("amountDrifted");
    // The drift incident still carries BOTH figures — the human settling the difference reads them
    // from here, which is what makes reporting-instead-of-reversing actionable.
    const drift = await db.execute<{
      params: { payments: { paymentRef: string; captured: string; settled: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_drift'`);
    expect(drift.rows[0].params.payments).toEqual([
      { paymentRef: "p1", captured: "10.00", settled: "12.50" },
    ]);
  });

  it("still claims an orphan whose amount MATCHES — this is a gate, not a disabling", async () => {
    // The regression guard for the test above: if the drift set were built wrongly (say, over every
    // classified row rather than the `drift` ones), auto-reversal would silently stop entirely and
    // every other orphan test would still pass.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement()]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toEqual([]);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
  });

  it("still claims and reverses an abandoned orphan whose reference matches NOTHING in the report", async () => {
    // The documented scope boundary (see the design's §4/§7): `classify` only ever emits `drift` for
    // a row a settlement actually MATCHED (`settled !== undefined`). A reference the report never
    // mentions at all leaves `settled` undefined — no `drift` entry is ever produced for it, so the
    // drift gate has nothing to catch — and the orphan is claimed and reversed with NO amount
    // comparison ever having happened. A stricter gate written as
    // `entry.settled === null || driftedRefs.has(ref)` would still pass every other test in this
    // file, which is exactly why this one exists.
    //
    // This row is ALSO `unsettled`: it is audited (captured, non-open working order) but unmatched,
    // and its `auditedAt` sits inside `PERIOD`, which is always more than the settlement lag before
    // `NOW` in this fixture set. That overlap is asserted below rather than avoided — `classify`'s
    // predicates are independent by design (see its own doc comment).
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-nomatch");
    await setOrderStatus(seeded, "abandoned");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0]).toMatchObject({ paymentRef: "p1", settledAmount: null });
    expect(result.unsettled).toHaveLength(1);
    expect(result.drift).toEqual([]);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    const { rows } = await db.execute<{ reconcile_remediated_at: string | null }>(
      sql`select reconcile_remediated_at from payments where payment_ref = 'p1'`,
    );
    expect(rows[0].reconcile_remediated_at).not.toBeNull();
  });

  it("reports the FIRST gate when a row trips several — not the drift one", async () => {
    // A settled-order orphan whose amount ALSO drifted. Both gates apply, and the order matters to
    // the human: reporting `amountDrifted` would suggest that settling the difference unblocks the
    // reversal, when the settled working order forbids it whatever the amount says.
    const seeded = await seedWorkingOrder(db, freshNif());
    await capture(seeded, "p1", "ext-1");
    await setOrderStatus(seeded, "settled");
    const reverse = recordingReverse();
    const result = await reconcilePayments(
      deps(new FakeSettlementReport([settlement({ amount: decimal("12.50") })]), reverse.fn),
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(reverse.calls).toEqual([]);
    const orphan = await db.execute<{
      params: { payments: { remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
    expect(orphan.rows[0].params.payments[0].remediation).toBe("workingOrderNotAbandoned");
  });

  it("gates only the DRIFTING orphan, not every orphan in the sweep", async () => {
    // The regression guard for the three tests above: every one of them exercises a single payment,
    // so an over-broad gate of the shape `if (driftedRefs.size > 0)` — any drift anywhere blocking
    // EVERY orphan's reversal — would still pass all three. Two abandoned orphans on the same till,
    // only one of which drifts, is what catches that: only the non-drifting one may be reversed.
    const seeded = await seedWorkingOrder(db, freshNif());
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
      brandTenantId(seeded.tenantId),
      PERIOD,
      NOW,
    );
    expect(result.drift).toHaveLength(1);
    expect(result.remediated).toBe(1);
    expect(reverse.calls).toEqual(["p1"]);
    // One aggregate orphan incident, both reasons present — the only coverage anywhere of two
    // different `remediation` values coexisting in the same aggregate.
    const orphan = await db.execute<{
      params: { payments: { paymentRef: string; remediation: string }[] };
    }>(sql`select params from incidents where code = 'payment.reconcile_orphan'`);
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
