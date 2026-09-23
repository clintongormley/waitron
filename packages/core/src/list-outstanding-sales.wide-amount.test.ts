import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

/**
 * `listOutstandingSales` reads `sales.total` through RAW SQL, and a money column stores a count of
 * whole cents.
 *
 * ## Why this file was called `list-outstanding-sales.pg.test.ts`, and why it is not any more
 *
 * It existed because the two TARGETS disagreed about that read: real PostgreSQL through `pg` hands
 * an uncast `bigint` back as a STRING, PGlite as a number, so the PGlite suite beside it passed
 * whether the query cast or not and only a container could decide it. **There is one target now**,
 * and the sibling `list-outstanding-sales.test.ts` reads through the same
 * `cast(… as text)` → `rawCentsToDecimal` path this file does — so "the container is the decider"
 * is retired, and a `.pg.` in the filename would be a claim about an engine the file no longer
 * uses. Renamed for what actually remains: the WIDE amount.
 *
 * **LOST with the container:** the cross-target disagreement itself. Nothing now distinguishes a
 * driver that hands a big integer back as a string from one that hands it back as a number,
 * because there is only one driver. The text-versus-integer cast question is stated on
 * `packages/shared/src/cents.ts`'s `rawCentsToDecimal`.
 *
 * The first case is kept even though `list-outstanding-sales.test.ts:55` asserts the same thing on
 * the same engine: it is this file's CONTROL. Without an ordinary amount beside the wide one, a
 * failure on the wide case cannot be told from the read being broken for every amount.
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
