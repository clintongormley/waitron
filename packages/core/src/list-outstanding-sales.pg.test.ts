import { describe, expect, it } from "vitest";
import { asAppUser, withTransaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedBareSale, seedTenant } from "../test/fixtures.js";
import { listOutstandingSales } from "./list-outstanding-sales.js";

/**
 * `listOutstandingSales` reads `sales.total` through RAW SQL, and a money column stores a count of
 * whole cents in a `bigint`. Which is exactly the read the two test targets disagree about: real
 * PostgreSQL through `pg` hands an uncast `bigint` back as a STRING, PGlite as a number. The PGlite
 * suite beside this file therefore passes whether the query casts or not, so the container is the
 * only thing that can decide it.
 */
const postgres = useTemplateDb({ template: "core_identity" });

describe("listOutstandingSales on real PostgreSQL", () => {
  it("reads the stored count of cents back as the printed amount", async () => {
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedBareSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });

    const out = await withTransaction(postgres.admin, async (tx) => {
      await asAppUser(tx);
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
    // 2147483648 cents is one past what a four-byte integer renders, and an ordinary amount for a
    // column that stores twelve integer digits. Under the `::int` cast this read failed with
    // `22003` / "integer out of range" — a value the column had already accepted on the way in
    // being refused on the way out, which is the band the columns were widened to `bigint` to
    // carry. The container is the decider: PGlite hands an uncast `bigint` back as a number and
    // would pass either way.
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedBareSale(postgres.admin, seed, {
      total: "21474836.48",
      invoiceNumber: 2,
    });

    const out = await withTransaction(postgres.admin, async (tx) => {
      await asAppUser(tx);
      return listOutstandingSales(tx);
    });

    expect(out.find((r) => r.saleId === saleId)).toMatchObject({
      total: "21474836.48",
      correctionTotal: "0.00",
      amountDue: "21474836.48",
    });
  });
});
