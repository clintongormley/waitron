import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { registerSif } from "../src/registro-sif.js";
import type { Entorno } from "../src/registro-row.js";

/**
 * Fixed ids for one tenant/till/SIF-identity/sale, reused across `inmutabilidad.test.ts`'s
 * separate `it` blocks. Literal UUIDs, matching this repo's convention elsewhere (e.g.
 * `packages/db/src/immutability.test.ts`), so a failing assertion's id is recognisable rather
 * than a freshly-random one printed once and never seen again.
 *
 * `id`/`tillId`/`tillId2` are branded via `tenantId()`/`tillId()` (Task 13's addition) rather than
 * left as plain string literals: `registerSif`/`currentSif`/`esPrimerRegistro`
 * (./src/registro-sif.ts) take `TenantId`/`TillId`, and a plain `string` — even a `const`-literal
 * one — is not assignable to a branded type (see packages/shared/src/ids.ts's own design note on
 * why: a string-keyed brand is forgeable, so the brand is a `unique symbol` no literal can
 * produce). `locationId`/`seriesId`/`saleId`/`sifId` stay plain strings: nothing in this package
 * takes a branded `LocationId`/`SeriesId`/`SaleId`/`FiscalRecordId`, so branding them would be
 * decoration with no consumer.
 */
export const TENANT_A = {
  id: tenantId("a0000000-0000-4000-8000-000000000001"),
  locationId: "a0000000-0000-4000-8000-000000000002",
  tillId: brandTillId("a0000000-0000-4000-8000-000000000003"),
  seriesId: "a0000000-0000-4000-8000-000000000004",
  saleId: "a0000000-0000-4000-8000-000000000005",
  sifId: "a0000000-0000-4000-8000-000000000006",
  // A second till of the SAME obligado, added for registro-sif.test.ts (Task 13): proving the
  // installation-number counter is scoped to (NIF, IdSIF) rather than to a single till needs two
  // tills sharing one NIF, and every other fixture in this file predates that requirement.
  tillId2: brandTillId("a0000000-0000-4000-8000-000000000007"),
  // The SIF/chain/series owner (node-id rekey, 2026-08-03: #33). `nodeId2` is a second node of the
  // SAME obligado, the node-keyed counterpart of `tillId2` — proving the installation-number counter
  // is per (NIF, IdSIF), not per node.
  nodeId: brandNodeId("a0000000-0000-4000-8000-000000000008"),
  nodeId2: brandNodeId("a0000000-0000-4000-8000-000000000009"),
};

/**
 * A second, independent obligado tributario — added for registro-sif.test.ts (Task 13), which
 * needs to prove `contadores_instalacion`'s counter is keyed by (NIF, IdSIF) and not shared
 * globally across tenants. Distinct id namespace (`b0000000...`) purely so a failing assertion's
 * id is recognisably "the other tenant" rather than a misprinted TENANT_A id.
 */
export const TENANT_B = {
  id: tenantId("b0000000-0000-4000-8000-000000000001"),
  locationId: "b0000000-0000-4000-8000-000000000002",
  tillId: brandTillId("b0000000-0000-4000-8000-000000000003"),
  nodeId: brandNodeId("b0000000-0000-4000-8000-000000000004"),
};

/**
 * Seed the foreign-key parents needed by insertRegistro: tenant, location, till, node,
 * invoice series, sale and SIF identity. Use the fixture owner's table privileges.
 * The zero-total sale remains unsettled; settlement coverage is checked on settlement.
 */
export async function seedTenantTillSif(db: Database): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${TENANT_A.id}, 'ES', '89890001K', 'Waitron SL')
  `);
  await db.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description)
    values (${TENANT_A.locationId}, ${TENANT_A.id}, 'Local principal', array['es'], 'Venta en establecimiento')
  `);
  await db.execute(sql`
    insert into tills (id, tenant_id, location_id, name)
    values (${TENANT_A.tillId}, ${TENANT_A.id}, ${TENANT_A.locationId}, 'Caja 1')
  `);
  await db.execute(sql`
    insert into nodes (id, tenant_id, location_id, name)
    values (${TENANT_A.nodeId}, ${TENANT_A.id}, ${TENANT_A.locationId}, 'Node 1')
  `);
  await db.execute(sql`
    insert into invoice_series (id, tenant_id, node_id, code)
    values (${TENANT_A.seriesId}, ${TENANT_A.id}, ${TENANT_A.nodeId}, 'A')
  `);
  await db.execute(sql`
    insert into sales (
      id, tenant_id, till_id, node_id, series_id, invoice_number,
      issued_at, issued_offset_minutes,
      total, vat_breakdown,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${TENANT_A.saleId}, ${TENANT_A.id}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.seriesId}, 1,
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )
  `);
  await db.execute(sql`
    insert into registro_sif (id, tenant_id, node_id, nif, id_sistema_informatico, numero_instalacion)
    values (${TENANT_A.sifId}, ${TENANT_A.id}, ${TENANT_A.nodeId}, '89890001K', 'WAITRON01', 1)
  `);
}

/**
 * Seeds two INDEPENDENT tenants for registro-sif.test.ts (Task 13) — TENANT_A with two tills
 * (proving the installation-number counter is per (NIF, IdSIF), not per till), TENANT_B with one
 * (proving it is not shared globally either).
 *
 * Deliberately narrower than `seedTenantTillSif` above: no invoice series, no sale, no
 * pre-existing `registro_sif` row. `registerSif` is exactly what mints that row under test, so
 * seeding one here would make every "first registration" assertion false before the test body
 * even runs. Seeds two NODES for TENANT_A (`nodeId`/`nodeId2`, two nodes of one obligado) and one
 * for TENANT_B — the SIF is the node (node-id rekey, 2026-08-03), so `registerSif` keys on these.
 * The tills are kept so the sale-ringing snapshot has a real till to reference.
 */
export async function seedTenants(db: Database): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, country, tax_id, legal_name) values
      (${TENANT_A.id}, 'ES', '89890001K', 'Waitron SL'),
      (${TENANT_B.id}, 'ES', '12345678Z', 'Otro Obligado SL')
  `);
  await db.execute(sql`
    insert into locations (id, tenant_id, name, invoice_locales, operation_description) values
      (${TENANT_A.locationId}, ${TENANT_A.id}, 'Local principal', array['es'], 'Venta en establecimiento'),
      (${TENANT_B.locationId}, ${TENANT_B.id}, 'Local principal', array['es'], 'Venta en establecimiento')
  `);
  await db.execute(sql`
    insert into tills (id, tenant_id, location_id, name) values
      (${TENANT_A.tillId}, ${TENANT_A.id}, ${TENANT_A.locationId}, 'Caja 1'),
      (${TENANT_A.tillId2}, ${TENANT_A.id}, ${TENANT_A.locationId}, 'Caja 2'),
      (${TENANT_B.tillId}, ${TENANT_B.id}, ${TENANT_B.locationId}, 'Caja 1')
  `);
  await db.execute(sql`
    insert into nodes (id, tenant_id, location_id, name) values
      (${TENANT_A.nodeId}, ${TENANT_A.id}, ${TENANT_A.locationId}, 'Node 1'),
      (${TENANT_A.nodeId2}, ${TENANT_A.id}, ${TENANT_A.locationId}, 'Node 2'),
      (${TENANT_B.nodeId}, ${TENANT_B.id}, ${TENANT_B.locationId}, 'Node 1')
  `);
}

/**
 * Advances a node's chain head to point at a fabricated-but-real `registros_facturacion` row,
 * standing in for "this node has actually sold something".
 *
 * Not a bare `update cadenas set ultima_huella = ...`, even though that would be enough to make
 * `esPrimerRegistro` observe a non-empty chain. `cadenas_puntero_ck`
 * (packages/fiscal-verifactu/src/schema/cadenas.ts, Task 12) requires `ultimo_registro_id` and
 * `ultima_huella` to be BOTH null or BOTH set, so giving the chain head a huella without a real
 * row for `ultimo_registro_id`'s foreign key to point at is rejected by the database outright —
 * confirmed live in this task's red phase. The fabricated `invoice_series` and `sales` rows exist
 * only to satisfy `registros_facturacion`'s own foreign keys; nothing about their content is
 * asserted on anywhere.
 */
export async function seedSoldRegistro(
  db: Database,
  params: {
    tenantId: string;
    tillId: string;
    nodeId: string;
    sifId: string;
    nif: string;
    secuencia: number;
    huella: string;
    /**
     * Deployment-environment plan, Task 6: defaults to `"production"` so `registro-sif.test.ts`'s
     * existing calls (neither of which mentions this field) keep stamping a non-null, agreeing
     * `entorno` now that `drain.ts` refuses a NULL/mismatched one — mirroring
     * `test/drain-fixtures.ts`'s identical `seedPendingEnvios`/`DEFAULT_ENTORNO` precedent.
     * Neither existing caller ever runs `drain()` over a row this fixture seeds, so the default
     * is inert for them today; it exists so a FUTURE caller that does isn't silently refused.
     */
    entorno?: Entorno | null;
  },
): Promise<void> {
  const entorno = params.entorno === undefined ? "production" : params.entorno;
  const series = await db.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code)
    values (${params.tenantId}, ${params.nodeId}, ${"S" + String(params.secuencia)})
    returning id
  `);
  const seriesId = series.rows[0]?.id;
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (
      tenant_id, till_id, node_id, series_id, invoice_number,
      issued_at, issued_offset_minutes,
      total, vat_breakdown,
      locale, invoice_locales, fiscal_backend, fiscal_state
    ) values (
      ${params.tenantId}, ${params.tillId}, ${params.nodeId}, ${seriesId}, ${params.secuencia},
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )
    returning id
  `);
  const saleId = sale.rows[0]?.id;
  const registro = await db.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno
    ) values (
      ${params.tenantId}, ${params.tillId}, ${params.nodeId}, ${params.sifId}, ${saleId}, ${params.secuencia}, 'alta',
      ${params.nif}, ${"S" + String(params.secuencia) + "/1"}, '2026-07-20', 'Waitron SL',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', ${params.huella}, ${entorno}
    )
    returning id
  `);
  const registroId = registro.rows[0]?.id;
  await db.execute(sql`
    update cadenas
    set secuencia = ${params.secuencia}, ultimo_registro_id = ${registroId}, ultima_huella = ${params.huella}
    where tenant_id = ${params.tenantId} and node_id = ${params.nodeId}
  `);
}

export interface SeededTillWithSif {
  tenantId: TenantId;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Module-scope, not per-call: every test file that imports `seedTenantWithSif` shares this
// counter across its whole run, which is what keeps each call's NIF collision-free against
// `tenants_country_tax_id_key` — the identical convention `./src/testing/seed.ts`'s own `freshNif` and
// `packages/core/test/fixtures.ts`'s `freshNif` already use.
let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(20_000_000 + nifSequence).padStart(8, "0")}K`;
}

async function insertLocationTillSeries(
  tx: Transaction,
  tenant: TenantId,
): Promise<{ tillId: TillId; nodeId: NodeId; seriesId: SeriesId }> {
  const location = await tx.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, 'Sala principal', array['es-ES'], 'Venta en establecimiento')
    returning id
  `);
  const till = await tx.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenant}, ${location.rows[0]!.id}, 'Caja 1')
    returning id
  `);
  const tillId = brandTillId(till.rows[0]!.id);
  const node = await tx.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name) values (${tenant}, ${location.rows[0]!.id}, 'Node 1')
    returning id
  `);
  const nodeId = brandNodeId(node.rows[0]!.id);
  const series = await tx.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code) values (${tenant}, ${nodeId}, 'A')
    returning id
  `);
  return { tillId, nodeId, seriesId: brandSeriesId(series.rows[0]!.id) };
}

/**
 * Seeds tenant -> location -> till -> invoice series, and registers a LIVE Veri*Factu SIF
 * identity for that till (via `registerSif`, Task 13) — everything
 * `write-path.e2e.test.ts` needs for `VerifactuBackend.recordSale`'s own `currentSif` lookup to
 * succeed. `seedTenantTillSif` above is deliberately not reused for this: it seeds a
 * ready-made SALE too (for `inmutabilidad.test.ts`'s own fixed ids), which would collide with
 * `write-path.e2e.test.ts`'s own first allocated invoice number.
 *
 * Each call mints its OWN fresh tenant (and therefore its own NIF) so the write-path suite's
 * `beforeEach` can reseed on every test without ever truncating `registros_facturacion`'s
 * append-only, TRUNCATE-blocking table — the identical reasoning `./src/testing/seed.ts`'s
 * `seedTill` doc comment already gives for the same shape.
 */
export async function seedTenantWithSif(db: Database): Promise<SeededTillWithSif> {
  const nif = freshNif();
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into tenants (country, tax_id, legal_name) values ('ES', ${nif}, 'Waitron SL') returning id
    `);
    const tenant = tenantId(rows[0]!.id);
    const { tillId, nodeId, seriesId } = await insertLocationTillSeries(tx, tenant);
    await registerSif(tx, {
      tenantId: tenant,
      nodeId,
      nif,
      idSistemaInformatico: "WT",
    });
    // No `working_orders` row and no `workingOrderId`: `recordSale` now WRITES
    // `input.workingOrderId` to `sales.working_order_id`, a real FK onto `working_orders`
    // (sub-project 7b). A fabricated id would FK-violate on the insert, so this fixture mints none —
    // the write-path suites here record walk-up sales that omit it, and the column inserts NULL.
    return { tenantId: tenant, tillId, nodeId, seriesId };
  });
}
