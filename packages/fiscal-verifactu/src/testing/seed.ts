import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { tenantId, tillId as brandTillId } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import type { AltaInput, AnulacionInput, SistemaInformatico } from "@waitron/verifactu";
import { registerSif } from "../registro-sif.js";
import type { PendingRegistro } from "../chain.js";
import type { Entorno } from "../registro-row.js";

export const TEST_NIF = "89890001K";

export const TEST_SISTEMA: SistemaInformatico = {
  NombreRazon: "Waitron SL",
  NIF: TEST_NIF,
  NombreSistemaInformatico: "Waitron POS",
  IdSistemaInformatico: "WT",
  Version: "1.0.0",
  NumeroInstalacion: "1",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "S",
  IndicadorMultiplesOT: "N",
};

export interface SeededTill {
  tenantId: TenantId;
  tillId: TillId;
  seriesId: string;
  sifId: string;
}

// Module-scope, not per-call: every test file that imports seedTill shares this counter across its
// WHOLE run, which is exactly what makes each call's nif collision-free against
// tenants_nif_key — including across the many beforeEach calls a concurrency suite fires.
let nifSequence = 0;

/**
 * A fresh, plausible-looking NIF, unique for the lifetime of the test process. `tenants.nif`
 * carries no format CHECK (packages/db/src/schema/tenants.ts), so nothing validates the checksum
 * digit — this exists purely to dodge `tenants_nif_key`, never to look up a real obligado.
 */
function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

async function insertTenant(tx: Transaction, nif: string): Promise<TenantId> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${nif}, ${"Waitron SL"}) returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedTill: tenant insert returned no row");
  return tenantId(row.id);
}

/** Adds one till (+ location + series + a live SIF registration) under an EXISTING tenant. */
async function addTill(
  tx: Transaction,
  tenant: TenantId,
  nif: string,
  label: string,
): Promise<SeededTill> {
  const location = await tx.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, ${"Sala " + label}, array['es'], ${"Venta en establecimiento"})
    returning id
  `);
  const locationRow = location.rows[0];
  if (locationRow === undefined) throw new Error("seedTill: location insert returned no row");

  const till = await tx.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenant}, ${locationRow.id}, ${"Till " + label})
    returning id
  `);
  const tillRow = till.rows[0];
  if (tillRow === undefined) throw new Error("seedTill: till insert returned no row");
  const till_id = brandTillId(tillRow.id);

  const series = await tx.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, till_id, code, purpose, next_number)
    values (${tenant}, ${till_id}, ${"G" + label}, ${"standard"}, 1)
    returning id
  `);
  const seriesRow = series.rows[0];
  if (seriesRow === undefined) throw new Error("seedTill: series insert returned no row");

  const sif = await registerSif(tx, {
    tenantId: tenant,
    tillId: till_id,
    nif,
    idSistemaInformatico: TEST_SISTEMA.IdSistemaInformatico,
  });

  return { tenantId: tenant, tillId: till_id, seriesId: seriesRow.id, sifId: sif.id };
}

/**
 * Inserts tenant → location → till → series and registers a live Veri*Factu SIF identity for it,
 * returning every id `appendToChain` needs. Each call gets its OWN fresh tenant (and therefore its
 * own NIF, via `freshNif()`) — this is what lets `chain.concurrency.test.ts`'s `beforeEach` reseed
 * on every test without truncating (and therefore without ever touching
 * `registros_facturacion`'s append-only, TRUNCATE-blocking trigger — see that file's own note).
 */
export async function seedTill(db: Database, label = "A"): Promise<SeededTill> {
  const nif = freshNif();
  return db.transaction(async (tx) => addTill(tx, await insertTenant(tx, nif), nif, label));
}

/** Inserts one location + till + series under an EXISTING tenant, deliberately WITHOUT calling
 * registerSif — the counterpart to addTill above, for callers that need to fire registerSif
 * THEMSELVES afterwards. See seedTillsForSifContention's doc comment for why this split exists. */
async function addBareTill(tx: Transaction, tenant: TenantId, label: string): Promise<TillId> {
  const location = await tx.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, ${"Sala " + label}, array['es'], ${"Venta en establecimiento"})
    returning id
  `);
  const locationRow = location.rows[0];
  if (locationRow === undefined) throw new Error("addBareTill: location insert returned no row");

  const till = await tx.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenant}, ${locationRow.id}, ${"Till " + label})
    returning id
  `);
  const tillRow = till.rows[0];
  if (tillRow === undefined) throw new Error("addBareTill: till insert returned no row");
  const till_id = brandTillId(tillRow.id);

  await tx.execute(sql`
    insert into invoice_series (tenant_id, till_id, code, purpose, next_number)
    values (${tenant}, ${till_id}, ${"G" + label}, ${"standard"}, 1)
  `);

  return till_id;
}

export interface SifContentionFixture {
  tenantId: TenantId;
  nif: string;
  tillIds: TillId[];
}

/**
 * `count` DISTINCT tills under ONE fresh tenant — therefore one shared NIF — with NO SIF
 * registration yet. Exists for exactly one test (chain.concurrency.test.ts's retargeted Task 13
 * counter-contention suite): proving `contadores_instalacion`'s (NIF, IdSistemaInformatico)
 * allocator holds when many DIFFERENT tills of one obligado race it concurrently.
 *
 * Deliberately NOT built on `seedTill`/`addTill`, which always register a SIF as part of creating
 * the till: doing that here would mint `count` installation numbers ONE AT A TIME, sequentially,
 * during setup — the opposite of what this fixture is for. The tills must exist, UNREGISTERED,
 * so the test can fire every registerSif call itself, concurrently, as the thing under test.
 *
 * One till per writer, not one till shared by several writers: `registerSif` also revokes any
 * existing live registration for that (tenant, till) before minting a new one (two separate
 * statements, not one atomic step), which races a DIFFERENT, out-of-scope hazard — concurrent
 * RE-registration of the SAME till from multiple processes — that this fixture is not testing.
 * registerSif's own doc comment (./registro-sif.ts) frames re-registration as a rare, sequential,
 * admin-only event ("not a mid-service event"); concurrent re-registration of one till is not a
 * scenario that occurs in production and is not what Task 13's deferred counter test was about.
 */
export async function seedTillsForSifContention(
  db: Database,
  count: number,
): Promise<SifContentionFixture> {
  const nif = freshNif();
  return db.transaction(async (tx) => {
    const tenant = await insertTenant(tx, nif);
    const tillIds: TillId[] = [];
    for (let i = 0; i < count; i++) {
      tillIds.push(await addBareTill(tx, tenant, `T${i}`));
    }
    return { tenantId: tenant, nif, tillIds };
  });
}

/**
 * Inserts one core `sales` row and returns its id — the FK `registros_facturacion.sale_id` needs.
 * `total`/`tip_amount`/`amount_charged` are all `'0.00'` deliberately: `sales`'s deferred
 * `sales_assert_tenders_cover` constraint trigger (packages/db/drizzle/0005_sales.sql) requires
 * tenders to sum to `amount_charged`, and the simplest fixture that clears it with NO tender row
 * at all is one with nothing to cover — the same convention this package's own
 * `test/fixtures.ts`/`seedTenantTillSif` already uses. The Veri*Factu record's OWN amounts
 * (`altaFor`'s `CuotaTotal`/`ImporteTotal`) are independent of this sale's totals; nothing ties
 * `registros_facturacion.importe_total` to `sales.total` at the database level (Task 12's own
 * design note: the two are allowed to disagree in representation because only one is hashed), so
 * a zero-amount sale exercises `appendToChain`'s FK requirement without needing a matching tender.
 */
export async function seedSale(
  db: Database | Transaction,
  till: SeededTill,
  invoiceNumber: number,
): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    insert into sales (tenant_id, till_id, series_id, invoice_number, issued_at, issued_offset_minutes,
                       total, tip_amount, amount_charged, locale, invoice_locales,
                       fiscal_backend, fiscal_state)
    values (${till.tenantId}, ${till.tillId}, ${till.seriesId}, ${invoiceNumber},
            '2026-07-20T19:20:30+02:00', 120,
            '0.00', '0.00', '0.00',
            'es', array['es'], 'verifactu', 'recorded')
    returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedSale inserted nothing");
  return row.id;
}

/**
 * A minimal alta ready for appendToChain — Encadenamiento is chain-owned, not this fixture's.
 *
 * Return type is the NARROWED `tipo: "alta"` branch, not the full `PendingRegistro` union: an
 * explicit `: PendingRegistro` annotation here would make every caller's `.input` access see the
 * union of BOTH branches' `input` shapes (TS does not narrow a union on an annotated return type),
 * which is exactly what broke `chain.test.ts`'s "stores the exact literals" test when first
 * written — `altaFor(...).input` needs to type as this branch's own `Omit<AltaInput,
 * "Encadenamiento">`, not `Omit<AltaInput, ...> | Omit<AnulacionInput, ...>`.
 */
export function altaFor(
  saleId: string,
  invoiceNumber: number,
  seconds: number,
  // Defaulted, not required: this fixture has call sites across most of this package's test
  // suites, and none of them care which environment the record claims — only
  // chain.test.ts's/verify.test.ts's own entorno-specific tests pass an explicit override.
  entorno: Entorno = "production",
): Extract<PendingRegistro, { tipo: "alta" }> {
  const input: Omit<AltaInput, "Encadenamiento"> = {
    IDEmisorFactura: TEST_NIF,
    NumSerieFactura: `A/${invoiceNumber}`,
    FechaExpedicionFactura: new Date("2026-07-20T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F1",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: "102.02",
        CuotaRepercutida: "21.43",
        TipoImpositivo: "21",
        CalificacionOperacion: "S1",
      },
    ],
    CuotaTotal: "21.43",
    ImporteTotal: "123.45",
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, seconds)),
    offsetMinutes: 120,
  };
  return { tipo: "alta", saleId, entorno, input };
}

/** A minimal anulación against an already-issued invoice. Narrowed return type — see altaFor's
 * doc comment for why. */
export function anulacionFor(
  saleId: string,
  invoiceNumber: number,
  seconds: number,
  // Same default, same reason as altaFor's own entorno parameter above.
  entorno: Entorno = "production",
): Extract<PendingRegistro, { tipo: "anulacion" }> {
  const input: Omit<AnulacionInput, "Encadenamiento"> = {
    IDEmisorFacturaAnulada: TEST_NIF,
    NumSerieFacturaAnulada: `A/${invoiceNumber}`,
    FechaExpedicionFacturaAnulada: new Date("2026-07-20T00:00:00+02:00"),
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date(Date.UTC(2026, 6, 20, 17, 20, seconds)),
    offsetMinutes: 120,
  };
  return { tipo: "anulacion", saleId, entorno, input };
}
