import { sql } from "drizzle-orm";
import {
  nodeId as brandNodeId,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { saleLines, saleSubstitutions, saleVoids, sales, tenders } from "@waitron/db";
import type { Database } from "@waitron/db";
import type { TenderMethod } from "../src/types.js";

export interface SeededVenue {
  tenantId: TenantId;
  locationId: string;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
}

// Off every other generator's base (see packages/db/src/testing/seed.ts's note) to avoid a
// tenants_nif_key collision if a suite ever seeds through two generators.
let nifCounter = 0;
function freshNif(): string {
  nifCounter += 1;
  return `${String(50_000_000 + nifCounter).padStart(8, "0")}K`;
}

export async function seedVenue(db: Database): Promise<SeededVenue> {
  const t = await db.execute<{ id: string }>(
    sql`insert into tenants (nif, legal_name) values (${freshNif()}, 'Test SL') returning id`,
  );
  const tenantId = brandTenantId(t.rows[0]!.id);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['es-ES'], 'Test op') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`,
  );
  const tillId = brandTillId(till.rows[0]!.id);
  const node = await db.execute<{ id: string }>(
    sql`insert into nodes (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Node 1') returning id`,
  );
  const nodeId = brandNodeId(node.rows[0]!.id);
  const series = await db.execute<{ id: string }>(
    sql`insert into invoice_series (tenant_id, node_id, code) values (${tenantId}, ${nodeId}, 'A') returning id`,
  );
  const seriesId = brandSeriesId(series.rows[0]!.id);
  return { tenantId, locationId, tillId, nodeId, seriesId };
}

export async function seedTill(
  db: Database,
  tenantId: TenantId,
  locationId: string,
): Promise<TillId> {
  const till = await db.execute<{ id: string }>(
    sql`insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 2') returning id`,
  );
  return brandTillId(till.rows[0]!.id);
}

export async function seedSale(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  opts: {
    invoiceNumber: number;
    issuedAt: string;
    total: string;
    lines: Array<{ vatRate: string; lineTotal: string }>;
    correctsSaleId?: SaleId;
  },
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: opts.invoiceNumber,
      issuedAt: opts.issuedAt,
      issuedOffsetMinutes: 0,
      total: opts.total,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
      correctsSaleId: opts.correctsSaleId,
    })
    .returning({ id: sales.id });
  const saleId = brandSaleId(row!.id);
  await db.insert(saleLines).values(
    opts.lines.map((line, i) => ({
      tenantId: seed.tenantId,
      saleId,
      lineNo: i + 1,
      descriptions: { "es-ES": "Item" },
      quantity: "1.000",
      unitPrice: line.lineTotal,
      vatRate: line.vatRate,
      lineTotal: line.lineTotal,
    })),
  );
  return saleId;
}

export async function seedTender(
  db: Database,
  ref: { tenantId: TenantId; saleId: SaleId },
  opts: { method: TenderMethod; amount: string; tipAmount?: string; settledAt: string },
): Promise<void> {
  await db.insert(tenders).values({
    tenantId: ref.tenantId,
    saleId: ref.saleId,
    method: opts.method,
    amount: opts.amount,
    tipAmount: opts.tipAmount ?? "0.00",
    settledAt: opts.settledAt,
  });
}

export async function seedVoid(
  db: Database,
  ref: { tenantId: TenantId; saleId: SaleId },
  voidedAt: string,
): Promise<void> {
  await db.insert(saleVoids).values({
    tenantId: ref.tenantId,
    saleId: ref.saleId,
    reason: "test void",
    voidedAt,
  });
}

export async function seedSubstitution(
  db: Database,
  ref: { tenantId: TenantId; substitutionSaleId: SaleId; substitutedSaleId: SaleId },
): Promise<void> {
  await db.insert(saleSubstitutions).values({
    tenantId: ref.tenantId,
    substitutionSaleId: ref.substitutionSaleId,
    substitutedSaleId: ref.substitutedSaleId,
  });
}
