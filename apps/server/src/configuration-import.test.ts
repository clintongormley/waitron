import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { mountSetup } from "./setup-api.js";
import type { WaitronModule } from "@waitron/module";
import { sql } from "drizzle-orm";
import { createCatalogue, createCategory, createProduct } from "@waitron/catalogue";
import { loadKeyRing } from "@waitron/credentials";
import { kitchenStations, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { expectedSchemaVersion, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { locationId } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  setRoutingCell,
  VENUE_SERVICE_CONFIGURATION_TRANSFER,
} from "@waitron/venue-service";
import { schemaVersionsByModule } from "./backup-manifest.js";
import {
  buildConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  validateConfigurationBundle,
  type ConfigurationBundle,
} from "./configuration-transfer.js";
import { ALL_MODULES } from "./modules.js";
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

  it.each(["department_sale_policies", "zone_sale_policies"])(
    "refuses Never in current-version %s before replacing staged files",
    async (table) => {
      const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
      dirs.push(stateDir);
      const names = [
        "configuration-import.artifact",
        "configuration-import.key",
        "configuration-import.json",
      ];
      for (const name of names) await writeFile(join(stateDir, name), `retained ${name}`);
      const serviceModule = {
        ...modules[0],
        name: "venue-service",
        configurationTransfer: VENUE_SERVICE_CONFIGURATION_TRANSFER,
      } satisfies WaitronModule;
      const candidate: ConfigurationBundle = {
        ...bundle,
        modules: { "venue-service": 1 },
        tables: Object.fromEntries(
          VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map(({ name }) => [
            name,
            name === table ? [{ receipt_print_mode: "never" }] : [],
          ]),
        ),
      };
      const app = new Hono();
      mountSetup(
        app,
        {
          environment: "preproduction",
          stageConfiguration: (artifact, passphrase) =>
            stageConfigurationImport(stateDir, ring, artifact, passphrase, async (decoded) => {
              validateConfigurationBundle(decoded, [serviceModule], { "venue-service": 1 });
            }),
        },
        () => {},
      );
      const artifact = encodeConfigurationBundle(candidate, "a strong passphrase");
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
        error: { code: "setup.request_invalid", params: { field: `${table}.receipt_print_mode` } },
      });
      expect((await readdir(stateDir)).sort()).toEqual([...names].sort());
      for (const name of names)
        expect(await readFile(join(stateDir, name), "utf8")).toBe(`retained ${name}`);
    },
  );

  it.each([
    ["department_sale_policies", "tab"],
    ["department_sale_policies", null],
    ["zone_sale_policies", ["counter"]],
    ["zone_sale_policies", 1],
  ])("refuses malformed %s order start %j before replacing staged files", async (table, value) => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const names = [
      "configuration-import.artifact",
      "configuration-import.key",
      "configuration-import.json",
    ];
    for (const name of names) await writeFile(join(stateDir, name), `retained ${name}`);
    const serviceModule = {
      ...modules[0],
      name: "venue-service",
      configurationTransfer: VENUE_SERVICE_CONFIGURATION_TRANSFER,
    } satisfies WaitronModule;
    const candidate: ConfigurationBundle = {
      ...bundle,
      modules: { "venue-service": 1 },
      tables: Object.fromEntries(
        VENUE_SERVICE_CONFIGURATION_TRANSFER.tables.map(({ name }) => [
          name,
          name === table ? [{ order_start: value }] : [],
        ]),
      ),
    };
    const app = new Hono();
    mountSetup(
      app,
      {
        environment: "preproduction",
        stageConfiguration: (artifact, passphrase) =>
          stageConfigurationImport(stateDir, ring, artifact, passphrase, async (decoded) => {
            validateConfigurationBundle(decoded, [serviceModule], { "venue-service": 1 });
          }),
      },
      () => {},
    );
    const response = await app.request("/setup-api/configuration", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-export-passphrase": "a strong passphrase",
      },
      body: new Uint8Array(encodeConfigurationBundle(candidate, "a strong passphrase")).buffer,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.request_invalid", params: { field: `${table}.order_start` } },
    });
    expect((await readdir(stateDir)).sort()).toEqual([...names].sort());
    for (const name of names)
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
      {
        ...modules[0]!,
        configurationTransfer: {
          kind: "tables",
          tables: [{ name: "products" }, { name: "kitchen_stations" }],
        },
      } satisfies WaitronModule,
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
      department_id: null,
      station_id: "station",
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
        kitchen_stations: [{ id: "station", is_default: false }],
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

describe("routing cells in a staged import", () => {
  const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  function venue(taxId: string): VenueRequest {
    return {
      country: "ES",
      taxId,
      legalName: "Prepared SL",
      taxpayerDomicile: "Calle Fiscal 8, 28001 Madrid",
      location: {
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
        dayCutover: "06:00",
      },
      seriesCode: "F",
      fullSeriesCode: "FF",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Admin",
        email: `${taxId.toLowerCase()}@example.test`,
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("a secure password"),
      },
    };
  }

  let prepared:
    | Promise<{ bundle: ConfigurationBundle; versions: Record<string, number>; variant: string }>
    | undefined;
  /** A fresh export holding a category's Every zone cell and a product's zone cell. */
  function exported() {
    prepared ??= (async () => {
      const venueResult = await applyVenue(planVenue(venue("B24681361"), ALL_MODULES), {
        db: source.db,
        modules: ALL_MODULES,
      });
      const cfg = { locationId: locationId(venueResult.locationId) };
      const variant = await withTransaction(source.db, async (tx) => {
        const department = await createDepartment(tx, cfg, {
          name: "Comedor",
          orderStart: "table",
        });
        const zone = await createServiceZone(tx, cfg, {
          name: "Terraza",
          departmentId: department.id,
        });
        const [station] = await tx
          .insert(kitchenStations)
          .values({ locationId: cfg.locationId, name: "Barra" })
          .returning();
        const category = await createCategory(tx, { name: "Bebidas" });
        const menu = await createCatalogue(tx, { name: "Carta" });
        const product = await createProduct(tx, {
          catalogueId: menu.id,
          categoryId: category.id,
          name: "Mojito",
          pricingUnit: "each",
          unitPrice: "7",
          vatClass: "general",
        });
        const [large] = await tx
          .insert(products)
          .values({ catalogueId: menu.id, parentId: product.id, name: "Grande", categoryId: null })
          .returning();
        await setRoutingCell(
          tx,
          cfg,
          { row: { kind: "category", categoryId: category.id }, zoneId: null },
          { kind: "no_preparation" },
        );
        await setRoutingCell(
          tx,
          cfg,
          { row: { kind: "product", productId: product.id }, zoneId: zone.id },
          { kind: "station", stationId: station!.id },
        );
        return large!.id;
      });
      const versions = await schemaVersionsByModule(source.db, ALL_MODULES);
      const bundle = await buildConfigurationBundle(
        source.db,
        venueResult,
        ALL_MODULES,
        new Date("2026-10-07T10:00:00Z"),
        versions,
      );
      return { bundle, versions, variant };
    })();
    return prepared;
  }

  async function staged(candidate: ConfigurationBundle, versions: Record<string, number>) {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-config-import-"));
    dirs.push(stateDir);
    const result = stageConfigurationImport(
      stateDir,
      ring,
      encodeConfigurationBundle(candidate, "a strong passphrase"),
      "a strong passphrase",
      (bundle) => {
        validateConfigurationBundle(bundle, ALL_MODULES, versions);
        return Promise.resolve();
      },
    );
    return { stateDir, result };
  }

  it("a refused routing bundle leaves no venue or cells", async () => {
    const { bundle, versions, variant } = await exported();
    expect(bundle.tables.routing_cells).toHaveLength(2);
    const control = await staged(bundle, versions);
    await expect(control.result).resolves.toMatchObject({ counts: { routing_cells: 2 } });

    const refused: ConfigurationBundle = {
      ...bundle,
      tables: {
        ...bundle.tables,
        routing_cells: bundle.tables.routing_cells!.map((row) =>
          row.product_id === null ? row : { ...row, product_id: variant },
        ),
      },
    };
    const refusal = {
      code: "setup.request_invalid",
      params: { field: "routing_cells.product_id" },
    };
    const { stateDir, result } = await staged(refused, versions);
    await expect(result).rejects.toMatchObject(refusal);
    expect(await readdir(stateDir)).toEqual([]);

    const request = venue("B24681362");
    await expect(
      applyVenue(planVenue(request, ALL_MODULES), {
        db: target.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, created) =>
          importConfigurationTables(
            tx,
            refused,
            { locationId: created.locationId },
            ALL_MODULES,
            versions,
          ),
      }),
    ).rejects.toMatchObject(refusal);
    const tenants = await target.db.execute<{ count: number }>(
      sql`select count(*) as count from tenants where tax_id = ${request.taxId}`,
    );
    expect(tenants.rows[0]!.count).toBe(0);
    const cells = await target.db.execute<{ count: number }>(
      sql`select count(*) as count from routing_cells`,
    );
    expect(cells.rows[0]!.count).toBe(0);
  });

  it("refuses a cell whose zone's department is switched off, naming the choice, and writes nothing", async () => {
    const { bundle, versions } = await exported();
    const comedor = bundle.tables.departments!.find((row) => row.name === "Comedor")!;
    expect(comedor.active).toBe(1);
    const terraza = bundle.tables.floor_zones!.find((row) => row.name === "Terraza")!;
    const switchedOff: ConfigurationBundle = {
      ...bundle,
      tables: {
        ...bundle.tables,
        departments: bundle.tables.departments!.map((row) =>
          row === comedor ? { ...row, active: 0 } : row,
        ),
      },
    };
    const refusal = {
      code: "service_zone.not_found",
      params: {
        zoneId: terraza.id,
        zoneName: "Terraza",
        departmentId: comedor.id,
        departmentName: "Comedor",
        row: "product",
        name: "Mojito",
      },
    };
    const { stateDir, result } = await staged(switchedOff, versions);
    await expect(result).rejects.toMatchObject(refusal);
    expect(await readdir(stateDir)).toEqual([]);

    const request = venue("B24681363");
    await expect(
      applyVenue(planVenue(request, ALL_MODULES), {
        db: target.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, created) =>
          importConfigurationTables(
            tx,
            switchedOff,
            { locationId: created.locationId },
            ALL_MODULES,
            versions,
          ),
      }),
    ).rejects.toMatchObject(refusal);
    const tenants = await target.db.execute<{ count: number }>(
      sql`select count(*) as count from tenants where tax_id = ${request.taxId}`,
    );
    expect(tenants.rows[0]!.count).toBe(0);
    const cells = await target.db.execute<{ count: number }>(
      sql`select count(*) as count from routing_cells`,
    );
    expect(cells.rows[0]!.count).toBe(0);
  });

  it("refuses a switched-on zone in a switched-off department when no routing cell names it, and writes nothing", async () => {
    const { bundle, versions } = await exported();
    const comedor = bundle.tables.departments!.find((row) => row.name === "Comedor")!;
    expect(comedor.active).toBe(1);
    const terraza = bundle.tables.floor_zones!.find((row) => row.name === "Terraza")!;
    const withoutCell: ConfigurationBundle = {
      ...bundle,
      tables: {
        ...bundle.tables,
        departments: bundle.tables.departments!.map((row) =>
          row === comedor ? { ...row, active: 0 } : row,
        ),
        routing_cells: bundle.tables.routing_cells!.filter((row) => row.zone_id === null),
      },
    };
    const zoneRefused = await staged(withoutCell, versions);
    const zoneRefusal = await zoneRefused.result.then(
      () => expect.fail("the bundle was accepted"),
      (error: unknown) => error,
    );
    const refusal = {
      code: "zone.department_inactive",
      params: {
        zoneId: terraza.id,
        zoneName: "Terraza",
        departmentId: comedor.id,
        departmentName: "Comedor",
      },
    };
    expect(zoneRefusal).toMatchObject({ code: refusal.code });
    expect((zoneRefusal as { params: unknown }).params).toEqual(refusal.params);
    expect(await readdir(zoneRefused.stateDir)).toEqual([]);

    const request = venue("B24681364");
    await expect(
      applyVenue(planVenue(request, ALL_MODULES), {
        db: target.db,
        modules: ALL_MODULES,
        beforeCommit: (tx, created) =>
          importConfigurationTables(
            tx,
            withoutCell,
            { locationId: created.locationId },
            ALL_MODULES,
            versions,
          ),
      }),
    ).rejects.toMatchObject(refusal);
    const tenants = await target.db.execute<{ count: number }>(
      sql`select count(*) as count from tenants where tax_id = ${request.taxId}`,
    );
    expect(tenants.rows[0]!.count).toBe(0);

    const comedorZones = new Set(
      withoutCell.tables
        .zone_service_policies!.filter((row) => row.department_id === comedor.id)
        .map((row) => row.zone_id),
    );
    expect(comedorZones.has(terraza.id)).toBe(true);
    const zonesOff: ConfigurationBundle = {
      ...withoutCell,
      tables: {
        ...withoutCell.tables,
        floor_zones: withoutCell.tables.floor_zones!.map((row) =>
          comedorZones.has(row.id) ? { ...row, active: 0 } : row,
        ),
      },
    };
    const accepted = await staged(zonesOff, versions);
    await expect(accepted.result).resolves.toMatchObject({ counts: { routing_cells: 1 } });
  });

  it("refuses a bundle exported before the routing grid by its venue-service version, before any write", async () => {
    const { bundle, versions } = await exported();
    const journal = JSON.parse(
      await readFile(
        new URL("../../../packages/venue-service/drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    const routingMigration = journal.entries.findIndex((entry) =>
      entry.tag.endsWith("_routing_cells"),
    );
    expect(routingMigration).toBeGreaterThan(0);
    expect(versions["venue-service"]).toBe(journal.entries.length);
    const older: ConfigurationBundle = {
      ...bundle,
      modules: { ...bundle.modules, "venue-service": routingMigration },
    };
    const { stateDir, result } = await staged(older, versions);
    await expect(result).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "module:venue-service" },
    });
    expect(await readdir(stateDir)).toEqual([]);
  });

  it("accepts a fresh bundle whose versions match the journal", async () => {
    const { bundle, versions } = await exported();
    const venueService = ALL_MODULES.find((module) => module.name === "venue-service")!;
    expect(versions["venue-service"]).toBe(expectedSchemaVersion(venueService.migrations, null));
    expect(bundle.modules["venue-service"]).toBe(versions["venue-service"]);
    const { stateDir, result } = await staged(bundle, versions);
    await expect(result).resolves.toMatchObject({ counts: { routing_cells: 2 } });
    expect((await readdir(stateDir)).sort()).toEqual([
      "configuration-import.artifact",
      "configuration-import.json",
      "configuration-import.key",
    ]);
  });
});
