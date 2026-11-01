import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { tenants, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { appliedSchemaVersion, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, type WaitronModule } from "@waitron/module";
import { sql } from "drizzle-orm";
import { applyHistoricalTestVenue } from "../test/allocated-venue.js";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request, PASSWORD } from "../test/first-setup-request.js";
import {
  buildConfigurationBundle,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { readPrivacyContact, savePrivacyContact, type PrivacyContact } from "./privacy-contact.js";
import { applyVenue } from "./venue-apply.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const passphrase = "SYNTHETIC transfer passphrase";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function exported(prepare?: () => Promise<void>): Promise<ConfigurationBundle> {
  const modules = enabledModules(
    ALL_MODULES,
    venueFiscalSelection(ALL_MODULES, "ES-common").config,
  );
  const versions: Record<string, number> = {};
  for (const module of modules)
    versions[module.name] = await appliedSchemaVersion(
      { venue: suite.db, node: suite.node },
      module.migrations,
    );
  const seeded = await applyHistoricalTestVenue(
    planVenue(
      {
        ...request,
        admin: {
          displayName: request.admin.displayName,
          email: request.admin.email,
          pinHash: hashPin(request.admin.pin),
          passwordHash: hashPassword(PASSWORD),
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
  await prepare?.();
  return buildConfigurationBundle(suite.db, seeded, modules, new Date(), versions);
}

function withContact(privacyContact: ConfigurationBundle["privacyContact"]): ConfigurationBundle {
  return { ...configurationBundle(), privacyContact };
}

it("exports the stored privacy contact at the top level, never inside the venue", async () => {
  const bundle = await exported(async () => {
    await withTransaction(suite.db, (tx) =>
      savePrivacyContact(tx, {
        privacyNoticeUrl: "https://example.com/privacy",
        privacyEmail: "privacy@example.com",
      }),
    );
  });
  expect(bundle.version).toBe(9);
  expect(bundle.privacyContact).toEqual({
    privacyNoticeUrl: "https://example.com/privacy",
    privacyEmail: "privacy@example.com",
  });
  for (const holder of [bundle.venue, bundle.venue.location]) {
    expect(holder).not.toHaveProperty("privacyNoticeUrl");
    expect(holder).not.toHaveProperty("privacyEmail");
  }
});

it("exports an unset privacy contact as two nulls", async () => {
  expect((await exported()).privacyContact).toEqual({ privacyNoticeUrl: null, privacyEmail: null });
});

it("keeps the privacy contact through encoding and decoding", () => {
  const bundle = configurationBundle();
  expect(
    decodeConfigurationBundle(encodeConfigurationBundle(bundle, passphrase), passphrase),
  ).toEqual(bundle);
});

it.each([
  { privacyNoticeUrl: "", privacyEmail: null },
  { privacyNoticeUrl: "   ", privacyEmail: "privacy@example.com" },
])("accepts a privacy contact the Privacy card accepts: %j", (privacyContact) => {
  expect(() => validateConfigurationBundle(withContact(privacyContact), [], {})).not.toThrow();
});

it.each([
  {
    privacyContact: { privacyNoticeUrl: "example.com/privacy", privacyEmail: null },
    params: { field: "privacyNoticeUrl", reason: "web_address" },
  },
  {
    privacyContact: { privacyNoticeUrl: null, privacyEmail: "privacy@example" },
    params: { field: "privacyEmail", reason: "email" },
  },
  {
    privacyContact: { privacyNoticeUrl: "example.com/privacy", privacyEmail: "privacy@example" },
    params: { field: "privacyNoticeUrl", reason: "web_address" },
  },
])("refuses a privacy contact the Privacy card refuses: $params", ({ privacyContact, params }) => {
  let thrown: unknown;
  try {
    validateConfigurationBundle(withContact(privacyContact), [], {});
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code: "venue.detail_invalid" });
  expect((thrown as { params: unknown }).params).toEqual(params);
});

const stored = {
  privacyNoticeUrl: "https://example.com/privacy",
  privacyEmail: "privacy@example.com",
};

async function targetVenue(taxId = "123456789") {
  const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
  return applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId,
        location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
        admin: {
          displayName: "Owner",
          email: "owner@example.test",
          pinHash: "synthetic-pin",
          passwordHash: "synthetic-password",
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
}

async function taxpayerRows(db: Database) {
  return db.select().from(tenants);
}

it.each(["123456789", "987654321"])(
  "an import writes the bundle's privacy contact onto the taxpayer row (target tax ID %s)",
  async (taxId) => {
    const target = await targetVenue(taxId);
    const [before] = await taxpayerRows(suite.db);
    await withTransaction(suite.db, (tx) =>
      importConfigurationTables(tx, configurationBundle(), target, [], {}),
    );
    expect(await taxpayerRows(suite.db)).toEqual([{ ...before, ...stored }]);
  },
);

it("an import stores the privacy contact trimmed and composed", async () => {
  const target = await targetVenue();
  const [before] = await taxpayerRows(suite.db);
  const bundle = withContact({
    privacyNoticeUrl: "  https://example.com/privacy  ",
    privacyEmail: `jose${String.fromCodePoint(0x301)}@example.com`,
  });
  await withTransaction(suite.db, (tx) => importConfigurationTables(tx, bundle, target, [], {}));
  expect(await taxpayerRows(suite.db)).toEqual([
    {
      ...before,
      privacyNoticeUrl: "https://example.com/privacy",
      privacyEmail: `jos${String.fromCodePoint(0xe9)}@example.com`,
    },
  ]);
});

it("an import with an unset privacy contact clears a stored privacy contact", async () => {
  const target = await targetVenue();
  await withTransaction(suite.db, (tx) => savePrivacyContact(tx, stored));
  const [before] = await taxpayerRows(suite.db);
  expect(before).toMatchObject(stored);
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(
      tx,
      withContact({ privacyNoticeUrl: null, privacyEmail: null }),
      target,
      [],
      {},
    ),
  );
  expect(await taxpayerRows(suite.db)).toEqual([
    { ...before, privacyNoticeUrl: null, privacyEmail: null },
  ]);
});

it("an import writes the privacy contact before the modules' afterImport hooks, and a failing hook rolls it back", async () => {
  const target = await targetVenue();
  const [before] = await taxpayerRows(suite.db);
  let seen: PrivacyContact | null | undefined;
  const module: WaitronModule = {
    ...ALL_MODULES.find((candidate) => candidate.name === "fiscal-none")!,
    name: "synthetic-transfer",
    configurationTransfer: {
      kind: "tables",
      tables: [],
      afterImport: async (tx) => {
        seen = await readPrivacyContact(tx);
        throw new Error("synthetic afterImport failure");
      },
    },
  };
  const bundle = { ...configurationBundle(), modules: { "synthetic-transfer": 1 } };
  await expect(
    withTransaction(suite.db, (tx) =>
      importConfigurationTables(tx, bundle, target, [module], { "synthetic-transfer": 1 }),
    ),
  ).rejects.toThrow("synthetic afterImport failure");
  expect(seen).toEqual(stored);
  expect(await taxpayerRows(suite.db)).toEqual([before]);
});

it("an import with no taxpayer row finishes and creates none", async () => {
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, configurationBundle(), { locationId: "absent" }, [], {}),
  );
  expect((await suite.db.execute(sql`select count(*) as n from tenants`)).rows).toEqual([{ n: 0 }]);
});
