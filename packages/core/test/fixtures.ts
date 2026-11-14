import { readSettings, VENUE_SETTINGS } from "@waitron/db";
import { saleId as brandSaleId, seriesId as brandSeriesId, stringToCents } from "@waitron/shared";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { invoiceSeries, sales, tenants } from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedDevice, seedNode, seedVenue } from "@waitron/db/testing/seed.js";

export interface SeededTenant {
  deviceId: DeviceId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

let nifSequence = 0;

function freshNif(): string {
  nifSequence += 1;
  return `${String(10_000_000 + nifSequence).padStart(8, "0")}K`;
}

/**
 * Makes sure the one taxpayer row is there, then seeds the venue (first call only), a till device,
 * a node and that node's invoice series "A".
 * Each call mints its own node, so a second call gives a series owned by a different node.
 */
export async function seedTenant(db: Database): Promise<SeededTenant> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Waitron SL" })
    .onConflictDoNothing({ target: tenants.id });

  const existing = await readSettings(db, VENUE_SETTINGS);
  if (existing.revision === 0) {
    await seedVenue(db, {
      name: "Sala principal",
      invoiceLocales: ["es-ES", "ca-ES"],
      operationDescription: "Venta en establecimiento",
    });
  }

  const { deviceId } = await seedDevice(db);
  const nodeId = await seedNode(db);

  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A" })
    .returning({ id: invoiceSeries.id });
  const seriesId = brandSeriesId(series!.id);

  return { deviceId, nodeId, seriesId };
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
  seed: { deviceId: DeviceId; nodeId: NodeId; seriesId: SeriesId },
  overrides: {
    total?: string;
    invoiceNumber?: number;
    correctsSaleId?: SaleId;
    replacesOriginal?: boolean;
    vatBreakdown?: { rate: string; base: string; tax: string }[];
  } = {},
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId: seed.deviceId,
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
      replacesOriginal: overrides.replacesOriginal,
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}
