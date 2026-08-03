import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  sales,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  withTenant,
} from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let tenantId: TenantId;
let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ tenantId, tillId, nodeId, seriesId } = await seedTenant(suite.db));
});

function list() {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return listOutstandingSales(tx, tenantId);
  });
}

async function seedCorrective(
  originalId: SaleId,
  total: string,
  invoiceNumber: number,
): Promise<void> {
  await suite.db.insert(sales).values({
    tenantId,
    tillId,
    nodeId,
    seriesId,
    invoiceNumber,
    issuedAt: new Date("2026-08-01T11:30:00Z").toISOString(),
    issuedOffsetMinutes: 0,
    total,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    fiscalState: "recorded",
    correctsSaleId: originalId,
  });
}

describe("listOutstandingSales", () => {
  it("lists an unsettled ordinary sale with amountDue = total", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    const out = await list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      saleId,
      total: "70.00",
      correctionTotal: "0.00",
      amountDue: "70.00",
    });
    // The `::text` cast in the query is what makes `issuedAt` a genuine string; both drivers would
    // otherwise parse `timestamptz` to a Date, contradicting the `string` type on OutstandingSale.
    // Assert the type only — not the exact rendering — to avoid coupling to Postgres's text format.
    expect(typeof out[0]!.issuedAt).toBe("string");
  });

  it("nets a correction into amountDue and hides the corrective itself", async () => {
    const originalId = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await seedCorrective(originalId, "-5.00", 2);
    const out = await list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      saleId: originalId,
      total: "70.00",
      correctionTotal: "-5.00",
      amountDue: "65.00",
    });
  });

  it("hides a settled sale", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(tenders).values({
        tenantId,
        saleId,
        method: "cash",
        amount: "70.00",
        tipAmount: "0.00",
        settledAt: new Date("2026-08-01T12:00:00Z").toISOString(),
      });
      await tx.insert(saleSettlements).values({
        tenantId,
        saleId,
        settledAt: new Date("2026-08-01T12:00:00Z").toISOString(),
      });
    });
    expect(await list()).toHaveLength(0);
  });

  it("hides a voided sale", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await suite.db.insert(saleVoids).values({
      tenantId,
      saleId,
      reason: "test void",
      voidedAt: new Date("2026-08-01T12:00:00Z").toISOString(),
    });
    expect(await list()).toHaveLength(0);
  });

  it("hides an F3 canje sale (the substitute), showing neither it nor its settled ticket", async () => {
    // A settled simplified ticket, then an F3 that substitutes it.
    const ticketId = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(tenders).values({
        tenantId,
        saleId: ticketId,
        method: "cash",
        amount: "70.00",
        tipAmount: "0.00",
        settledAt: new Date("2026-08-01T12:00:00Z").toISOString(),
      });
      await tx.insert(saleSettlements).values({
        tenantId,
        saleId: ticketId,
        settledAt: new Date("2026-08-01T12:00:00Z").toISOString(),
      });
    });
    const f3Id = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 2 },
    );
    await suite.db
      .insert(saleSubstitutions)
      .values({ tenantId, substitutionSaleId: f3Id, substitutedSaleId: ticketId });

    const out = await list();
    expect(out.map((o) => o.saleId)).not.toContain(f3Id);
    expect(out).toHaveLength(0);
  });

  it("excludes another tenant's outstanding sales", async () => {
    // Primary tenant (the beforeEach one) has an outstanding sale, so there is something to return.
    const mineId = await seedBareSale(
      suite.db,
      { tenantId, tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    // A SECOND, independent tenant with its own outstanding sale. seedTenant with no override mints a
    // fresh tenant/till/node/series (a genuinely different tenantId), so this is another tenant's row
    // — not a second till under the same tenant.
    const other = await seedTenant(suite.db);
    const theirsId = await seedBareSale(suite.db, other, { total: "40.00", invoiceNumber: 1 });

    // list() runs under the PRIMARY tenant (withTenant + asAppUser), so it must see only its own.
    const out = await list();
    const ids = out.map((o) => o.saleId);
    expect(ids).toContain(mineId);
    expect(ids).not.toContain(theirsId);
    expect(out).toHaveLength(1);
  });
});
