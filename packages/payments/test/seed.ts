import { sql } from "drizzle-orm";
import { nodeId as brandNodeId } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";

export interface Seeded {
  tenantId: string;
  tillId: string;
  nodeId: string;
  workingOrderId: string;
}

export interface SeededForSale extends Seeded {
  seriesId: string;
}

// Each of this package's test files runs against its own isolated PGlite instance, and within a
// file tenants accumulate for the life of the suite (nothing truncates `tenants`), so every test
// that seeds a tenant needs its own NIF or collides with a prior one on `tenants_country_tax_id_key`. A
// single shared counter is enough — the per-file base-offset each test file used to carry bought
// nothing, since the DBs never see each other's rows.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(10_000_000 + nifCounter).padStart(8, "0")}K`;
}

/** Seeds tenant → location → till → node → open working_order and returns their ids. The `node`
 * is what the fiscal chain/series/SIF identity is keyed on; it is
 * created at the same (tenant, location) as the till. Uses the fixture connection directly. */
export async function seedWorkingOrder(db: Database, nif = "B00000000"): Promise<Seeded> {
  const t = await db.execute<{ id: string }>(sql`
    insert into tenants (country, tax_id, legal_name) values ('ES', ${nif}, 'Test SL') returning id`);
  const tenantId = t.rows[0].id;
  const l = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Counter', array['es'], 'Retail') returning id`);
  const locationId = l.rows[0].id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`);
  const tillId = till.rows[0].id;
  const node = await db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Node 1') returning id`);
  const nodeId = node.rows[0].id;
  // order_number is NOT NULL since park & retrieve (@waitron/db Task 1); this seed just needs a value.
  const wo = await db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, order_number) values (${tenantId}, ${tillId}, 1) returning id`);
  return { tenantId, tillId, nodeId, workingOrderId: wo.rows[0].id };
}

/**
 * Seeds one `invoice_series` row for the node, one `sales` row against it, and the one `tenders`
 * row that covers it, and returns the new sale's id — the minimal commercial record
 * `associatePaymentWithSale` needs to point a payment at, without going through `@waitron/core`'s
 * full `recordSale` (that full path is exercised in the Task 10 wiring test).
 *
 * `total` is the only money column on `sales` now — `tip_amount`/`amount_charged` were dropped in
 * migration 0012 (the tip moved to `tenders.tip_amount`). No `sale_settlements` row is declared, so
 * this is a legitimate UNSETTLED sale (design §3) and NO coverage check runs against it: migration
 * 0012 retired the old commit-time deferred `sales_assert_tenders_cover` trigger, replacing it with
 * one that fires only when settlement is DECLARED (the `sale_settlements` INSERT). Every other NOT
 * NULL column on `sales` (`packages/db/src/schema/sales.ts`) is supplied, `locale` is a member of
 * `invoice_locales`, `issued_offset_minutes` is within range, and this is the series' first (and
 * only) sale, so `invoice_number = 1` never collides with `sales_series_invoice_number_key`. The
 * sale and its covering tender are wrapped in one `db.transaction` for atomic setup — not for the
 * composite FK (which a committed `sales` row satisfies across separate transactions too), but so a
 * partial failure can never leave a sale without its covering tender. Uses the fixture connection
 * directly, like `seedWorkingOrder`.
 */
export async function seedSale(db: Database, seeded: Seeded): Promise<string> {
  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code)
    values (${seeded.tenantId}, ${seeded.nodeId}, 'A') returning id`);
  const seriesId = series.rows[0].id;
  return db.transaction(async (tx) => {
    const sale = await tx.execute<{ id: string }>(sql`
      insert into sales (
        tenant_id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes,
        total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state
      ) values (
        ${seeded.tenantId}, ${seeded.tillId}, ${seeded.nodeId}, ${seriesId}, 1, now(), 60,
        '10.00', '[]'::jsonb, 'es', array['es'], 'fake', 'not_applicable'
      ) returning id`);
    const saleId = sale.rows[0].id;
    await tx.execute(sql`
      insert into tenders (tenant_id, sale_id, method, amount, settled_at)
      values (${seeded.tenantId}, ${saleId}, 'card', '10.00', now())`);
    return saleId;
  });
}

/**
 * Seeds everything `@waitron/core`'s `recordSale` needs to chain a real sale on this node, for the
 * Task 10 wiring test: tenant → location → till → node → open working_order (via
 * `seedWorkingOrder`), one `invoice_series` row for the node, and the node registered with the
 * injected fiscal `backend`. Returns the ids plus the new `seriesId`.
 *
 * `backend.registerNode` is required and not optional: `FakeFiscalBackend` refuses
 * `recordSale`/`recordVoid` for a node with no prior registration (`fiscal.node_not_registered`),
 * exactly like a real backend would, and `recordSale` itself never registers a node (provisioning
 * is a separate admin action). Registration runs in its OWN committed transaction here so the
 * `fake_node_registrations` row is visible to the later, separate `recordSale` transaction — the
 * node's `NodeId` is branded at the call site because `registerNode` requires the branded type.
 *
 * Uses the fixture connection directly, like `seedWorkingOrder`/`seedSale`.
 */
export async function seedForSale(
  db: Database,
  backend: FakeFiscalBackend,
  nif?: string,
): Promise<SeededForSale> {
  const seeded = await seedWorkingOrder(db, nif);
  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code)
    values (${seeded.tenantId}, ${seeded.nodeId}, 'A') returning id`);
  const seriesId = series.rows[0].id;
  await db.transaction(async (tx) => {
    await backend.registerNode(tx, brandNodeId(seeded.nodeId), { tenantId: seeded.tenantId });
  });
  return { ...seeded, seriesId };
}

/** Seeds one `payment_policy` row for the tenant through the fixture connection. */
export async function seedPaymentPolicy(
  db: Database,
  tenantId: string,
  mode: "accept_offline" | "cash_only",
  cap: string,
): Promise<void> {
  await db.execute(sql`
    insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
    values (${tenantId}, ${mode}, ${cap})`);
}
