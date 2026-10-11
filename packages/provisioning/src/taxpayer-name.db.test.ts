import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { tenants, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { renameTaxpayer } from "./index.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

async function stored() {
  const [row] = await suite.db.select().from(tenants).where(eq(tenants.id, 1));
  return row;
}

describe("renameTaxpayer", () => {
  beforeEach(async () => {
    await suite.db.insert(tenants).values({
      id: 1,
      country: "ES",
      taxId: "B12345678",
      legalName: "Deli SL",
      taxpayerDomicile: "Calle Mayor 1, Madrid",
    });
  });

  it("changes the legal name and nothing else when the stored name is the one expected", async () => {
    const before = await stored();
    const result = await withTransaction(suite.db, (tx) =>
      renameTaxpayer(tx, { expected: "Deli SL", legalName: "Deli Nueva SL" }),
    );

    expect(result).toEqual({ renamed: true });
    expect(await stored()).toEqual({ ...before, legalName: "Deli Nueva SL" });
  });

  it("writes nothing when the stored name is not the one expected", async () => {
    const result = await withTransaction(suite.db, (tx) =>
      renameTaxpayer(tx, { expected: "Someone Else SL", legalName: "Deli Nueva SL" }),
    );

    expect(result).toEqual({ renamed: false });
    expect((await stored())?.legalName).toBe("Deli SL");
  });
});
