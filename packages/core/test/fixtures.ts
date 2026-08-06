import { sql } from "drizzle-orm";
import {
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { sales } from "@waitron/db";
import type { Database } from "@waitron/db";

export interface SeededTenant {
  tenantId: TenantId;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Module-scope, not per-call: every test in record-sale.test.ts shares this counter across the
// whole run, which is what keeps each call's NIF collision-free against `tenants_country_tax_id_key` — the
// same convention packages/fiscal-verifactu/test/fixtures.ts's own `freshNif` uses.
let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

/**
 * Seeds tenant -> location -> till -> node -> invoice series for `record-sale.test.ts`. Runs as
 * plain, unscoped statements rather than inside `withTenant`
 * — PGlite's default connection is a superuser and bypasses row-level security unconditionally,
 * so no `app.tenant_id` needs to be set for these inserts to satisfy each table's
 * tenant-isolation `WITH CHECK` — the identical convention
 * `packages/fiscal-verifactu/test/fixtures.ts`'s `seedTenantTillSif` already uses.
 *
 * The invoice series is keyed to the NODE, not the till (node-id rekey, 2026-08-03: the SIF is the
 * node, #33). Each call also mints its own node, so `overrides.tenantId`, when supplied, adds a
 * SECOND till + node (+ location + series) under an EXISTING tenant rather than minting a new
 * tenant — exactly the shape `record-sale.test.ts`'s "rejects a series belonging to another node"
 * test needs: a series that is real, and real for the SAME tenant, but owned by a different node
 * than the one under test (the returned `nodeId` is genuinely different from the first call's).
 */
export async function seedTenant(
  db: Database,
  overrides: { tenantId?: TenantId } = {},
): Promise<SeededTenant> {
  let tenantId: TenantId;
  if (overrides.tenantId !== undefined) {
    tenantId = overrides.tenantId;
  } else {
    const { rows } = await db.execute<{ id: string }>(sql`
      insert into tenants (country, tax_id, legal_name) values ('ES', ${freshNif()}, 'Waitron SL') returning id
    `);
    tenantId = brandTenantId(rows[0]!.id);
  }

  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala principal', array['es-ES', 'ca-ES'], 'Venta en establecimiento')
    returning id
  `);
  const locationId = location.rows[0]!.id;

  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1')
    returning id
  `);
  const tillId = brandTillId(till.rows[0]!.id);

  const node = await db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Nodo 1')
    returning id
  `);
  const nodeId = brandNodeId(node.rows[0]!.id);

  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A')
    returning id
  `);
  const seriesId = brandSeriesId(series.rows[0]!.id);

  // No `working_orders` row and no `workingOrderId`: `recordSale` now WRITES `input.workingOrderId`
  // to `sales.working_order_id`, a real FK onto `working_orders` (sub-project 7b). A fabricated id
  // would FK-violate on the insert, so this fixture mints none — the walk-up sales every suite here
  // records omit it and the column inserts NULL. A test that needs the linkage seeds its own real
  // `working_orders` row and passes its id explicitly (see record-sale.test.ts's "working order
  // linkage").
  return { tenantId, tillId, nodeId, seriesId };
}

/**
 * Adds a second series to an EXISTING node whose `purpose` is `rectificative`, returning its id
 * (node-id rekey, 2026-08-03: a series is owned by a node, #33). `recordCorrection` requires such a
 * series (a correction must draw its number from a corrective series, never an ordinary one — RD
 * 1619/2012 art. 6.1.a); `recordSale` requires the opposite. Runs as a plain, unscoped statement
 * exactly like `seedTenant` above — the seeding connection is a superuser and bypasses row-level
 * security, so no `app.tenant_id` need be set for the tenant-isolation `WITH CHECK` to pass.
 */
export async function seedRectificativeSeries(
  db: Database,
  tenantId: TenantId,
  nodeId: NodeId,
  code = "R",
): Promise<SeriesId> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose)
    values (${tenantId}, ${nodeId}, ${code}, 'rectificative')
    returning id
  `);
  return brandSeriesId(rows[0]!.id);
}

/**
 * Inserts one `sales` row directly, as the seeding (superuser) connection — the same
 * RLS-bypassing path `seedTenant` uses. For tests that need an ORIGINAL sale to correct without
 * routing it through `recordSale` (so it has NO backend fiscal record, or so a cross-tenant
 * original can be planted under another tenant). Written on the current schema: `total` is the
 * only money column. `correctsSaleId` defaults to NULL for an ordinary original; pass it to seed a
 * rectificativa instead (its negative/positive total is what `sales_total_ck` permits once it is set).
 */
export async function seedBareSale(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  overrides: { total?: string; invoiceNumber?: number; correctsSaleId?: SaleId } = {},
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: overrides.invoiceNumber ?? 1,
      issuedAt: new Date("2026-03-01T12:00:00Z").toISOString(),
      issuedOffsetMinutes: 0,
      total: overrides.total ?? "65.00",
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
      correctsSaleId: overrides.correctsSaleId,
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}
