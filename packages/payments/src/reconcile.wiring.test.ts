import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import {
  decimal,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { openIncidents } from "@waitron/core";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { FakePaymentProvider } from "./testing/fake-provider.js";
import { FakeReconciler } from "./testing/fake-reconciler.js";
import { FakeSettlementReport } from "./testing/fake-settlement-report.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

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

/**
 * The capstone: money moved, the sale never happened, and the audit closed the gap.
 *
 * This is the §4 orphan window made concrete — `collect` captures, then `recordSale` never runs
 * (a crash, a walked-out customer), so a captured payment sits with a null `sale_id`. Nothing in
 * the capture path can fix that: the money moved before the invoice number existed, and T1/T2
 * forbids making the two atomic. `reconcile` is the designed backstop, and this proves the whole
 * chain end to end — provider → orphan → sweep → reversal → an incident the till can actually see
 * through the same `openIncidents` query the UI uses.
 */
describe("the orphan backstop, end to end", () => {
  it("collects, loses the sale, and lets the sweep reverse it and warn the till", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const provider = new FakePaymentProvider(db, seeded.tenantId);

    // 1. Real capture through the provider — the money moves.
    const captured = await provider.collect({
      tenantId: brandTenantId(seeded.tenantId),
      tillId: brandTillId(seeded.tillId),
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      amount: decimal("12.50"),
    });
    expect(captured.state).toBe("captured");

    // 2. recordSale never happens; the customer leaves and the order is abandoned.
    await db.execute(sql`
      update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`);

    // 3. The report is empty on purpose — its contents cannot matter here either way.
    //    `FakePaymentProvider` never sets `external_ref` on a capture, so `classify()` (which
    //    matches a settlement to a row only via `row.externalRef`) can never pair this row with any
    //    settlement record this test double produces, no matter what the report contains. What
    //    actually keeps this from ALSO being `unsettled` is pure timing: the capture happened
    //    moments before `now`, so `auditedAt` sits well inside the 7-day
    //    `DEFAULT_SETTLEMENT_LAG_MS` tolerance, and the tolerance check never fires. The orphan is
    //    the whole finding.
    const now = new Date();
    const report = new FakeSettlementReport([]);
    const reconciler = new FakeReconciler(db, report);
    const period = { from: new Date(now.getTime() - 3_600_000), to: new Date(now.getTime() + 1) };

    const result = await reconciler.reconcile(brandTenantId(seeded.tenantId), period, now);

    // 4. The audit found it, reversed it, and said so.
    expect(result.orphan).toHaveLength(1);
    expect(result.orphan[0].paymentRef).toBe(captured.paymentRef);
    expect(result.remediated).toBe(1);
    expect(reconciler.reversed).toEqual([captured.paymentRef]);

    // 5. And the till sees exactly one incident, through the UI's own query.
    const incidents = await db.transaction((tx) => openIncidents(tx, brandTillId(seeded.tillId)));
    expect(incidents.map((i) => i.code)).toEqual(["payment.reconcile_orphan"]);
    expect(incidents[0].params.count).toBe(1);
  });
});
