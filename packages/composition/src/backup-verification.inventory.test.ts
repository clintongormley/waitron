import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { openBackupQuery } from "@waitron/store";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { BackupVerificationUnsupported, orderedMigrationSets } from "@waitron/module";
import { migrationOptionsFor } from "@waitron/migrations";
import { ALL_MODULES } from "./modules.js";
import { backupVerificationInventory } from "./backup-verification.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null),
});

it("covers the actual composition and every migrated data table, including disabled owners", () => {
  const inventory = backupVerificationInventory(ALL_MODULES);
  expect(inventory.map((entry) => entry.module.name)).toEqual(
    ALL_MODULES.map((module) => module.name),
  );
  const declared: string[] = [];
  for (const { module, verification } of inventory) {
    expect(verification.verifyRestoredData).toBe(module.backup!.verification!.verifyRestoredData);
    expect([...verification.data.tables].sort()).toEqual(
      (module.classification ?? []).map((row) => row.table).sort(),
    );
    for (const entry of module.classification ?? []) {
      if (entry.appendOnly === true)
        expect(verification.data.immutableTables).toContain(entry.table);
    }
    declared.push(...verification.data.tables);
  }
  expect(new Set(declared).size).toBe(declared.length);
  const journals = new Set(ALL_MODULES.map((module) => module.migrations.table));
  const actual = suite.db
    .all<{ name: string }>(sql`select name from sqlite_schema where type='table'`)
    .map((row) => row.name)
    .filter((name) => !journals.has(name) && name !== "sqlite_sequence");
  expect([...declared].sort()).toEqual(actual.sort());
  expect(inventory.find(({ module }) => module.name === "media")!.verification.data.tables).toEqual(
    ["media_images", "media_image_data", "media_image_blobs", "media_image_edits"],
  );
});

it.each(ALL_MODULES.map((module) => module.name))(
  "refuses removal of the actual %s verification owner without any fallback",
  (name) => {
    expect(() => backupVerificationInventory(ALL_MODULES)).not.toThrow();
    const missing = ALL_MODULES.map((module) =>
      module.name === name
        ? {
            ...module,
            backup: { ...module.backup, verification: undefined },
          }
        : module,
    );
    expect(() => backupVerificationInventory(missing)).toThrow(BackupVerificationUnsupported);
    expect(() => backupVerificationInventory(missing)).toThrow(
      expect.objectContaining({ reason: "semantics_missing" }),
    );
  },
);

it("accounts for every non-database source without inventing a media directory", () => {
  const inventory = backupVerificationInventory(ALL_MODULES);
  const sources = inventory.flatMap(({ module }) =>
    (module.backup?.nonDbState ?? []).map((source) => {
      expect(source.kind).toBe("preparation-history");
      return `secrets/module-evidence/${module.name}/${source.source}.json`;
    }),
  );
  const entries = inventory
    .flatMap(({ verification }) => verification.entries)
    .filter((entry) => entry.name.startsWith("secrets/module-evidence/"));
  expect(entries.map((entry) => entry.name).sort()).toEqual(sources.sort());
  expect(new Set(sources).size).toBe(sources.length);
  expect(sources).toEqual(["secrets/module-evidence/fiscal-verifactu/hour-history.json"]);
  const media = inventory.find(({ module }) => module.name === "media")!;
  expect(media.verification.entries).toEqual([]);
  expect(media.verification.secrets).toEqual([]);
  expect(media.verification.effects).toEqual([]);
});

it("names an independent check for each declared data effect and leaves activation unattempted", () => {
  const inventory = backupVerificationInventory(ALL_MODULES);
  const effects = inventory.flatMap(({ module, verification }) =>
    verification.effects.map((effect) => {
      if (effect.kind === "data") {
        expect(effect.check).not.toBeNull();
        expect(verification.data.checks).toContain(effect.check);
      } else expect(effect.check).toBeNull();
      return [module.name, effect.id, effect.kind, effect.check];
    }),
  );
  expect(effects).toEqual([
    ["core", "host_series_replacement", "activation", null],
    ["core", "host_first_start", "activation", null],
    ["fiscal-verifactu", "captured_full_chain", "data", "chain"],
    ["fiscal-verifactu", "captured_fiscal_state", "data", "history"],
    ["fiscal-verifactu", "captured_certificate", "data", "secret"],
    ["fiscal-verifactu", "captured_hour_history", "data", "entries"],
    ["fiscal-verifactu", "fresh_installation_identity", "activation", null],
    ["fiscal-verifactu", "fresh_invoice_series", "activation", null],
    ["fiscal-verifactu", "fresh_registration", "activation", null],
    ["fiscal-verifactu", "standby_promotion", "activation", null],
  ]);
});

it("uses the real provider registry for payment credential usability", () => {
  const owner = backupVerificationInventory(ALL_MODULES).find(
    ({ module }) => module.name === "payments",
  )!.verification;
  expect([...owner.secrets].sort()).toEqual(["vault:payments.stripe", "vault:payments.sumup"]);
  expect(owner.data.checks).toContain("secret");
});

it.each([
  ["https://example.test/success", "sk_test_synthetic", "passed"],
  ["not a URL", "sk_test_synthetic", "invalid"],
  ["https://example.test/success", "sk_live_synthetic", "invalid"],
] as const)(
  "runs the real payment adapter on captured %s / %s with result %s",
  async (successUrl, secretKey, status) => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const inputs = { WAITRON_CREDENTIALS_KEY: key, WAITRON_CREDENTIALS_KEY_VERSION: "1" };
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, loadKeyRing(inputs), {
        purpose: "payments.stripe",
        value: {
          secretKey,
          successUrl,
          cancelUrl: "https://example.test/cancel",
          webhookSecret: "synthetic",
        },
      }),
    );
    const path = suite.db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
    const opened = await openBackupQuery(path);
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Network during backup check");
    });
    try {
      const owner = backupVerificationInventory(ALL_MODULES).find(
        ({ module }) => module.name === "payments",
      )!.verification;
      const result = await owner.verifyRestoredData({
        before: opened.query,
        after: opened.query,
        entries: {
          async read(name) {
            return name === "secrets/secrets.env"
              ? Buffer.from(`WAITRON_CREDENTIALS_KEY=${key}\nWAITRON_CREDENTIALS_KEY_VERSION=1`)
              : name === "secrets/trading.env"
                ? Buffer.from("")
                : null;
          },
        },
        source: {
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema: 1,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
      expect(result).toEqual({
        status,
        checks: [
          { code: "data", status: "passed" },
          { code: "immutable", status: "passed" },
          { code: "secret", status },
        ],
      });
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      await opened.close();
    }
  },
);
