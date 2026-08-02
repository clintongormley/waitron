import { sql } from "drizzle-orm";
import {
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { SaleId, SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
import { sales } from "@waitron/db";
import type { Database } from "@waitron/db";

export interface SeededTenant {
  tenantId: TenantId;
  tillId: TillId;
  seriesId: SeriesId;
  workingOrderId: WorkingOrderId;
}

// Module-scope, not per-call: every test in record-sale.test.ts shares this counter across the
// whole run, which is what keeps each call's NIF collision-free against `tenants_nif_key` — the
// same convention packages/fiscal-verifactu/test/fixtures.ts's own `freshNif` uses.
let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

/**
 * Seeds tenant -> location -> till -> invoice series for `record-sale.test.ts`, plus a
 * fabricated `WorkingOrderId`. Runs as plain, unscoped statements rather than inside `withTenant`
 * — PGlite's default connection is a superuser and bypasses row-level security unconditionally,
 * so no `app.tenant_id` needs to be set for these inserts to satisfy each table's
 * tenant-isolation `WITH CHECK` — the identical convention
 * `packages/fiscal-verifactu/test/fixtures.ts`'s `seedTenantTillSif` already uses.
 *
 * `overrides.tenantId`, when supplied, adds a SECOND till (+ location + series) under an
 * EXISTING tenant rather than minting a new one — exactly the shape `record-sale.test.ts`'s
 * "rejects a series belonging to another till" test needs: a series that is real, and real for
 * the SAME tenant, but owned by a different till than the one under test.
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
      insert into tenants (nif, legal_name) values (${freshNif()}, 'Waitron SL') returning id
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

  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, till_id, code) values (${tenantId}, ${tillId}, 'A')
    returning id
  `);
  const seriesId = brandSeriesId(series.rows[0]!.id);

  return {
    tenantId,
    tillId,
    seriesId,
    // No `working_orders` row is created: `sales` carries no foreign key onto `working_orders`
    // at all (packages/db/src/schema/sales.ts), and `RecordSaleInput.workingOrderId` is used
    // purely as audit-trail context on `sale.tender_unsettled`/`sale.tender_shortfall` — never
    // persisted or joined against. A well-formed, fabricated id is therefore enough.
    workingOrderId: brandWorkingOrderId(crypto.randomUUID()),
  };
}

/**
 * Adds a second series to an EXISTING till whose `purpose` is `rectificative`, returning its id.
 * `recordCorrection` requires such a series (a correction must draw its number from a corrective
 * series, never an ordinary one — RD 1619/2012 art. 6.1.a); `recordSale` requires the opposite.
 * Runs as a plain, unscoped statement exactly like `seedTenant` above — the seeding connection is
 * a superuser and bypasses row-level security, so no `app.tenant_id` need be set for the
 * tenant-isolation `WITH CHECK` to pass.
 */
export async function seedRectificativeSeries(
  db: Database,
  tenantId: TenantId,
  tillId: TillId,
  code = "R",
): Promise<SeriesId> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, till_id, code, purpose)
    values (${tenantId}, ${tillId}, ${code}, 'rectificative')
    returning id
  `);
  return brandSeriesId(rows[0]!.id);
}

/**
 * Inserts one `sales` row directly, as the seeding (superuser) connection — the same
 * RLS-bypassing path `seedTenant` uses. For tests that need an ORIGINAL sale to correct without
 * routing it through `recordSale` (so it has NO backend fiscal record, or so a cross-tenant
 * original can be planted under another tenant). Written on the current schema: `total` is the
 * only money column, and `correctsSaleId` is left NULL for an ordinary original.
 */
export async function seedBareSale(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; seriesId: SeriesId },
  overrides: { total?: string; invoiceNumber?: number } = {},
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      tillId: seed.tillId,
      seriesId: seed.seriesId,
      invoiceNumber: overrides.invoiceNumber ?? 1,
      issuedAt: new Date("2026-03-01T12:00:00Z").toISOString(),
      issuedOffsetMinutes: 0,
      total: overrides.total ?? "65.00",
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}
