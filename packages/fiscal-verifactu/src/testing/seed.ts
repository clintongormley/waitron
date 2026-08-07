import { sql } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { nodeId as brandNodeId, tenantId, tillId as brandTillId } from "@waitron/shared";
import type { NodeId, TenantId, TillId } from "@waitron/shared";
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

/**
 * A seeded fiscal fixture: one NODE (the SIF/chain owner) with one TILL under it (node-id rekey,
 * 2026-08-03). The chain, series and SIF are keyed by `nodeId`; a sale still rings at `tillId`, and
 * that till is the informational snapshot stamped onto `sales.till_id`/`registros_facturacion.till_id`.
 */
export interface SeededTill {
  tenantId: TenantId;
  /** Where a sale rings (still NOT NULL on `sales`/`registros_facturacion` — the snapshot). */
  tillId: TillId;
  /** The SIF/chain/series owner (node-id rekey, 2026-08-03). Every chain op keys on this. */
  nodeId: NodeId;
  seriesId: string;
  sifId: string;
}

// Module-scope, not per-call: every test file that imports seedTill shares this counter across its
// WHOLE run, which is exactly what makes each call's nif collision-free against
// tenants_country_tax_id_key — including across the many beforeEach calls a concurrency suite fires.
let nifSequence = 0;

/**
 * A fresh, plausible-looking NIF, unique for the lifetime of the test process. `tenants.tax_id`
 * carries no format CHECK (packages/db/src/schema/tenants.ts), so nothing validates the checksum
 * digit — this exists purely to dodge `tenants_country_tax_id_key`, never to look up a real obligado.
 */
function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

async function insertTenant(tx: Transaction, nif: string): Promise<TenantId> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into tenants (country, tax_id, legal_name) values ('ES', ${nif}, ${"Waitron SL"}) returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedTill: tenant insert returned no row");
  return tenantId(row.id);
}

/** Inserts one location under an EXISTING tenant and returns its id — the FK a node and a till both
 * need. */
async function insertLocation(tx: Transaction, tenant: TenantId, label: string): Promise<string> {
  const location = await tx.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, ${"Sala " + label}, array['es'], ${"Venta en establecimiento"})
    returning id
  `);
  const locationRow = location.rows[0];
  if (locationRow === undefined) throw new Error("seedTill: location insert returned no row");
  return locationRow.id;
}

/** Inserts one node under an EXISTING tenant+location and returns its id — the SIF/chain/series
 * owner (node-id rekey, 2026-08-03). */
async function insertNode(
  tx: Transaction,
  tenant: TenantId,
  location: string,
  label: string,
): Promise<NodeId> {
  const node = await tx.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name)
    values (${tenant}, ${location}, ${"Node " + label})
    returning id
  `);
  const nodeRow = node.rows[0];
  if (nodeRow === undefined) throw new Error("seedTill: node insert returned no row");
  return brandNodeId(nodeRow.id);
}

/** Inserts one till under an EXISTING tenant+location and returns its id — where a sale rings. */
async function insertTill(
  tx: Transaction,
  tenant: TenantId,
  location: string,
  label: string,
): Promise<TillId> {
  const till = await tx.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenant}, ${location}, ${"Till " + label})
    returning id
  `);
  const tillRow = till.rows[0];
  if (tillRow === undefined) throw new Error("seedTill: till insert returned no row");
  return brandTillId(tillRow.id);
}

/** Adds one node (+ location + till + a node-keyed series + a live SIF registration) under an
 * EXISTING tenant. The series and SIF are keyed on the NODE (node-id rekey, 2026-08-03); the till
 * is the sale-ringing snapshot. */
async function addTill(
  tx: Transaction,
  tenant: TenantId,
  nif: string,
  label: string,
): Promise<SeededTill> {
  const location = await insertLocation(tx, tenant, label);
  const node = await insertNode(tx, tenant, location, label);
  const tillId = await insertTill(tx, tenant, location, label);

  const series = await tx.execute<{ id: string }>(sql`
    insert into invoice_series (tenant_id, node_id, code, purpose, next_number)
    values (${tenant}, ${node}, ${"G" + label}, ${"standard"}, 1)
    returning id
  `);
  const seriesRow = series.rows[0];
  if (seriesRow === undefined) throw new Error("seedTill: series insert returned no row");

  const sif = await registerSif(tx, {
    tenantId: tenant,
    nodeId: node,
    nif,
    idSistemaInformatico: TEST_SISTEMA.IdSistemaInformatico,
  });

  return { tenantId: tenant, tillId, nodeId: node, seriesId: seriesRow.id, sifId: sif.id };
}

/**
 * Inserts tenant → location → node → till → node-keyed series and registers a live Veri*Factu SIF
 * identity for the node, returning every id `appendToChain` needs. Each call gets its OWN fresh
 * tenant (and therefore its own NIF, via `freshNif()`) — this is what lets
 * `chain.concurrency.test.ts`'s `beforeEach` reseed on every test without truncating (and therefore
 * without ever touching `registros_facturacion`'s append-only, TRUNCATE-blocking trigger — see that
 * file's own note).
 */
export async function seedTill(db: Database, label = "A"): Promise<SeededTill> {
  const nif = freshNif();
  return db.transaction(async (tx) => addTill(tx, await insertTenant(tx, nif), nif, label));
}

/**
 * Adds a SECOND till (+ its own node-keyed series) under the SAME node of an ALREADY-seeded fixture,
 * returning a `SeededTill` that shares the original's `tenantId`/`nodeId`/`sifId` but carries the NEW
 * till and NEW series. For the "two tills, one node → one chain" property (node-id rekey,
 * 2026-08-03): a sale rung at either till appends to the one per-node chain. A second series is
 * created so each till can draw its own numbers, but both series belong to the SAME node — the chain
 * is the node's.
 */
export async function addTillToNode(
  db: Database,
  seed: SeededTill,
  label: string,
): Promise<SeededTill> {
  return db.transaction(async (tx) => {
    // Reuse the node's own location so the till sits under the same venue.
    const [locationRow] = (
      await tx.execute<{ location_id: string }>(sql`
        select location_id from nodes where id = ${seed.nodeId}
      `)
    ).rows;
    if (locationRow === undefined) throw new Error("addTillToNode: node not found");
    const tillId = await insertTill(tx, seed.tenantId, locationRow.location_id, label);
    const series = await tx.execute<{ id: string }>(sql`
      insert into invoice_series (tenant_id, node_id, code, purpose, next_number)
      values (${seed.tenantId}, ${seed.nodeId}, ${"G" + label}, ${"standard"}, 1)
      returning id
    `);
    const seriesRow = series.rows[0];
    if (seriesRow === undefined) throw new Error("addTillToNode: series insert returned no row");
    return {
      tenantId: seed.tenantId,
      tillId,
      nodeId: seed.nodeId,
      seriesId: seriesRow.id,
      sifId: seed.sifId,
    };
  });
}

/** Inserts one location + node under an EXISTING tenant, deliberately WITHOUT registering a SIF —
 * the counterpart to addTill above, for callers that need to fire registerSif THEMSELVES afterwards.
 * See seedNodesForSifContention's doc comment for why this split exists. */
async function addBareNode(tx: Transaction, tenant: TenantId, label: string): Promise<NodeId> {
  const location = await insertLocation(tx, tenant, label);
  return insertNode(tx, tenant, location, label);
}

export interface SifContentionFixture {
  tenantId: TenantId;
  nif: string;
  nodeIds: NodeId[];
}

/**
 * `count` DISTINCT nodes under ONE fresh tenant — therefore one shared NIF — with NO SIF
 * registration yet. Exists for exactly one test (chain.concurrency.test.ts's retargeted Task 13
 * counter-contention suite): proving `contadores_instalacion`'s (NIF, IdSistemaInformatico)
 * allocator holds when many DIFFERENT nodes of one obligado race it concurrently (node-id rekey,
 * 2026-08-03: the SIF — and therefore the counter's client — is the node, #33).
 *
 * Deliberately NOT built on `seedTill`/`addTill`, which always register a SIF as part of creating
 * the fixture: doing that here would mint `count` installation numbers ONE AT A TIME, sequentially,
 * during setup — the opposite of what this fixture is for. The nodes must exist, UNREGISTERED, so
 * the test can fire every registerSif call itself, concurrently, as the thing under test.
 *
 * One SIF-registration per node, not several against one node: `registerSif` also revokes any
 * existing live registration for that (tenant, node) before minting a new one (two separate
 * statements, not one atomic step), which races a DIFFERENT, out-of-scope hazard — concurrent
 * RE-registration of the SAME node from multiple processes — that this fixture is not testing.
 * registerSif's own doc comment (./registro-sif.ts) frames re-registration as a rare, sequential,
 * admin-only event ("not a mid-service event"); concurrent re-registration of one node is not a
 * scenario that occurs in production and is not what Task 13's deferred counter test was about.
 */
export async function seedNodesForSifContention(
  db: Database,
  count: number,
): Promise<SifContentionFixture> {
  const nif = freshNif();
  return db.transaction(async (tx) => {
    const tenant = await insertTenant(tx, nif);
    const nodeIds: NodeId[] = [];
    for (let i = 0; i < count; i++) {
      nodeIds.push(await addBareNode(tx, tenant, `N${i}`));
    }
    return { tenantId: tenant, nif, nodeIds };
  });
}

/**
 * Inserts one core `sales` row and returns its id — the FK `registros_facturacion.sale_id` needs.
 * Writes BOTH `till_id` (where the sale rang) AND `node_id` (which node chained it) — the two the
 * node-id rekey (2026-08-03) keeps side by side on `sales`.
 *
 * `total` is `'0.00'` and NO tender or `sale_settlements` row is written: migration 0012 dropped
 * `tip_amount`/`amount_charged` from `sales` and retired the old commit-time
 * `sales_assert_tenders_cover` deferred trigger, so a bare, unsettled sale is a legitimate steady
 * state (design §3) and nothing checks coverage against it — the same convention this package's own
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
    insert into sales (tenant_id, till_id, node_id, series_id, invoice_number, issued_at,
                       issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
                       fiscal_backend, fiscal_state)
    values (${till.tenantId}, ${till.tillId}, ${till.nodeId}, ${till.seriesId}, ${invoiceNumber},
            '2026-07-20T19:20:30+02:00', 120,
            '0.00', '[]'::jsonb,
            'es', array['es'], 'verifactu', 'recorded')
    returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new Error("seedSale inserted nothing");
  return row.id;
}

/**
 * A minimal alta ready for appendToChain — Encadenamiento is chain-owned, not this fixture's.
 * `tillId` is the sale-ringing snapshot the immutable `registros_facturacion.till_id` records
 * (node-id rekey, 2026-08-03: it rides on the `PendingRegistro` beside `saleId`, never inside
 * `input` — it is not an AEAT field and must never be hashed).
 *
 * Return type is the NARROWED `tipo: "alta"` branch, not the full `PendingRegistro` union: an
 * explicit `: PendingRegistro` annotation here would make every caller's `.input` access see the
 * union of BOTH branches' `input` shapes (TS does not narrow a union on an annotated return type),
 * which is exactly what broke `chain.test.ts`'s "stores the exact literals" test when first
 * written — `altaFor(...).input` needs to type as this branch's own `Omit<AltaInput,
 * "Encadenamiento">`, not `Omit<AltaInput, ...> | Omit<AnulacionInput, ...>`.
 */
export function altaFor(
  tillId: TillId,
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
  return { tipo: "alta", saleId, tillId, entorno, input };
}

/** A minimal anulación against an already-issued invoice. `tillId` is the sale-ringing snapshot,
 * exactly as `altaFor`. Narrowed return type — see altaFor's doc comment for why. */
export function anulacionFor(
  tillId: TillId,
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
  return { tipo: "anulacion", saleId, tillId, entorno, input };
}
