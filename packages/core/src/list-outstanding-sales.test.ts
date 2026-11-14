import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { DeviceId, NodeId, SaleId, SeriesId } from "@waitron/shared";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let deviceId: DeviceId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ deviceId, nodeId, seriesId } = await seedTenant(suite.db));
});

function list() {
  return withTransaction(suite.db, async (tx) => {
    return listOutstandingSales(tx);
  });
}

// Settle a sale directly (bypassing settleSale): a covering tender, then the sale_settlements
// row. Tenders first — tenders_reject_post_settlement rejects a tender once the settlement row
// exists.
async function settleDirectly(saleId: SaleId): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(tenders).values({
      saleId,
      method: "cash",
      // Money columns hold whole cents: 7000 is the 70.00 that covers `seedBareSale`'s default.
      amount: 7000,
      tipAmount: 0,
      settledAt: new Date("2026-08-01T12:00:00Z").toISOString(),
    });
    await tx.insert(saleSettlements).values({
      saleId,
      settledAt: new Date("2026-08-01T12:00:00Z").toISOString(),
    });
  });
}

describe("listOutstandingSales", () => {
  it("lists an unsettled ordinary sale with amountDue = total", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
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
    expect(typeof out[0]!.issuedAt).toBe("string");
  });

  it("lists each sale with the device it was rung on", async () => {
    await seedBareSale(suite.db, { deviceId, nodeId, seriesId }, { invoiceNumber: 1 });
    const [sale] = await list();
    expect(sale!.origin).toEqual({ source: "device", deviceId });
  });

  it("nets a correction into amountDue and hides the corrective itself", async () => {
    const originalId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "-5.00", invoiceNumber: 2, correctsSaleId: originalId },
    );
    const out = await list();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      saleId: originalId,
      total: "70.00",
      correctionTotal: "-5.00",
      amountDue: "65.00",
    });
  });

  it("lists a replaced sale once, owing what it owed, and 3.00 less after a refund of its replacement", async () => {
    const seed = { deviceId, nodeId, seriesId };
    const replaced = await seedBareSale(suite.db, seed, { total: "12.10", invoiceNumber: 1 });
    const replacement = await seedBareSale(suite.db, seed, {
      total: "12.10",
      invoiceNumber: 2,
      correctsSaleId: replaced,
      replacesOriginal: true,
    });
    expect((await list()).map((sale) => [sale.saleId, sale.amountDue])).toEqual([
      [replaced, "12.10"],
    ]);

    await seedBareSale(suite.db, seed, {
      total: "-3.00",
      invoiceNumber: 3,
      correctsSaleId: replacement,
    });
    expect(await list()).toEqual([
      expect.objectContaining({
        saleId: replaced,
        total: "12.10",
        correctionTotal: "-3.00",
        amountDue: "9.10",
      }),
    ]);
  });

  it("hides a settled sale", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await settleDirectly(saleId);
    expect(await list()).toHaveLength(0);
  });

  it("keeps another sale outstanding when one sale is settled", async () => {
    const settledId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    const outstandingId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "45.00", invoiceNumber: 2 },
    );
    await settleDirectly(settledId);

    expect(await list()).toMatchObject([
      { saleId: outstandingId, invoiceNumber: 2, total: "45.00", amountDue: "45.00" },
    ]);
  });

  it("hides a voided sale", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await suite.db.insert(saleVoids).values({
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
      { deviceId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await settleDirectly(ticketId);
    const f3Id = await seedBareSale(
      suite.db,
      { deviceId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 2 },
    );
    await suite.db
      .insert(saleSubstitutions)
      .values({ substitutionSaleId: f3Id, substitutedSaleId: ticketId });

    const out = await list();
    expect(out.map((o) => o.saleId)).not.toContain(f3Id);
    expect(out).toHaveLength(0);
  });
});
