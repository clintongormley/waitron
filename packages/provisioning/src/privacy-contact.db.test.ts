import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { hashPin } from "@waitron/identity";
import { seedVenueSettings, seedVenue } from "@waitron/db/testing/seed.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { readSettings, settings, taxpayer, VENUE_SETTINGS, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readPrivacyContact, savePrivacyContact, type PrivacyContact } from "./index.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});

async function stored() {
  const [row] = await suite.db.select().from(taxpayer).where(eq(taxpayer.id, 1));
  return row === undefined ? row : { ...row, ...(await withTransaction(suite.db, readPrivacyContact)) };
}

async function insertTaxpayer() {
  await seedVenueSettings(suite.db);
  await suite.db.insert(taxpayer).values({
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
      }, null),
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
      }, null),
    );
    const before = await stored();

    const result = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: "data@example.com" }, null),
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
      savePrivacyContact(tx, { privacyEmail: "privacy@example.com" }, null),
    );
    const before = await stored();

    const result = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: null }, null),
    );

    expect(result).toEqual({ privacyNoticeUrl: null, privacyEmail: null });
    expect(await stored()).toEqual({ ...before, privacyEmail: null });
    expect(suite.db.all(sql`select json_extract(doc, '$.privacyEmail') is null as unset from settings where module = 'venue'`)).toEqual([
      { unset: 1 },
    ]);
  });

  it("writes only the two privacy columns when handed an object carrying another key", async () => {
    await insertTaxpayer();
    const before = await stored();
    const changes = {
      privacyEmail: "privacy@example.com",
      legalName: "Hijacked SL",
    } as Partial<PrivacyContact>;

    const result = await withTransaction(suite.db, (tx) => savePrivacyContact(tx, changes, null));

    expect(result).toEqual({ privacyNoticeUrl: null, privacyEmail: "privacy@example.com" });
    expect(await stored()).toEqual({ ...before, privacyEmail: "privacy@example.com" });
  });

  it("answers null and writes no row when there is no taxpayer row", async () => {
    const read = await withTransaction(suite.db, (tx) => readPrivacyContact(tx));
    const saved = await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, { privacyEmail: "privacy@example.com" }, null),
    );

    expect(read).toBeNull();
    expect(saved).toBeNull();
    expect(suite.db.all(sql`select count(*) as n from taxpayer`)).toEqual([{ n: 0 }]);
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
      }, null),
    );
    const before = await stored();

    const result = await withTransaction(suite.db, (tx) => savePrivacyContact(tx, changes, null));

    expect(result).toEqual({
      privacyNoticeUrl: "https://example.com/privacy",
      privacyEmail: "privacy@example.com",
    });
    expect(await stored()).toEqual(before);
  });
});

it("saves privacy in the venue document and leaves the taxpayer row untouched", async () => {
  await seedVenue(suite.db);
  const before = await suite.db.select().from(taxpayer);
  expect(
    await withTransaction(suite.db, (tx) =>
      savePrivacyContact(
        tx,
        {
          privacyEmail: "privacy@example.test",
        },
        null,
      ),
    ),
  ).toEqual({ privacyNoticeUrl: null, privacyEmail: "privacy@example.test" });
  expect(await suite.db.select().from(taxpayer)).toEqual(before);
  expect(before[0]).not.toHaveProperty("privacyEmail");
  expect(before[0]).not.toHaveProperty("privacyNoticeUrl");
  expect((await readSettings(suite.db, VENUE_SETTINGS)).doc).toMatchObject({
    privacyNoticeUrl: null,
    privacyEmail: "privacy@example.test",
  });
});

it("records the saving person on the venue document", async () => {
  await seedVenue(suite.db);
  const [person] = await withTransaction(suite.db, (tx) =>
    seedPersons(tx, {
      displayName: "Privacy manager",
      pinHash: hashPin("1234"),
      role: "manager",
    }),
  );
  await withTransaction(suite.db, (tx) =>
    savePrivacyContact(
      tx,
      {
        privacyEmail: "privacy@example.test",
      },
      person!.id,
    ),
  );
  const [document] = await suite.db.select().from(settings).where(eq(settings.module, "venue"));
  expect(document!.updatedBy).toBe(person!.id);
});
