import { sql } from "drizzle-orm";
import {
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import type { SeriesId, TenantId, TillId, WorkingOrderId } from "@waitron/shared";
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
