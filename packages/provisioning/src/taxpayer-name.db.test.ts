import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { readActivityForSubject, taxpayer, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { changeTaxpayerDomicile, renameTaxpayer } from "./index.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

async function stored() {
  const [row] = await suite.db.select().from(taxpayer).where(eq(taxpayer.id, 1));
  return row;
}

describe("renameTaxpayer", () => {
  beforeEach(async () => {
    await suite.db.insert(taxpayer).values({
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
      renameTaxpayer(tx, { personId: null, expected: "Deli SL", legalName: "Deli Nueva SL" }),
    );

    expect(result).toEqual({ renamed: true });
    expect(await stored()).toEqual({ ...before, legalName: "Deli Nueva SL" });
  });

  it("writes nothing when the stored name is not the one expected", async () => {
    const result = await withTransaction(suite.db, (tx) =>
      renameTaxpayer(tx, {
        personId: null,
        expected: "Someone Else SL",
        legalName: "Deli Nueva SL",
      }),
    );

    expect(result).toEqual({ renamed: false });
    expect((await stored())?.legalName).toBe("Deli SL");
  });
});

it("records the old and new legal name with the actor", async () => {
  await suite.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Old SL" });
  await withTransaction(suite.db, (tx) =>
    renameTaxpayer(tx, { expected: "Old SL", legalName: "New SL", personId: null }),
  );
  const entries = await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "taxpayer.legal_name_changed",
    personId: null,
    data: { from: "Old SL", to: "New SL" },
  });
  await withTransaction(suite.db, (tx) =>
    renameTaxpayer(tx, { expected: "Old SL", legalName: "Other SL", personId: null }),
  );
  expect(await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" })).toEqual(entries);
});

describe("changeTaxpayerDomicile", () => {
  async function seed(taxpayerDomicile: string | null) {
    await suite.db.insert(taxpayer).values({
      id: 1,
      country: "ES",
      taxId: "B12345678",
      legalName: "Deli SL",
      taxpayerDomicile,
    });
  }

  it("changes the registered address and nothing else, and records the old and new address", async () => {
    await seed("2º 1ª");
    const before = await stored();
    const result = await withTransaction(suite.db, (tx) =>
      changeTaxpayerDomicile(tx, {
        personId: null,
        expected: "2º 1ª",
        taxpayerDomicile: "Calle Mayor 1, 2º 1ª, 08010 Barcelona",
      }),
    );
    expect(result).toEqual({ changed: true });
    expect(await stored()).toEqual({
      ...before,
      taxpayerDomicile: "Calle Mayor 1, 2º 1ª, 08010 Barcelona",
    });
    const entries = await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "taxpayer.domicile_changed",
      personId: null,
      data: { from: "2º 1ª", to: "Calle Mayor 1, 2º 1ª, 08010 Barcelona" },
    });
  });

  it("writes nothing and records nothing when the stored address is not the one expected", async () => {
    await seed("2º 1ª");
    const result = await withTransaction(suite.db, (tx) =>
      changeTaxpayerDomicile(tx, {
        personId: null,
        expected: "Somewhere else",
        taxpayerDomicile: "Calle Mayor 1, Madrid",
      }),
    );
    expect(result).toEqual({ changed: false });
    expect((await stored())?.taxpayerDomicile).toBe("2º 1ª");
    expect(await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" })).toEqual([]);
  });

  it("fills an address that was never stored only when null is expected", async () => {
    await seed(null);
    const refused = await withTransaction(suite.db, (tx) =>
      changeTaxpayerDomicile(tx, {
        personId: null,
        expected: "",
        taxpayerDomicile: "Calle Mayor 1",
      }),
    );
    expect(refused).toEqual({ changed: false });
    const result = await withTransaction(suite.db, (tx) =>
      changeTaxpayerDomicile(tx, {
        personId: null,
        expected: null,
        taxpayerDomicile: "Calle Mayor 1",
      }),
    );
    expect(result).toEqual({ changed: true });
    expect((await stored())?.taxpayerDomicile).toBe("Calle Mayor 1");
    const entries = await readActivityForSubject(suite.db, { kind: "taxpayer", id: "1" });
    expect(entries[0]).toMatchObject({ data: { from: null, to: "Calle Mayor 1" } });
  });
});
