import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  asAppUser,
  saleSettlements,
  saleSubstitutions,
  saleVoids,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
});

function list() {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return listOutstandingSales(tx);
  });
}

// Settle a sale directly (bypassing settleSale) as the app role: a covering tender, then the
// sale_settlements row. Tenders first — tenders_reject_post_settlement (WT002) rejects a tender once
// the settlement row exists.
async function settleDirectly(saleId: SaleId): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    await tx.insert(tenders).values({
      saleId,
      method: "cash",
      amount: "70.00",
      tipAmount: "0.00",
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
      { tillId, nodeId, seriesId },
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
      { tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await seedBareSale(
      suite.db,
      { tillId, nodeId, seriesId },
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

  it("hides a settled sale", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await settleDirectly(saleId);
    expect(await list()).toHaveLength(0);
  });

  it("hides a voided sale", async () => {
    const saleId = await seedBareSale(
      suite.db,
      { tillId, nodeId, seriesId },
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
      { tillId, nodeId, seriesId },
      { total: "70.00", invoiceNumber: 1 },
    );
    await settleDirectly(ticketId);
    const f3Id = await seedBareSale(
      suite.db,
      { tillId, nodeId, seriesId },
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
