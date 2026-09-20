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
});
