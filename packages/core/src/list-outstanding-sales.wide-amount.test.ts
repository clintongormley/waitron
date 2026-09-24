import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

/**
 * `listOutstandingSales` reads `sales.total` through raw SQL. The first case is the control:
 * without an ordinary amount beside the wide one, a failure on the wide case could not be told
 * from the read being broken for every amount.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

describe("listOutstandingSales reads a wide count of cents back as its printed amount", () => {
  it("reads the stored count of cents back as the printed amount", async () => {
    const seed = await seedTenant(suite.db);
    const saleId = await seedBareSale(suite.db, seed, { total: "70.00", invoiceNumber: 1 });

    const out = await withTransaction(suite.db, async (tx) => {
      return listOutstandingSales(tx);
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      saleId,
      total: "70.00",
      correctionTotal: "0.00",
      amountDue: "70.00",
    });
  });

  it("reads an amount past the four-byte ceiling", async () => {
    // 2147483648 cents is one past what a four-byte integer holds, and an ordinary amount for a
    // column that stores twelve integer digits. The case checks that the wide count converts to
    // the exact printed amount rather than to a rounded or truncated one.
    const seed = await seedTenant(suite.db);
    const saleId = await seedBareSale(suite.db, seed, {
      total: "21474836.48",
      invoiceNumber: 2,
    });

    const out = await withTransaction(suite.db, async (tx) => {
      return listOutstandingSales(tx);
    });

    expect(out.find((r) => r.saleId === saleId)).toMatchObject({
      total: "21474836.48",
      correctionTotal: "0.00",
      amountDue: "21474836.48",
    });
  });
});
