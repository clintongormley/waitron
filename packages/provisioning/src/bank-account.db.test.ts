import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { hashPin } from "@waitron/identity";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { beforeEach, describe, expect, it } from "vitest";
import { readActivityForSubject, readSettings, VENUE_SETTINGS, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readBankAccount, saveBankAccount } from "./index.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const IBAN = "ES9121000418450200051332";
const OTHER_IBAN = "GB82WEST12345698765432";
let personId: string;

beforeEach(async () => {
  await seedVenue(suite.db);
  const [person] = await withTransaction(suite.db, (tx) =>
    seedPersons(tx, { displayName: "Bank manager", pinHash: hashPin("1234"), role: "manager" }),
  );
  personId = person!.id;
});

const none = { iban: "", bankName: "" };
const save = (change: {
  expected?: { iban: string; bankName: string };
  iban: string;
  bankName: string;
}) =>
  withTransaction(suite.db, (tx) => saveBankAccount(tx, { expected: none, personId, ...change }));
const read = () => withTransaction(suite.db, readBankAccount);
const venueRevision = async () => (await readSettings(suite.db, VENUE_SETTINGS)).revision;
const bankEntries = async () =>
  (await readActivityForSubject(suite.db, { kind: "settings", id: "venue" })).filter(
    (entry) => entry.kind === "venue.bank_account_changed",
  );
async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  return { code: (error as { code?: string }).code, params: (error as { params?: object }).params };
}

describe("saveBankAccount and readBankAccount", () => {
  it("reads no account on a fresh venue", async () => {
    expect(await read()).toBeNull();
  });

  it("stores a spaced lower-case IBAN without spaces, upper case, and answers before and after", async () => {
    const result = await save({ iban: " es91 2100 0418 4502 0005 1332 ", bankName: " Openbank " });
    expect(result).toEqual({
      saved: true,
      activityId: expect.any(String),
      before: null,
      after: { iban: IBAN, bankName: "Openbank" },
    });
    expect(await read()).toEqual({ iban: IBAN, bankName: "Openbank" });
  });

  it("refuses a bad checksum and saves nothing", async () => {
    const revision = await venueRevision();
    expect(await refusal(save({ iban: "ES9121000418450200051333", bankName: "" }))).toEqual({
      code: "venue.detail_invalid",
      params: { field: "iban", reason: "checksum" },
    });
    expect(await read()).toBeNull();
    expect(await venueRevision()).toBe(revision);
  });

  it("refuses a value that is not shaped like an IBAN", async () => {
    expect(await refusal(save({ iban: "12345", bankName: "" }))).toEqual({
      code: "venue.detail_invalid",
      params: { field: "iban", reason: "format" },
    });
  });

  it("answers saved: false and writes nothing when only the expected bank name differs", async () => {
    await save({ iban: IBAN, bankName: "Openbank" });
    const revision = await venueRevision();
    const result = await save({
      expected: { iban: IBAN, bankName: "Other bank" },
      iban: OTHER_IBAN,
      bankName: "Openbank",
    });
    expect(result).toEqual({
      saved: false,
      before: { iban: IBAN, bankName: "Openbank" },
      after: { iban: IBAN, bankName: "Openbank" },
    });
    expect(await read()).toEqual({ iban: IBAN, bankName: "Openbank" });
    expect(await venueRevision()).toBe(revision);
    expect(await bankEntries()).toHaveLength(1);
  });

  it("answers saved: false when the expected IBAN differs", async () => {
    await save({ iban: IBAN, bankName: "" });
    const result = await save({ iban: OTHER_IBAN, bankName: "" });
    expect(result.saved).toBe(false);
    expect(await read()).toEqual({ iban: IBAN, bankName: null });
  });

  it("clears the account with an empty IBAN", async () => {
    await save({ iban: IBAN, bankName: "Openbank" });
    const result = await save({
      expected: { iban: IBAN, bankName: "Openbank" },
      iban: "",
      bankName: "",
    });
    expect(result).toMatchObject({
      saved: true,
      before: { iban: IBAN, bankName: "Openbank" },
      after: null,
    });
    expect(await read()).toBeNull();
  });

  it("stores a blank bank name as null", async () => {
    await save({ iban: IBAN, bankName: "   " });
    expect(await read()).toEqual({ iban: IBAN, bankName: null });
  });

  it("refuses a bank name without an IBAN", async () => {
    expect(await refusal(save({ iban: "  ", bankName: "Openbank" }))).toEqual({
      code: "venue.detail_invalid",
      params: { field: "iban", reason: "required" },
    });
    expect(await read()).toBeNull();
  });

  it("records one bank-account entry holding no account number, by the saving person", async () => {
    const result = await save({ iban: IBAN, bankName: "Openbank" });
    const entries = await bankEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: result.activityId, personId, data: {} });
    expect(entries[0]!.data).toEqual({});
  });

  it("refuses an identical save as unchanged, including one spelled with spaces", async () => {
    await save({ iban: IBAN, bankName: "Openbank" });
    const revision = await venueRevision();
    expect(
      await refusal(
        save({
          expected: { iban: IBAN, bankName: "Openbank" },
          iban: "ES91 2100 0418 4502 0005 1332",
          bankName: " Openbank ",
        }),
      ),
    ).toEqual({ code: "venue.detail_invalid", params: { field: "iban", reason: "unchanged" } });
    expect(await venueRevision()).toBe(revision);
  });

  it("refuses clearing an account that is not set as unchanged", async () => {
    expect(await refusal(save({ iban: "", bankName: "" }))).toEqual({
      code: "venue.detail_invalid",
      params: { field: "iban", reason: "unchanged" },
    });
  });

  it("stores a bank name of 70 characters and refuses a longer one beside the bank name, saving nothing", async () => {
    const at = "\u00e9".repeat(69);
    await save({ iban: IBAN, bankName: `${at}a` });
    expect(await read()).toEqual({ iban: IBAN, bankName: `${at}a` });
    const revision = await venueRevision();
    expect(
      await refusal(
        save({ expected: { iban: IBAN, bankName: `${at}a` }, iban: IBAN, bankName: `${at}ab` }),
      ),
    ).toEqual({
      code: "venue.detail_invalid",
      params: { field: "bankName", reason: "length" },
    });
    expect(await venueRevision()).toBe(revision);
  });

  it("counts a decomposed bank name by its composed spelling", async () => {
    await save({ iban: IBAN, bankName: "e\u0301".repeat(70) });
    expect(await read()).toEqual({ iban: IBAN, bankName: "\u00e9".repeat(70) });
  });

  it("stores the bank name in its composed spelling", async () => {
    await save({ iban: IBAN, bankName: "Cafe\u0301 Bank" });
    expect(await read()).toEqual({ iban: IBAN, bankName: "Caf\u00e9 Bank" });
  });
});
