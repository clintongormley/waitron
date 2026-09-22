import {
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  decimal,
  decimalToCents,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { invoiceSeries, locations, nodes, sales, tenants, tills } from "@waitron/db";
import type { Database } from "@waitron/db";

export interface SeededTenant {
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
 * Makes sure the one taxpayer row is there, then seeds location -> till -> node -> invoice series
 * for `record-sale.test.ts`, directly through the fixture connection.
 *
 * The invoice series is keyed to the NODE, not the till (node-id rekey, 2026-08-03: the SIF is the
 * node, #33). Each call mints its own location, till and node, which is exactly the shape
 * `record-sale.test.ts`'s "rejects a series belonging to another node" test needs: a series that is
 * real but owned by a different node than the one under test (the returned `nodeId` is genuinely
 * different from the first call's). The taxpayer row is a singleton, so only the first call
 * inserts it.
 */
export async function seedTenant(db: Database): Promise<SeededTenant> {
  // Through the table definitions, not raw SQL: `id` and `created_at` are `$defaultFn` generators
  // that only the insert BUILDER runs, and `invoice_locales` is a list the column's own mapping
  // encodes. A raw insert omitting them is refused (`NOT NULL constraint failed: tenants.created_at`).
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Waitron SL" })
    .onConflictDoNothing({ target: tenants.id });

  const [location] = await db
    .insert(locations)
    .values({
      name: "Sala principal",
      invoiceLocales: ["es-ES", "ca-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const locationId = location!.id;

  const [till] = await db
    .insert(tills)
    .values({ locationId, name: "Caja 1" })
    .returning({ id: tills.id });
  const tillId = brandTillId(till!.id);

  const [node] = await db
    .insert(nodes)
    .values({ locationId, name: "Nodo 1" })
    .returning({ id: nodes.id });
  const nodeId = brandNodeId(node!.id);

  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  const seriesId = brandSeriesId(series!.id);

  // No `working_orders` row and no `workingOrderId`: `recordSale` now WRITES `input.workingOrderId`
  // to `sales.working_order_id`, a real FK onto `working_orders` (sub-project 7b). A fabricated id
  // would FK-violate on the insert, so this fixture mints none — the walk-up sales every suite here
  // records omit it and the column inserts NULL. A test that needs the linkage seeds its own real
  // `working_orders` row and passes its id explicitly (see record-sale.test.ts's "working order
  // linkage").
  return { tillId, nodeId, seriesId };
}

/**
 * Adds a second series to an EXISTING node whose `purpose` is `rectificative`, returning its id
 * (node-id rekey, 2026-08-03: a series is owned by a node, #33). `recordCorrection` requires such a
 * series (a correction must draw its number from a corrective series, never an ordinary one — RD
 * 1619/2012 art. 6.1.a); `recordSale` requires the opposite. Uses the fixture connection directly,
 * like `seedTenant`.
 */
export async function seedRectificativeSeries(
  db: Database,
  nodeId: NodeId,
  code = "R",
): Promise<SeriesId> {
  const [row] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code, purpose: "rectificative" })
    .returning({ id: invoiceSeries.id });
  return brandSeriesId(row!.id);
}

/**
 * Inserts one `sales` row directly through the fixture connection.
 * For tests that need an ORIGINAL sale to correct without
 * routing it through `recordSale` (so it has NO backend fiscal record, or so an original can be
 * planted under another node or series). Written on the current schema: `total` is the
 * only money column. `correctsSaleId` defaults to NULL for an ordinary original; pass it to seed a
 * rectificativa instead (its negative/positive total is what `sales_total_ck` permits once it is set).
 *
 * `total` is given as the decimal amount a caller reads — "65.00" — and converted to the count of
 * whole cents the column stores on the way in, so this fixture is the same edge `recordSale` is.
 */
export async function seedBareSale(
  db: Database,
  seed: { tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  overrides: {
    total?: string;
    invoiceNumber?: number;
    correctsSaleId?: SaleId;
    vatBreakdown?: { rate: string; base: string; tax: string }[];
  } = {},
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: overrides.invoiceNumber ?? 1,
      issuedAt: new Date("2026-03-01T12:00:00Z").toISOString(),
      issuedOffsetMinutes: 0,
      total: decimalToCents(decimal(overrides.total ?? "65.00")),
      // The filed per-rate desglose. Defaults to `[]`: a bare original planted for a
      // correction test carries no line detail here, and the correction's OWN breakdown is what those
      // tests exercise (via recordCorrection). Overridable for a test that needs a specific one.
      vatBreakdown: overrides.vatBreakdown ?? [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
      correctsSaleId: overrides.correctsSaleId,
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}
