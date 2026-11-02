import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { loadKeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { sql } from "drizzle-orm";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request } from "../test/first-setup-request.js";
import {
  encodeConfigurationBundle,
  importConfigurationTables,
  validateConfigurationBundle,
} from "./configuration-transfer.js";
import { readStagedConfigurationImport, stageConfigurationImport } from "./configuration-import.js";
import { applyVenue } from "./venue-apply.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { planVenue } from "./venue-plan.js";

const catalogue = ALL_MODULES.find((module) => module.name === "catalogue")!;
const transfer = catalogue.configurationTransfer!;
if (transfer.kind !== "tables") throw new Error("catalogue must transfer its configuration");
const tables = transfer.tables;

function bundleFor(country: string, province: string | null, languages: unknown) {
  const bundle = configurationBundle();
  bundle.venue.country = country;
  bundle.venue.location.province = province;
  bundle.venue.location.timeZone = country === "ES" ? "Europe/Madrid" : "Europe/London";
  bundle.modules = { catalogue: 1 };
  bundle.tables = Object.fromEntries(tables.map(({ name }) => [name, []]));
  bundle.tables.content_languages = [{ id: 1, default_language: "en", languages }];
  return bundle;
}

it.each([
  { province: "Barcelona", languages: ["en", "es"], missing: "ca" },
  { province: "Barcelona", languages: ["en", "ca"], missing: "es" },
  { province: "Balears, Illes", languages: ["en", "es"], missing: "ca" },
  { province: "Valencia", languages: ["en", "es", "ca"], missing: "ca-ES-valencia" },
  { province: "A Coruña", languages: ["en", "es"], missing: "gl" },
  { province: "Madrid", languages: ["en"], missing: "es" },
  { province: null, languages: ["en"], missing: "es" },
])("refuses a $province copy without required $missing", ({ province, languages, missing }) => {
  const bundle = bundleFor("ES", province, JSON.stringify(languages));
  expect(() => validateConfigurationBundle(bundle, [catalogue], bundle.modules)).toThrowError(
    expect.objectContaining({ code: "content.language_required", params: { language: missing } }),
  );
});

describe("required languages before configuration replacement", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("keeps the earlier staged artifact when a replacement omits Catalan", async () => {
    const root = await mkdtemp(join(tmpdir(), "a989-stage-"));
    roots.push(root);
    const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 91).toString("base64") });
    const passphrase = "SYNTHETIC language copy passphrase";
    const valid = bundleFor("ES", "Barcelona", '["en","ca","es"]');
    const validate = async (bundle: typeof valid) => {
      validateConfigurationBundle(bundle, [catalogue], bundle.modules);
    };
    const artifact = encodeConfigurationBundle(valid, passphrase);
    await stageConfigurationImport(root, ring, artifact, passphrase, validate);
    const files = [
      "configuration-import.artifact",
      "configuration-import.key",
      "configuration-import.json",
    ];
    const before = await Promise.all(files.map((name) => readFile(join(root, name))));
    const replacement = bundleFor("ES", "Barcelona", '["en","es"]');
    await expect(
      stageConfigurationImport(
        root,
        ring,
        encodeConfigurationBundle(replacement, passphrase),
        passphrase,
        validate,
      ),
    ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
    expect(await Promise.all(files.map((name) => readFile(join(root, name))))).toEqual(before);
    expect(await readStagedConfigurationImport(root, ring)).toEqual({
      bundle: valid,
      artifact,
      passphrase,
    });
  });

  it("refuses direct import before replacing catalogue rows, then imports a valid setting", async () => {
    const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
    const target = await applyVenue(
      planVenue(
        {
          ...request,
          country: "GB",
          taxId: "123456789",
          location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
          admin: {
            displayName: "Copy owner",
            email: "copy-owner@example.test",
            pinHash: "synthetic-pin-hash",
            passwordHash: "synthetic-password-hash",
          },
        },
        modules,
      ),
      { db: suite.db, modules },
    );
    const read = () => suite.db.execute(sql`select * from content_languages`);
    const before = (await read()).rows;
    expect(before).toHaveLength(1);
    const invalid = bundleFor("ES", "Barcelona", '["en","es"]');
    await expect(
      withTransaction(suite.db, (tx) =>
        importConfigurationTables(tx, invalid, target, [catalogue], invalid.modules),
      ),
    ).rejects.toMatchObject({ code: "content.language_required", params: { language: "ca" } });
    expect((await read()).rows).toEqual(before);
    const valid = bundleFor("ES", "Barcelona", '["en","es","ca"]');
    await withTransaction(suite.db, (tx) =>
      importConfigurationTables(tx, valid, target, [catalogue], valid.modules),
    );
    expect((await read()).rows).toEqual([
      { id: 1, default_language: "en", languages: '["en","es","ca"]' },
    ]);
  });
});

it.each([
  { country: "ES", province: "Barcelona", languages: ["en", "es", "ca"] },
  { country: "ES", province: "Valencia", languages: ["en", "es", "ca-ES-valencia"] },
  { country: "ES", province: "A Coruña", languages: ["en", "es", "gl"] },
  { country: "ES", province: "Madrid", languages: ["en", "es"] },
  { country: "GB", province: "Barcelona", languages: ["en"] },
])("accepts $country/$province with required languages and an English default", (input) => {
  const bundle = bundleFor(input.country, input.province, JSON.stringify(input.languages));
  const before = structuredClone(bundle);
  validateConfigurationBundle(bundle, [catalogue], bundle.modules);
  expect(bundle).toEqual(before);
});

it("refuses an empty saved-language table that would erase required languages", () => {
  const bundle = bundleFor("ES", "Barcelona", "[]");
  bundle.tables.content_languages = [];
  expect(() => validateConfigurationBundle(bundle, [catalogue], bundle.modules)).toThrowError(
    expect.objectContaining({ code: "content.language_required" }),
  );
});

it.each([
  { default_language: "en", languages: "{" },
  { default_language: "en", languages: "null" },
  { default_language: "en", languages: "{}" },
  { default_language: "en", languages: '["en",2]' },
  { default_language: "en", languages: '["en","en"]' },
  { default_language: "es", languages: '["en"]' },
  { default_language: null, languages: '["en"]' },
  { default_language: "en", languages: ["en"] },
  { default_language: "en", languages: '["en","not_a_language"]' },
  { default_language: "EN", languages: '["EN"]' },
])("refuses malformed saved language configuration %j", (row) => {
  const bundle = bundleFor("GB", null, row.languages);
  bundle.tables.content_languages = [{ id: 1, ...row }];
  expect(() => validateConfigurationBundle(bundle, [catalogue], bundle.modules)).toThrowError(
    expect.objectContaining({ code: "content.languages_invalid", params: {} }),
  );
});
