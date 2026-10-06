import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { mountSetup } from "./setup-api.js";
import type { WaitronModule } from "@waitron/module";
import { loadKeyRing } from "@waitron/credentials";
import { VENUE_SERVICE_CONFIGURATION_TRANSFER } from "@waitron/venue-service";
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
  version: 2,
  createdAt: "2026-09-09T00:00:00.000Z",
  sourceOperatorId: "source-admin",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
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
      bumpMode: "line",
      fireControl: "waiter",
      catalogueId: null,
    },
    seriesCode: "F",
    fullSeriesCode: "FF",
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
  it.each([
    [
      "real pre-retirement export",
      JSON.parse(
        readFileSync(
          new URL(
            "./testing/fixtures/configuration-v1-before-printing-retirement.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as Record<string, unknown>,
    ],
    ["old version", { version: 1 }],
    ["future version", { version: 3 }],
    [
      "retired drawer value",
      {
        venue: {
          ...bundle.venue,
          location: { ...bundle.venue.location, drawerOpenPolicy: "open" },
        },
      },
    ],
    [
      "retired drawer null",
      {
        venue: { ...bundle.venue, location: { ...bundle.venue.location, drawerOpenPolicy: null } },
      },
    ],
    [
      "retired receipt value",
      {
        venue: {
          ...bundle.venue,
          location: { ...bundle.venue.location, receiptPrintMode: "never" },
        },
      },
    ],
    [
      "retired receipt null",
      {
        venue: { ...bundle.venue, location: { ...bundle.venue.location, receiptPrintMode: null } },
      },
    ],
  ])("refuses %s through setup before replacing staged files", async (_label, change) => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    for (const name of [
      "configuration-import.artifact",
      "configuration-import.key",
      "configuration-import.json",
    ]) {
      await writeFile(join(stateDir, name), `retained ${name}`);
    }
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: "preproduction",
        stageConfiguration: (artifact, passphrase) =>
          stageConfigurationImport(stateDir, ring, artifact, passphrase, validate),
      },
      () => {},
    );
    const artifact = encodeConfigurationBundle(
      { ...bundle, ...change } as unknown as ConfigurationBundle,
      "a strong passphrase",
    );
    const response = await app.request("/setup-api/configuration", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-export-passphrase": "a strong passphrase",
      },
      body: new Uint8Array(artifact).buffer,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        _label === "future version"
          ? { code: "setup.request_invalid", params: { field: "version" } }
          : { code: "setup.configuration_outdated", params: {} },
    });
    expect((await readdir(stateDir)).sort()).toEqual([
      "configuration-import.artifact",
      "configuration-import.json",
      "configuration-import.key",
    ]);
    for (const name of await readdir(stateDir))
      expect(await readFile(join(stateDir, name), "utf8")).toBe(`retained ${name}`);
  });

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

  it("writes nothing when the archive's opening hours overlap, as a save would refuse", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const withHours = [
      ...modules,
      {
        name: "venue-service",
        version: "0.0.0",
        tier: "mandatory",
        migrations: {
          name: "venue-service",
          table: "__drizzle_migrations_venue_service",
          from: "../venue-service/drizzle",
        },
        configurationTransfer: VENUE_SERVICE_CONFIGURATION_TRANSFER,
      } satisfies WaitronModule,
    ];
    const versions = { core: 1, "venue-service": 1 };
    const tables: ConfigurationBundle["tables"] = Object.fromEntries(
      VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map((table) => [table.name, []]),
    );
    const cells = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      id: `cell-${weekday}`,
      department_id: "department",
      station_id: null,
      weekday,
      mode: "periods",
    }));
    const periods = cells.map((cell) => ({
      id: randomUUID(),
      cell_id: cell.id,
      position: 0,
      opens_at: "12:00:00",
      closes_at: "16:00:00",
    }));
    const valid: ConfigurationBundle = {
      ...bundle,
      modules: versions,
      tables: {
        ...tables,
        ...bundle.tables,
        departments: [{ id: "department" }],
        hours_week_cells: cells,
        hours_week_periods: periods,
      },
    };
    const overlapping: ConfigurationBundle = {
      ...valid,
      tables: {
        ...valid.tables,
        hours_week_periods: [
          ...periods,
          { ...periods[0]!, id: randomUUID(), position: 1, opens_at: "15:00:00" },
        ],
      },
    };
    const validateWithHours = (candidate: ConfigurationBundle): Promise<void> => {
      validateConfigurationBundle(candidate, withHours, versions);
      return Promise.resolve();
    };
    const control = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(control);
    await expect(
      stageConfigurationImport(
        control,
        ring,
        encodeConfigurationBundle(valid, "a strong passphrase"),
        "a strong passphrase",
        validateWithHours,
      ),
    ).resolves.toMatchObject({ counts: { hours_week_periods: 7 } });

    await expect(
      stageConfigurationImport(
        stateDir,
        ring,
        encodeConfigurationBundle(overlapping, "a strong passphrase"),
        "a strong passphrase",
        validateWithHours,
      ),
    ).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "hours_week_cells" },
    });
    await expect(readFile(join(stateDir, "configuration-import.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  async function stagedDir(sealWith = ring): Promise<string> {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const artifact = encodeConfigurationBundle(bundle, "a strong passphrase");
    await stageConfigurationImport(stateDir, sealWith, artifact, "a strong passphrase", validate);
    return stateDir;
  }

  it("reports nothing staged when no import has been staged", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    await expect(readStagedConfigurationImport(stateDir, ring)).resolves.toBeNull();
  });

  it("refuses a staging marker written in another format version", async () => {
    const stateDir = await stagedDir();
    await writeFile(join(stateDir, "configuration-import.json"), JSON.stringify({ version: 2 }));
    await expect(readStagedConfigurationImport(stateDir, ring)).rejects.toThrow(
      "invalid staged configuration import",
    );
  });

  it("surfaces an unreadable staging marker rather than treating it as nothing staged", async () => {
    const stateDir = await stagedDir();
    await writeFile(join(stateDir, "configuration-import.json"), "not json");
    await expect(readStagedConfigurationImport(stateDir, ring)).rejects.toThrow(SyntaxError);
  });

  it("reads an import staged under the previous credentials key after a rotation", async () => {
    const stateDir = await stagedDir();
    const rotated = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 29).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: Buffer.alloc(32, 17).toString("base64"),
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    await expect(readStagedConfigurationImport(stateDir, rotated)).resolves.toEqual(
      expect.objectContaining({ bundle, passphrase: "a strong passphrase" }),
    );
  });

  it("refuses an import staged under a credentials key the ring no longer holds", async () => {
    const stateDir = await stagedDir();
    const replaced = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 29).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
    });
    await expect(readStagedConfigurationImport(stateDir, replaced)).rejects.toThrow(
      "invalid staged configuration import key",
    );
  });

  it.each([
    ["another wrapping version", { version: 2 }],
    ["no nonce", { iv: undefined }],
    ["no authentication tag", { tag: 7 }],
    ["no ciphertext", { ciphertext: undefined }],
  ])("refuses a wrapped passphrase with %s", async (_label, change) => {
    const stateDir = await stagedDir();
    const keyPath = join(stateDir, "configuration-import.key");
    const wrapped = JSON.parse(await readFile(keyPath, "utf8")) as Record<string, unknown>;
    await writeFile(keyPath, JSON.stringify({ ...wrapped, ...change }));
    await expect(readStagedConfigurationImport(stateDir, ring)).rejects.toThrow(
      "invalid staged configuration import key",
    );
  });

  it("refuses a wrapped passphrase whose authentication tag does not match", async () => {
    const stateDir = await stagedDir();
    const keyPath = join(stateDir, "configuration-import.key");
    const wrapped = JSON.parse(await readFile(keyPath, "utf8")) as { tag: string };
    const tag = Buffer.from(wrapped.tag, "base64");
    tag[0] = tag[0]! ^ 0xff;
    await writeFile(keyPath, JSON.stringify({ ...wrapped, tag: tag.toString("base64") }));
    await expect(readStagedConfigurationImport(stateDir, ring)).rejects.toThrow(
      "invalid staged configuration import key",
    );
  });
});
