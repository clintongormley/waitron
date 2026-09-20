import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
import { registerSif } from "../src/registro-sif.js";
import type { Entorno } from "../src/registro-row.js";

/**
 * Fixed ids for one venue's till/SIF-identity/sale, reused across `inmutabilidad.test.ts`'s
 * separate `it` blocks. Literal UUIDs, matching this repo's convention elsewhere (e.g.
 * `packages/db/src/immutability.test.ts`), so a failing assertion's id is recognisable rather
 * than a freshly-random one printed once and never seen again. The `A`/`B` namespaces are kept as
 * two NIFs, two nodes and two tills of one taxpayer — the counter tests need distinct SIF
 * identities, never distinct tenants.
 *
 * `tillId`/`tillId2` are branded via `tillId()` (Task 13's addition) rather than left as plain
 * string literals: `registerSif`/`currentSif`/`esPrimerRegistro` (./src/registro-sif.ts) take
 * `TillId`, and a plain `string` — even a `const`-literal one — is not assignable to a branded type
 * (see packages/shared/src/ids.ts's own design note on why: a string-keyed brand is forgeable, so
 * the brand is a `unique symbol` no literal can produce). `locationId`/`seriesId`/`saleId`/`sifId`
 * stay plain strings: nothing in this package takes a branded
 * `LocationId`/`SeriesId`/`SaleId`/`FiscalRecordId`, so branding them would be decoration with no
 * consumer.
 */
export const TENANT_A = {
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
 * A second NIF — added for registro-sif.test.ts (Task 13), which needs to prove
 * `contadores_instalacion`'s counter is keyed by (NIF, IdSIF) rather than shared across every
 * identity. Distinct id namespace (`b0000000...`) purely so a failing assertion's id is
 * recognisably "the other NIF's node" rather than a misprinted TENANT_A id.
 */
export const TENANT_B = {
  locationId: "b0000000-0000-4000-8000-000000000002",
  tillId: brandTillId("b0000000-0000-4000-8000-000000000003"),
  nodeId: brandNodeId("b0000000-0000-4000-8000-000000000004"),
};

/**
 * Seed the foreign-key parents needed by insertRegistro: the taxpayer row, location, till, node,
 * invoice series, sale and SIF identity. Use the fixture owner's table privileges.
 * The zero-total sale remains unsettled; settlement coverage is checked on settlement.
 */
export async function seedTenantTillSif(db: Database): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, country, tax_id, legal_name) values (1, 'ES', '89890001K', 'Waitron SL')
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into locations (id, name, invoice_locales, operation_description) values (${TENANT_A.locationId}, 'Local principal', array['es'], 'Venta en establecimiento')
  `);
  await db.execute(sql`
    insert into tills (id, location_id, name) values (${TENANT_A.tillId}, ${TENANT_A.locationId}, 'Caja 1')
  `);
  await db.execute(sql`
    insert into nodes (id, location_id, name) values (${TENANT_A.nodeId}, ${TENANT_A.locationId}, 'Node 1')
  `);
  await db.execute(sql`
    insert into invoice_series (id, node_id, code) values (${TENANT_A.seriesId}, ${TENANT_A.nodeId}, 'A')
  `);
  await db.execute(sql`
    insert into sales (id, till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values (${TENANT_A.saleId}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.seriesId}, 1,
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )
  `);
  await db.execute(sql`
    insert into registro_sif (id, node_id, nif, id_sistema_informatico, numero_instalacion)
    values (${TENANT_A.sifId}, ${TENANT_A.nodeId}, '89890001K', 'WAITRON01', 1)
  `);
}

/**
 * Seeds the parents registro-sif.test.ts (Task 13) needs: the taxpayer row, and three nodes across
 * two locations — `TENANT_A.nodeId`/`nodeId2` (two nodes registering under one NIF, proving the
 * installation-number counter is per (NIF, IdSIF), not per node) and `TENANT_B.nodeId` (a node
 * registering under a DIFFERENT NIF, proving the counter is not shared across identities either).
 *
 * Deliberately narrower than `seedTenantTillSif` above: no invoice series, no sale, no
 * pre-existing `registro_sif` row. `registerSif` is exactly what mints that row under test, so
 * seeding one here would make every "first registration" assertion false before the test body
 * even runs. The SIF is the node (node-id rekey, 2026-08-03), so `registerSif` keys on these nodes.
 * The tills are kept so the sale-ringing snapshot has a real till to reference.
 */
export async function seedTenants(db: Database): Promise<void> {
  await db.execute(sql`
    insert into tenants (id, country, tax_id, legal_name) values (1, 'ES', '89890001K', 'Waitron SL')
    on conflict (id) do nothing
  `);
  await db.execute(sql`
    insert into locations (id, name, invoice_locales, operation_description) values (${TENANT_A.locationId}, 'Local principal', array['es'], 'Venta en establecimiento'),
      ( ${TENANT_B.locationId}, 'Local principal', array['es'], 'Venta en establecimiento')
  `);
  await db.execute(sql`
    insert into tills (id, location_id, name) values (${TENANT_A.tillId}, ${TENANT_A.locationId}, 'Caja 1'),
      ( ${TENANT_A.tillId2}, ${TENANT_A.locationId}, 'Caja 2'),
      ( ${TENANT_B.tillId}, ${TENANT_B.locationId}, 'Caja 1')
  `);
  await db.execute(sql`
    insert into nodes (id, location_id, name) values (${TENANT_A.nodeId}, ${TENANT_A.locationId}, 'Node 1'),
      ( ${TENANT_A.nodeId2}, ${TENANT_A.locationId}, 'Node 2'),
      ( ${TENANT_B.nodeId}, ${TENANT_B.locationId}, 'Node 1')
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
    insert into invoice_series (node_id, code) values (${params.nodeId}, ${"S" + String(params.secuencia)})
    returning id
  `);
  const seriesId = series.rows[0]?.id;
  const sale = await db.execute<{ id: string }>(sql`
    insert into sales (till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values (${params.tillId}, ${params.nodeId}, ${seriesId}, ${params.secuencia},
      '2026-07-20T19:20:30+01:00', 60,
      '0.00', '[]'::jsonb,
      'es', array['es'], 'verifactu', 'recorded'
    )
    returning id
  `);
  const saleId = sale.rows[0]?.id;
  const registro = await db.execute<{ id: string }>(sql`
    insert into registros_facturacion (
      till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno
    ) values (${params.tillId}, ${params.nodeId}, ${params.sifId}, ${saleId}, ${params.secuencia}, 'alta',
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
    where node_id = ${params.nodeId}
  `);
}

export interface SeededTillWithSif {
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Module-scope, not per-call: every test file that imports `seedTenantWithSif` shares this
// counter across its whole run, which is what keeps each call's SIF identity collision-free in
// `registro_sif_instalacion_uq` — the identical convention `./src/testing/seed.ts`'s own `freshNif`
// and `packages/core/test/fixtures.ts`'s `freshNif` already use.
let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(20_000_000 + nifSequence).padStart(8, "0")}K`;
}

async function insertLocationTillSeries(
  tx: Transaction,
): Promise<{ tillId: TillId; nodeId: NodeId; seriesId: SeriesId }> {
  const location = await tx.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description) values ('Sala principal', array['es-ES'], 'Venta en establecimiento')
    returning id
  `);
  const till = await tx.execute<{ id: string }>(sql`
    insert into tills (location_id, name) values (${location.rows[0]!.id}, 'Caja 1')
    returning id
  `);
  const tillId = brandTillId(till.rows[0]!.id);
  const node = await tx.execute<{ id: string }>(sql`
    insert into nodes (location_id, name) values (${location.rows[0]!.id}, 'Node 1')
    returning id
  `);
  const nodeId = brandNodeId(node.rows[0]!.id);
  const series = await tx.execute<{ id: string }>(sql`
    insert into invoice_series (node_id, code) values (${nodeId}, 'A')
    returning id
  `);
  return { tillId, nodeId, seriesId: brandSeriesId(series.rows[0]!.id) };
}

/**
 * Seeds location -> till -> invoice series, makes sure the one taxpayer row exists, and registers a
 * LIVE Veri*Factu SIF identity for that till (via `registerSif`, Task 13) — everything
 * `write-path.e2e.test.ts` needs for `VerifactuBackend.recordSale`'s own `currentSif` lookup to
 * succeed. `seedTenantTillSif` above is deliberately not reused for this: it seeds a
 * ready-made SALE too (for `inmutabilidad.test.ts`'s own fixed ids), which would collide with
 * `write-path.e2e.test.ts`'s own first allocated invoice number.
 *
 * Each call mints its OWN fresh NIF and its own node so the write-path suite's `beforeEach` can
 * reseed on every test without ever truncating `registros_facturacion`'s append-only,
 * TRUNCATE-blocking table — the identical reasoning `./src/testing/seed.ts`'s `seedTill` doc
 * comment already gives for the same shape.
 *
 * `options.nif` overrides that minting. The minted NIF comes from a module-level counter
 * (`freshNif` above), so which one a test gets is decided by how many `seedTenantWithSif` calls ran
 * before it in the same file. The NIF is a HASHED field (`IDEmisorFactura`,
 * `packages/verifactu/src/huella.ts`), so a test that asserts a recorded huella literal would
 * otherwise break whenever a test is added or removed ABOVE it. Measured: the same basket filed
 * 16th in `write-path.e2e.test.ts` hashed to `38CCE164…` under NIF `20000016K` and to `A1AF497F…`
 * standalone under `20000001K`; pinning the NIF made both positions agree. Pass a value no other
 * test in the same file will mint — the counter starts at `20000001K` and climbs.
 *
 * WHAT THE OVERRIDE DOES NOT REACH. The `tenants` insert below is `where not exists`, so in a file
 * whose earlier tests have already seeded, the override reaches `registerSif` alone and the
 * `tenants` row keeps the `tax_id` the FIRST seed inserted. That is harmless for a pinned huella
 * because the hashed `IDEmisorFactura` is read from the SIF registration, not from `tenants`:
 * `VerifactuBackend.recordSale` sets it from `currentSif(tx, nodeId).nif`
 * (`./src/backend.ts`, `./src/registro-sif.ts`). The only tenant value that reaches a record at all
 * is the legal name — `taxpayer` in `./src/backend.ts` hands its callers nothing else — and the
 * legal name is not among the eight fields `buildCadenaAlta` hashes
 * (`packages/verifactu/src/huella.ts`). A test that needs `tenants.tax_id` itself to match must
 * seed before anything else does.
 */
export async function seedTenantWithSif(
  db: Database,
  options: { nif?: string } = {},
): Promise<SeededTillWithSif> {
  const nif = options.nif ?? freshNif();
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      insert into tenants (id, country, tax_id, legal_name)
      select 1, 'ES', ${nif}, 'Waitron SL' where not exists (select 1 from tenants)
    `);
    const { tillId, nodeId, seriesId } = await insertLocationTillSeries(tx);
    await registerSif(tx, { nodeId, nif, idSistemaInformatico: "WT" });
    // No `working_orders` row and no `workingOrderId`: `recordSale` now WRITES
    // `input.workingOrderId` to `sales.working_order_id`, a real FK onto `working_orders`
    // (sub-project 7b). A fabricated id would FK-violate on the insert, so this fixture mints none —
    // the write-path suites here record walk-up sales that omit it, and the column inserts NULL.
    return { tillId, nodeId, seriesId };
  });
}
