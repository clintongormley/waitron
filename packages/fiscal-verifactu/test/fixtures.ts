import { sql } from "drizzle-orm";
import {
  invoiceSeries,
  locations,
  nodes,
  sales,
  tenants,
  tills,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
import { registrosFacturacion } from "../src/schema/registros.js";
import { registroSif } from "../src/schema/sif.js";
import { registerSif } from "../src/registro-sif.js";
import type { Entorno } from "../src/registro-row.js";

/**
 * Every row here is written through its TABLE DEFINITION rather than as raw SQL, so each column's
 * own `$defaultFn` generator runs and the JSON and list columns are encoded.
 */

/** The sale's issue instant, carrying the `+01:00` that `issued_offset_minutes` (60) records. */
const ISSUED_AT = "2026-07-20T19:20:30+01:00";

/**
 * Fixed ids for one venue's till/SIF-identity/sale, reused across `inmutabilidad.test.ts`'s
 * separate `it` blocks. Literal UUIDs, so a failing assertion's id is recognisable rather than a
 * freshly-random one printed once and never seen again. The `A`/`B` namespaces are kept as two
 * NIFs, two nodes and two tills of one taxpayer — the counter tests need distinct SIF identities,
 * never distinct tenants.
 */
export const TENANT_A = {
  locationId: "a0000000-0000-4000-8000-000000000002",
  tillId: brandTillId("a0000000-0000-4000-8000-000000000003"),
  seriesId: "a0000000-0000-4000-8000-000000000004",
  saleId: "a0000000-0000-4000-8000-000000000005",
  sifId: "a0000000-0000-4000-8000-000000000006",
  // A second till of the SAME obligado.
  tillId2: brandTillId("a0000000-0000-4000-8000-000000000007"),
  // The SIF/chain/series owner. `nodeId2` is a second node of the SAME obligado — proving the
  // installation-number counter is per (NIF, IdSIF), not per node.
  nodeId: brandNodeId("a0000000-0000-4000-8000-000000000008"),
  nodeId2: brandNodeId("a0000000-0000-4000-8000-000000000009"),
};

/**
 * A second NIF, to prove `contadores_instalacion`'s counter is keyed by (NIF, IdSIF) rather than
 * shared across every identity. Distinct id namespace (`b0000000...`) purely so a failing assertion's id is
 * recognisably "the other NIF's node" rather than a misprinted TENANT_A id.
 */
export const TENANT_B = {
  locationId: "b0000000-0000-4000-8000-000000000002",
  tillId: brandTillId("b0000000-0000-4000-8000-000000000003"),
  nodeId: brandNodeId("b0000000-0000-4000-8000-000000000004"),
};

/**
 * Seed the foreign-key parents needed by insertRegistro: the taxpayer row, location, till, node,
 * invoice series, sale and SIF identity. The zero-total sale remains unsettled; settlement
 * coverage is checked on settlement.
 */
export async function seedTenantTillSif(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Waitron SL" })
    .onConflictDoNothing({ target: tenants.id });
  await db.insert(locations).values({
    id: TENANT_A.locationId,
    name: "Local principal",
    invoiceLocales: ["es"],
    operationDescription: "Venta en establecimiento",
  });
  await db
    .insert(tills)
    .values({ id: TENANT_A.tillId, locationId: TENANT_A.locationId, name: "Caja 1" });
  await db
    .insert(nodes)
    .values({ id: TENANT_A.nodeId, locationId: TENANT_A.locationId, name: "Node 1" });
  await db
    .insert(invoiceSeries)
    .values({ id: TENANT_A.seriesId, nodeId: TENANT_A.nodeId, code: "A" });
  await db.insert(sales).values({
    id: TENANT_A.saleId,
    tillId: TENANT_A.tillId,
    nodeId: TENANT_A.nodeId,
    seriesId: TENANT_A.seriesId,
    invoiceNumber: 1,
    issuedAt: ISSUED_AT,
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es",
    invoiceLocales: ["es"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  await db.insert(registroSif).values({
    id: TENANT_A.sifId,
    nodeId: TENANT_A.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "WAITRON01",
    numeroInstalacion: 1,
  });
}

/**
 * Seeds the parents registro-sif.test.ts needs: the taxpayer row, and three nodes across
 * two locations — `TENANT_A.nodeId`/`nodeId2` (two nodes registering under one NIF, proving the
 * installation-number counter is per (NIF, IdSIF), not per node) and `TENANT_B.nodeId` (a node
 * registering under a DIFFERENT NIF, proving the counter is not shared across identities either).
 *
 * Deliberately narrower than `seedTenantTillSif` above: no invoice series, no sale, no
 * pre-existing `registro_sif` row. `registerSif` is exactly what mints that row under test, so
 * seeding one here would make every "first registration" assertion false before the test body
 * even runs. The SIF is the node, so `registerSif` keys on these nodes. The tills are kept so the
 * sale-ringing snapshot has a real till to reference.
 */
export async function seedTenants(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Waitron SL" })
    .onConflictDoNothing({ target: tenants.id });
  await db.insert(locations).values(
    [TENANT_A.locationId, TENANT_B.locationId].map((id) => ({
      id,
      name: "Local principal",
      invoiceLocales: ["es"],
      operationDescription: "Venta en establecimiento",
    })),
  );
  await db.insert(tills).values([
    { id: TENANT_A.tillId, locationId: TENANT_A.locationId, name: "Caja 1" },
    { id: TENANT_A.tillId2, locationId: TENANT_A.locationId, name: "Caja 2" },
    { id: TENANT_B.tillId, locationId: TENANT_B.locationId, name: "Caja 1" },
  ]);
  await db.insert(nodes).values([
    { id: TENANT_A.nodeId, locationId: TENANT_A.locationId, name: "Node 1" },
    { id: TENANT_A.nodeId2, locationId: TENANT_A.locationId, name: "Node 2" },
    { id: TENANT_B.nodeId, locationId: TENANT_B.locationId, name: "Node 1" },
  ]);
}

/**
 * Advances a node's chain head to point at a fabricated-but-real `registros_facturacion` row,
 * standing in for "this node has actually sold something".
 *
 * Not a bare `update cadenas set ultima_huella = ...`, even though that would be enough to make
 * `esPrimerRegistro` observe a non-empty chain. `cadenas_puntero_ck`
 * (packages/fiscal-verifactu/src/schema/cadenas.ts) requires `ultimo_registro_id` and
 * `ultima_huella` to be BOTH null or BOTH set, so giving the chain head a huella without a real
 * row for `ultimo_registro_id`'s foreign key to point at is rejected by the database outright. The
 * fabricated `invoice_series` and `sales` rows exist
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
    /** Defaults to `"production"`: `drain.ts` refuses a row whose `entorno` is NULL or disagrees. */
    entorno?: Entorno | null;
  },
): Promise<void> {
  const entorno = params.entorno === undefined ? "production" : params.entorno;
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId: params.nodeId, code: `S${String(params.secuencia)}` })
    .returning({ id: invoiceSeries.id });
  const seriesId = series!.id;
  const [sale] = await db
    .insert(sales)
    .values({
      tillId: params.tillId,
      nodeId: params.nodeId,
      seriesId,
      invoiceNumber: params.secuencia,
      issuedAt: ISSUED_AT,
      issuedOffsetMinutes: 60,
      total: 0,
      vatBreakdown: [],
      locale: "es",
      invoiceLocales: ["es"],
      fiscalBackend: "verifactu",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  const [registro] = await db
    .insert(registrosFacturacion)
    .values({
      tillId: params.tillId,
      nodeId: params.nodeId,
      sifId: params.sifId,
      saleId: sale!.id,
      secuencia: params.secuencia,
      tipoRegistro: "alta",
      idEmisorFactura: params.nif,
      numSerieFactura: `S${String(params.secuencia)}/1`,
      fechaExpedicionFactura: "2026-07-20",
      nombreRazonEmisor: "Waitron SL",
      primerRegistro: true,
      sistemaInformatico: {},
      fechaHoraHusoGenRegistro: new Date(ISSUED_AT),
      offsetMinutos: 60,
      tipoHuella: "01",
      huella: params.huella,
      entorno,
    })
    .returning({ id: registrosFacturacion.id });
  const registroId = registro!.id;
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
// `registro_sif_instalacion_uq`.
let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(20_000_000 + nifSequence).padStart(8, "0")}K`;
}

async function insertLocationTillSeries(
  tx: Transaction,
): Promise<{ tillId: TillId; nodeId: NodeId; seriesId: SeriesId }> {
  const [location] = await tx
    .insert(locations)
    .values({
      name: "Sala principal",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const [till] = await tx
    .insert(tills)
    .values({ locationId: location!.id, name: "Caja 1" })
    .returning({ id: tills.id });
  const tillId = brandTillId(till!.id);
  const [node] = await tx
    .insert(nodes)
    .values({ locationId: location!.id, name: "Node 1" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);
  const [series] = await tx
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  return { tillId, nodeId, seriesId: brandSeriesId(series!.id) };
}

/**
 * Seeds location -> till -> invoice series, makes sure the one taxpayer row exists, and registers a
 * LIVE Veri*Factu SIF identity (via `registerSif`) — everything `write-path.e2e.test.ts` needs for
 * `VerifactuBackend.recordSale`'s own `currentSif` lookup to succeed. `seedTenantTillSif` above is
 * deliberately not reused for this: it seeds a ready-made SALE too (for `inmutabilidad.test.ts`'s
 * own fixed ids), which would collide with `write-path.e2e.test.ts`'s own first allocated invoice
 * number.
 *
 * Each call mints its OWN fresh NIF and its own node; `options.nif` overrides that minting. The
 * minted NIF comes from a module-level counter (`freshNif` above), so which one a test gets is
 * decided by how many `seedTenantWithSif` calls ran before it in the same file. The NIF is a HASHED
 * field (`IDEmisorFactura`, hashed by `@waitron/verifactu`), so a test that asserts a recorded
 * huella literal would otherwise break whenever a test is added or removed ABOVE it. Measured: the
 * same basket filed 16th in `write-path.e2e.test.ts` hashed to `38CCE164…` under NIF `20000016K`
 * and to `A1AF497F…` standalone under `20000001K`; pinning the NIF made both positions agree. Pass
 * a value no other test in the same file will mint — the counter starts at `20000001K` and climbs.
 *
 * WHAT THE OVERRIDE DOES NOT REACH. The `tenants` insert below does nothing when the row already
 * exists, so after an earlier seed the override reaches `registerSif` alone and the `tenants` row
 * keeps the `tax_id` the FIRST seed inserted. That is harmless for a pinned huella because the
 * hashed `IDEmisorFactura` is read from the SIF registration (`currentSif(tx, nodeId).nif`), not
 * from `tenants`. A test that needs `tenants.tax_id` itself to match must seed before anything
 * else does.
 */
export async function seedTenantWithSif(
  db: Database,
  options: { nif?: string } = {},
): Promise<SeededTillWithSif> {
  const nif = options.nif ?? freshNif();
  return db.transaction(async (tx) => {
    // The target is named rather than left bare so a `tenants_country_tax_id_key` collision — a
    // DIFFERENT cause — still raises.
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: nif, legalName: "Waitron SL" })
      .onConflictDoNothing({ target: tenants.id });
    const { tillId, nodeId, seriesId } = await insertLocationTillSeries(tx);
    await registerSif(tx, { nodeId, nif, idSistemaInformatico: "WT" });
    // No `working_orders` row and no `workingOrderId`: `recordSale` writes `input.workingOrderId`
    // to `sales.working_order_id`, a real FK onto `working_orders`, so the write-path suites here
    // record walk-up sales that omit it.
    return { tillId, nodeId, seriesId };
  });
}
