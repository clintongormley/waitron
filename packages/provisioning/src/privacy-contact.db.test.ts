import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tenants, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readPrivacyContact, savePrivacyContact } from "./index.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

async function stored() {
  const [row] = await suite.db.select().from(tenants).where(eq(tenants.id, 1));
  return row;
}

async function insertTaxpayer() {
  await suite.db.insert(tenants).values({
    id: 1,
    country: "ES",
    taxId: "B12345678",
    legalName: "Deli SL",
    taxpayerDomicile: "Calle Mayor 1, Madrid",
  });
}

describe("readPrivacyContact and savePrivacyContact", () => {
  it("reads both fields as unset on a fresh taxpayer row", async () => {
    await insertTaxpayer();

    const contact = await withTransaction(suite.db, (tx) => readPrivacyContact(tx));

    expect(contact).toEqual({ privacyNoticeUrl: null, privacyEmail: null });
  });

  it("stores both fields and changes nothing else in the row", async () => {
    await insertTaxpayer();
    const before = await stored();

    const result = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, {
        privacyNoticeUrl: "https://example.com/privacy",
        privacyEmail: "privacy@example.com",
      }),
    );

    expect(result).toEqual({
      privacyNoticeUrl: "https://example.com/privacy",
      privacyEmail: "privacy@example.com",
    });
    expect(await stored()).toEqual({
      ...before,
      privacyNoticeUrl: "https://example.com/privacy",
      privacyEmail: "privacy@example.com",
    });
  });

  it("saving one field leaves the other as stored", async () => {
    await insertTaxpayer();
    await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, {
        privacyNoticeUrl: "https://example.com/privacy",
        privacyEmail: "privacy@example.com",
      }),
    );
    const before = await stored();

    const result = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: "data@example.com" }),
    );

    expect(result).toEqual({
      privacyNoticeUrl: "https://example.com/privacy",
      privacyEmail: "data@example.com",
    });
    expect(await stored()).toEqual({ ...before, privacyEmail: "data@example.com" });
  });

  it("saving null stores SQL NULL", async () => {
    await insertTaxpayer();
    await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: "privacy@example.com" }),
    );

    const result = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: null }),
    );

    expect(result).toEqual({ privacyNoticeUrl: null, privacyEmail: null });
    expect(suite.db.all(sql`select privacy_email is null as unset from tenants`)).toEqual([
      { unset: 1 },
    ]);
  });

  it("answers null and writes no row when there is no taxpayer row", async () => {
    const read = await withTransaction(suite.db, (tx) => readPrivacyContact(tx));
    const saved = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: "privacy@example.com" }),
    );

    expect(read).toBeNull();
    expect(saved).toBeNull();
    expect(suite.db.all(sql`select count(*) as n from tenants`)).toEqual([{ n: 0 }]);
  });

  it.each([
    ["no keys", {}],
    ["only an undefined key", { privacyEmail: undefined }],
  ])("writes nothing and answers the stored pair when given %s", async (_name, changes) => {
    await insertTaxpayer();
    await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, {
        privacyNoticeUrl: "https://example.com/privacy",
        privacyEmail: "privacy@example.com",
      }),
    );
    const before = await stored();

    const result = await withTransaction(suite.db, (tx) => savePrivacyContact(tx, changes));

    expect(result).toEqual({
      privacyNoticeUrl: "https://example.com/privacy",
      privacyEmail: "privacy@example.com",
    });
    expect(await stored()).toEqual(before);
  });
});
