import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { loadKeyRing } from "@waitron/credentials";
import {
  encodeConfigurationBundle,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import {
  clearStagedConfigurationImport,
  readStagedConfigurationImport,
  stageConfigurationImport,
} from "./configuration-import.js";

const dirs: string[] = [];
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 17).toString("base64"),
});
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const bundle: ConfigurationBundle = {
  version: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  sourceTenantId: "tenant",
  sourceOperatorId: "source-admin",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    location: {
      id: "location",
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
      orderFlow: "prepay",
      bumpMode: "line",
      fireControl: "waiter",
      receiptPrintMode: "auto",
      drawerOpenPolicy: "gated",
      catalogueId: null,
    },
    tillName: "Till",
    seriesCode: "F",
    rectificativeSeriesCode: "R",
  },
  modules: { core: 1 },
  tables: { products: [{ id: "p1" }] },
  reconnect: ["printers"],
};
const modules = [
  {
    name: "core",
    version: "0.0.0",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
    configurationTransfer: { kind: "tables", tables: [{ name: "products" }] },
  } satisfies WaitronModule,
];
const validate = (candidate: ConfigurationBundle): Promise<void> => {
  validateConfigurationBundle(candidate, modules, { core: 1 });
  return Promise.resolve();
};

describe("staged configuration import", () => {
  it("validates before staging and retains owner-only payloads until explicit cleanup", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const artifact = encodeConfigurationBundle(bundle, "a strong passphrase");
    await expect(
      stageConfigurationImport(stateDir, ring, artifact, "a strong passphrase", validate),
    ).resolves.toEqual({
      venue: bundle.venue,
      counts: { products: 1 },
      reconnect: ["printers"],
    });
    await expect(readStagedConfigurationImport(stateDir, ring)).resolves.toEqual(
      expect.objectContaining({ bundle, passphrase: "a strong passphrase" }),
    );
    await expect(
      readFile(join(stateDir, "configuration-import.key"), "utf8"),
    ).resolves.not.toContain("a strong passphrase");
    for (const name of [
      "configuration-import.artifact",
      "configuration-import.key",
      "configuration-import.json",
    ]) {
      expect((await stat(join(stateDir, name))).mode & 0o777).toBe(0o600);
    }
    await clearStagedConfigurationImport(stateDir);
    await expect(readFile(join(stateDir, "configuration-import.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes nothing when the passphrase is wrong", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const artifact = encodeConfigurationBundle(bundle, "a strong passphrase");
    await expect(
      stageConfigurationImport(stateDir, ring, artifact, "wrong passphrase", validate),
    ).rejects.toMatchObject({ code: "recovery.passphrase_invalid" });
    await expect(readFile(join(stateDir, "configuration-import.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes nothing when the archive contains a table outside the module allowlist", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const artifact = encodeConfigurationBundle(
      { ...bundle, tables: { ...bundle.tables, sales: [] } },
      "a strong passphrase",
    );
    await expect(
      stageConfigurationImport(stateDir, ring, artifact, "a strong passphrase", validate),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "tables" } });
    await expect(readFile(join(stateDir, "configuration-import.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
