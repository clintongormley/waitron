import {
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  stringToCents,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { invoiceSeries, locations, nodes, sales, tenants, tills } from "@waitron/db";
import type { Database } from "@waitron/db";

export interface SeededTenant {
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

/**
 * Makes sure the one taxpayer row is there, then seeds location -> till -> node -> invoice series.
 * Each call mints its own node, so a second call gives a series owned by a different node.
 */
export async function seedTenant(db: Database): Promise<SeededTenant> {
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

  return { tillId, nodeId, seriesId };
}

/**
 * Adds a `rectificative` series to an existing node, as `recordCorrection` requires.
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
 * Inserts one `sales` row directly, for a test that needs an original sale with no fiscal record
 * or one planted under another node or series. Pass `correctsSaleId` to seed a corrective invoice.
 * `total` is a decimal ("65.00"), converted to whole cents as `recordSale` does.
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
      total: stringToCents(overrides.total ?? "65.00"),
      // Empty by default: the tests that plant a bare original exercise the correction's own
      // breakdown.
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
