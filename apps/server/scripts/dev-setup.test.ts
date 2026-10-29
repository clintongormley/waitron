import { VALENCIA_DEMO_TEXT, GALICIA_DEMO_TEXT } from "@waitron/country-packs/demo/testing";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  locations,
  nodes,
  openVenueDatabase,
  runMigrations,
  tenants,
} from "@waitron/db";
import { loadKeyRing } from "@waitron/credentials";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { loadConfig } from "../src/config.js";
import { ALL_MODULES } from "../src/modules.js";
import {
  ADMIN_PIN,
  buildDevEnv,
  DEMO_DEVICE_LINES,
  devSetup,
  inspectVenues,
  parseEnvFile,
  renderEnvFile,
  resetVenueDir,
  resolveSeedLocale,
  type DevEnv,
  type DevSetupResult,
} from "./dev-setup.js";

const sampleEnv: DevEnv = {
  WAITRON_VENUE_DIR: "/var/lib/waitron/venue",
  WAITRON_ENV: "dev",
  WAITRON_ONBOARDING_INTENT: "demo",
  WAITRON_HTTP_PORT: "8080",
  WAITRON_CREDENTIALS_KEY: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_NODE_ID: "33333333-3333-3333-3333-333333333333",
  WAITRON_TILL_LOCALE: "en-GB",
};

describe("renderEnvFile", () => {
  it("emits every key=value line in the server's env-contract order", () => {
    const lines = renderEnvFile(sampleEnv)
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines).toEqual([
      "WAITRON_VENUE_DIR=/var/lib/waitron/venue",
      "WAITRON_ENV=dev",
      "WAITRON_ONBOARDING_INTENT=demo",
      "WAITRON_HTTP_PORT=8080",
      "WAITRON_CREDENTIALS_KEY=c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
      "WAITRON_CREDENTIALS_KEY_VERSION=1",
      "WAITRON_NODE_ID=33333333-3333-3333-3333-333333333333",
      "WAITRON_TILL_LOCALE=en-GB",
    ]);
  });

  it("carries WAITRON_TILL_LOCALE so the till boots against the seeded locale", () => {
    expect(sampleEnv.WAITRON_TILL_LOCALE).toBe("en-GB");
    expect(parseEnvFile(renderEnvFile(sampleEnv)).WAITRON_TILL_LOCALE).toBe("en-GB");
  });

  it("round-trips exactly through parseEnvFile", () => {
    expect(parseEnvFile(renderEnvFile(sampleEnv))).toEqual({ ...sampleEnv });
    // A real 32-byte key ends in base64 `=` padding, so the parser must split on the FIRST `=`.
    const withPadding: DevEnv = {
      ...sampleEnv,
      WAITRON_CREDENTIALS_KEY: "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=",
    };
    expect(parseEnvFile(renderEnvFile(withPadding))).toEqual({ ...withPadding });
  });
});

describe("the demo login PIN + seed locale", () => {
  const prior = process.env.WAITRON_SEED_LOCALE;
  afterAll(() => {
    if (prior === undefined) delete process.env.WAITRON_SEED_LOCALE;
    else process.env.WAITRON_SEED_LOCALE = prior;
  });

  it("uses the shared demo PIN 5555 for every login", () => {
    expect(ADMIN_PIN).toBe("5555");
  });

  it("defaults the seed locale to English and flips to Spanish only for WAITRON_SEED_LOCALE=es-ES", () => {
    delete process.env.WAITRON_SEED_LOCALE;
    expect(resolveSeedLocale()).toBe("en");
    process.env.WAITRON_SEED_LOCALE = "fr-FR";
    expect(resolveSeedLocale()).toBe("en");
    process.env.WAITRON_SEED_LOCALE = "es-ES";
    expect(resolveSeedLocale()).toBe("es");
  });
});

// The directory-backed `devSetup` suite runs only the English path, so the Spanish locale's route
// into `WAITRON_TILL_LOCALE` is pinned here.
describe("buildDevEnv carries the resolved seed locale into the env contract", () => {
  const ids = {
    nodeId: "33333333-3333-3333-3333-333333333333",
    seriesId: "44444444-4444-4444-4444-444444444444",
    locationId: "55555555-5555-5555-5555-555555555555",
  };

  it("writes the shifted server port into a second stack's env", () => {
    const env = buildDevEnv({
      venueDir: "/tmp/second-venue",
      credentialsKey: sampleEnv.WAITRON_CREDENTIALS_KEY,
      ids,
      seedLocale: "en",
      httpPort: "8180",
    });
    expect(env.WAITRON_HTTP_PORT).toBe("8180");
  });

  it("sets WAITRON_ENV=dev so the switcher is on under pnpm dev", () => {
    const env = buildDevEnv({
      venueDir: "/var/lib/waitron/venue",
      credentialsKey: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
      ids,
      seedLocale: "en",
    });
    expect(env.WAITRON_ENV).toBe("dev");
    expect(env.WAITRON_ONBOARDING_INTENT).toBe("demo");
  });

  it("names the venue directory the server opens", () => {
    const env = buildDevEnv({
      venueDir: "/var/lib/waitron/venue",
      credentialsKey: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
      ids,
      seedLocale: "en",
    });
    expect(env.WAITRON_VENUE_DIR).toBe("/var/lib/waitron/venue");
  });

  it.each([
    ["en", "en-GB"],
    ["es", "es-ES"],
  ] as const)(
    "maps bare seed locale %s into full-tag WAITRON_TILL_LOCALE and renders it into the .env text",
    (seedLocale, expectedTillLocale) => {
      const env = buildDevEnv({
        venueDir: "/var/lib/waitron/venue",
        credentialsKey: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
        ids,
        seedLocale,
      });
      expect(env.WAITRON_TILL_LOCALE).toBe(expectedTillLocale);
      expect(parseEnvFile(renderEnvFile(env)).WAITRON_TILL_LOCALE).toBe(expectedTillLocale);
    },
  );
});

describe("devSetup against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let envPath: string;
  let first: DevSetupResult;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-setup-"));
    venueDir = join(workDir, "venue");
    envPath = join(workDir, ".env");
    first = await devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** Closes the store after each read: the suite calls `devSetup` again between assertions. */
  async function readVenue<T>(
    body: (db: Awaited<ReturnType<typeof openVenueDatabase>>["venue"]) => Promise<T>,
  ): Promise<T> {
    const store = await openVenueDatabase(venueDir);
    try {
      return await body(store.venue);
    } finally {
      await store.close();
    }
  }

  async function devicesCount(): Promise<number> {
    return readVenue(async (db) => {
      const { rows } = await db.execute<{ n: number }>(sql`select count(*) as n from devices`);
      return rows[0]!.n;
    });
  }

  it("provisions a virgin directory, writing a .env with no till id", async () => {
    expect(first.reused).toBe(false);
    // The till, handheld and three kitchen displays it pairs.
    expect(await devicesCount()).toBe(5);

    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    expect(written).toEqual({ ...first.env });
    expect(written).not.toHaveProperty("WAITRON_TILL_TILL_ID");
    for (const key of ["WAITRON_NODE_ID"] as const) {
      expect(first.env[key]).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(first.env.WAITRON_VENUE_DIR).toBe(venueDir);
    expect(first.env.WAITRON_ENV).toBe("dev");
    expect(written.WAITRON_TILL_LOCALE).toBe("en-GB");
    expect(first.env.WAITRON_TILL_LOCALE).toBe("en-GB");
  });

  it("builds the venue as the Spain pack's demo business, and its seeded sales are filed under that tax ID", async () => {
    const read = await readVenue(async (db) => {
      const { rows: tenant } = await db.execute<{ legal_name: string; tax_id: string }>(
        sql`select legal_name, tax_id from tenants`,
      );
      const { rows: location } = await db.execute<{ name: string }>(
        sql`select name from locations`,
      );
      const { rows: departments } = await db.execute<{ trading_name: string }>(
        sql`select trading_name from departments order by trading_name`,
      );
      const { rows: sales } = await db.execute<{ n: number }>(sql`select count(*) as n from sales`);
      const { rows: records } = await db.execute<{ issuer: string; n: number }>(
        sql`select id_emisor_factura as issuer, count(*) as n from registros_facturacion group by id_emisor_factura`,
      );
      return { tenant, location, departments, sales: sales[0]!.n, records };
    });
    expect(read.tenant).toEqual([{ legal_name: "Waitron Demo S.L.", tax_id: "B00000000" }]);
    expect(read.location).toEqual([{ name: "Casa Delgado" }]);
    expect(read.departments.map((d) => d.trading_name)).toEqual([
      "Bar Casa Delgado",
      "Deli Delgado",
    ]);
    expect(read.sales).toBeGreaterThan(0);
    expect(read.records).toEqual([{ issuer: "B00000000", n: read.sales }]);
  });

  it("stores English operation and street examples in a new developer venue", async () => {
    const rows = await readVenue(async (db) => {
      const result = await db.execute<{ operation_description: string; address_line1: string }>(
        sql`select operation_description, address_line1 from locations`,
      );
      return result.rows;
    });
    expect(rows).toEqual([
      { operation_description: "In-store sales", address_line1: "1 Main Street" },
    ]);
  });

  it("gives the developer administrator an English display name", async () => {
    const rows = await readVenue(async (db) => {
      const result = await db.execute<{ display_name: string }>(
        sql`select display_name from persons where role = 'admin'`,
      );
      return result.rows;
    });
    expect(rows).toEqual([{ display_name: "Administrator" }]);
  });

  it("migrates into the venue file the server opens, not somewhere else", async () => {
    const store = await openVenueDatabase(first.env.WAITRON_VENUE_DIR);
    try {
      const { rows } = await store.venue.execute<{ n: number }>(
        sql`select count(*) as n from tenants`,
      );
      expect(rows[0]!.n).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("writes a modules.json that resolves the fiscal slot to exactly one member (verifactu)", () => {
    // An absent modules.json enables every fiscal-slot member and boot refuses
    // `module.fiscal_slot_ambiguous`.
    const raw: unknown = JSON.parse(readFileSync(join(workDir, "modules.json"), "utf8"));
    const config = parseModuleConfig(raw, ALL_MODULES);
    expect((raw as { modules: Record<string, boolean> }).modules["fiscal-none"]).toBe(false);
    expect(fiscalSlot(enabledModules(ALL_MODULES, config), null).id).toBe("verifactu");
  });

  it("writes a .env that loadConfig and loadKeyRing accept as valid server config", () => {
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    // Placeholder roots: loadConfig uses them as string fallbacks and never stats them.
    const config = loadConfig(written, "/dev/null/migrations", "/dev/null/state");
    expect(config.environment).toBe("preproduction");
    expect(config.httpPort).toBe(8080);
    expect(config.venueDir).toBe(venueDir);
    expect(config.node).toBeDefined();
    expect(config.node).not.toHaveProperty("seriesId");
    expect(config.node).not.toHaveProperty("locationId");
    const ring = loadKeyRing(written);
    expect(ring.current.key).toHaveLength(32);
    expect(ring.current.version).toBe(1);
  });

  it("reuses an already-provisioned venue rather than minting a second chain", async () => {
    const second = await devSetup({
      venueDir,
      envPath,
      stateDir: workDir,
      log: () => {},
    });

    expect(second.reused).toBe(true);
    expect(await devicesCount()).toBe(5);
    expect(second.env.WAITRON_NODE_ID).toBe(first.env.WAITRON_NODE_ID);
    expect(second.env).not.toHaveProperty("WAITRON_TILL_SERIES_ID");
    expect(second.env).toEqual(first.env);
  });

  it("provisioning seeds the starter profiles", async () => {
    // Read through the table definition, so the JSON capability list is decoded as product readers
    // get it.
    const profiles = await readVenue(async (db) =>
      db
        .select({
          name: deviceProfiles.name,
          capabilities: deviceProfiles.capabilities,
        })
        .from(deviceProfiles)
        .orderBy(deviceProfiles.name),
    );
    expect(profiles).toEqual([
      {
        name: "Counter",
        capabilities: [
          "integrated-card-payment",
          "open-cash-drawer",
          "print-receipt",
          "show-station",
          "show-expo",
          "show-schedule",
          "take-cash",
          "take-orders",
          "hand-keyed-card-payment",
          "prepare-orders",
          "hand-over-orders",
          "run-the-pass",
          "clock-in",
        ],
      },
      {
        name: "Handheld",
        capabilities: [
          "take-orders",
          "take-cash",
          "integrated-card-payment",
          "hand-keyed-card-payment",
          "print-receipt",
          "prepare-orders",
          "hand-over-orders",
          "clock-in",
        ],
      },
      {
        name: "Kitchen",
        capabilities: [
          "act-as-kds",
          "prepare-orders",
          "take-orders",
          "hand-over-orders",
          "run-the-pass",
        ],
      },
    ]);
  });

  it("enrols a till, handheld and three kitchen displays via the real enrol path", async () => {
    const rows = await readVenue(async (db) => {
      const result = await db.execute<{
        label: string;
        form_factor: string;
        screen: string | null;
        station_names: string | null;
        every_station: number | null;
        every_zone: number | null;
      }>(
        sql`select d.label, dp.form_factor, dks.screen, dks.every_station,
                   (select group_concat(name, ',') from (
                      select ks.name from device_kitchen_screen_stations s
                      join kitchen_stations ks on ks.id = s.station_id
                      where s.device_id = d.id and s.screen = dks.screen
                      order by ks.name)) as station_names,
                   dks.every_zone
            from devices d
            join device_profiles dp on dp.id = d.device_profile_id
            left join device_kitchen_screens dks on dks.device_id = d.id
            order by d.label`,
      );
      return result.rows;
    });
    expect(rows).toEqual([
      {
        label: "Counter",
        form_factor: "till",
        screen: null,
        every_station: null,
        station_names: null,
        every_zone: null,
      },
      {
        label: "Handheld 1",
        form_factor: "phone-portrait",
        screen: null,
        every_station: null,
        station_names: null,
        every_zone: null,
      },
      {
        label: "Kitchen screen",
        form_factor: "kds",
        screen: "station",
        every_station: 0,
        station_names: "Kitchen",
        every_zone: 0,
      },
      {
        label: "Pass monitor",
        form_factor: "kds",
        screen: "pass_monitor",
        every_station: 1,
        station_names: null,
        every_zone: 1,
      },
      {
        label: "Pass screen",
        form_factor: "kds",
        screen: "pass",
        every_station: 0,
        station_names: "Deli counter,Kitchen",
        every_zone: 1,
      },
    ]);
  });

  it("prints every enrolled device, naming what each kitchen display runs", async () => {
    const labels = await readVenue(async (db) => {
      const { rows } = await db.execute<{ label: string }>(sql`select label from devices`);
      return rows.map((row) => row.label);
    });
    const printed = DEMO_DEVICE_LINES.join("\n");
    for (const label of labels) expect(printed).toContain(label);
    expect(printed).toContain("Counter (till)");
    expect(printed).toContain("Handheld 1 (handheld)");
    expect(printed).toContain("Kitchen screen (station screen)");
    expect(printed).toContain("Pass screen (pass screen)");
    expect(printed).toContain("Pass monitor (pass monitor)");
    expect(printed).not.toMatch(/watcher/i);
  });

  it("refuses to provision a second venue when the .env no longer names the directory's venue", async () => {
    // Provisioning here would mint a second SIF and a second hash chain (CLAUDE.md §5).
    rmSync(envPath);
    await expect(devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    expect(await devicesCount()).toBe(5);
  });
});

describe("devSetup under WAITRON_ENV=production", () => {
  let workDir: string;
  let venueDir: string;
  let envPath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-setup-production-"));
    venueDir = join(workDir, "venue");
    envPath = join(workDir, ".env");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  it("refuses before touching the directory, so the same directory provisions once corrected", async () => {
    vi.stubEnv("WAITRON_SEED_SALES_DAYS", "1");
    vi.stubEnv("WAITRON_ENV", "production");

    await expect(
      devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} }),
    ).rejects.toMatchObject({ code: "deployment.demo_data_refused" });

    expect(existsSync(envPath)).toBe(false);
    expect(existsSync(join(venueDir, "venue.db"))).toBe(false);
    expect(existsSync(join(workDir, "modules.json"))).toBe(false);

    vi.stubEnv("WAITRON_ENV", "dev");
    const corrected = await devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} });
    expect(corrected.reused).toBe(false);
    expect(existsSync(envPath)).toBe(true);
    await expect(inspectVenues(venueDir, corrected.env.WAITRON_NODE_ID)).resolves.toEqual({
      hasExpected: true,
      hasAny: true,
    });
  });
});

describe("resetVenueDir", () => {
  it("removes the venue directory and both write-ahead sidecars with it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "waitron-reset-"));
    const store = await openVenueDatabase(dir);
    await store.venue.execute(sql`create table marker (id integer primary key)`);
    await store.close();
    expect(existsSync(join(dir, "venue.db"))).toBe(true);

    resetVenueDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op on a directory that is not there yet", () => {
    const missing = join(tmpdir(), `waitron-reset-absent-${String(process.pid)}`);
    expect(existsSync(missing)).toBe(false);
    expect(() => resetVenueDir(missing)).not.toThrow();
  });
});

describe("inspectVenues reads a migrated venue directory", () => {
  const locationId = "11111111-2222-3333-4444-555555555555";
  const nodeId = "22222222-2222-4222-8222-222222222222";
  let migrated: string;

  beforeAll(async () => {
    migrated = await mkdtemp(join(tmpdir(), "waitron-inspect-"));
    const store = await openVenueDatabase(migrated);
    try {
      await runMigrations(store.venue, CORE_MIGRATIONS);
      await store.venue
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "00000000T", legalName: "Inspection SL" });
      await store.venue.insert(locations).values({
        id: locationId,
        name: "Inspection",
        invoiceLocales: ["es-ES"],
        operationDescription: "Hospitality",
      });
      await store.venue.insert(nodes).values({ id: nodeId, locationId, name: "Inspection box" });
    } finally {
      await store.close();
    }
  }, 60_000);

  afterAll(async () => {
    if (migrated !== undefined) await rm(migrated, { recursive: true, force: true });
  });

  it("reads an unmigrated directory as holding no venue at all", async () => {
    const virgin = await mkdtemp(join(tmpdir(), "waitron-inspect-virgin-"));
    try {
      await expect(inspectVenues(virgin, null)).resolves.toEqual({
        hasExpected: false,
        hasAny: false,
      });
    } finally {
      await rm(virgin, { recursive: true, force: true });
    }
  });

  it("finds the expected node and refuses to overlook a different existing venue", async () => {
    await expect(inspectVenues(migrated, nodeId)).resolves.toEqual({
      hasExpected: true,
      hasAny: true,
    });
    await expect(inspectVenues(migrated, null)).resolves.toEqual({
      hasExpected: false,
      hasAny: true,
    });
  });

  it("refuses an existing venue with a missing node table instead of provisioning over it", async () => {
    const broken = await mkdtemp(join(tmpdir(), "waitron-inspect-no-nodes-"));
    try {
      const file = new DatabaseSync(join(broken, "venue.db"));
      try {
        file.exec(
          "create table locations (id text); create table tenants (id integer); insert into tenants values (1)",
        );
      } finally {
        file.close();
      }
      await expect(inspectVenues(broken, null)).rejects.toThrow(/no such table/i);
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });

  it("propagates a failed read instead of reporting an empty directory", async () => {
    // Only an absent table means "no venue"; reporting this one empty would let devSetup provision
    // a second venue over a live one (CLAUDE.md §5).
    const broken = await mkdtemp(join(tmpdir(), "waitron-inspect-broken-"));
    try {
      const file = new DatabaseSync(join(broken, "venue.db"));
      file.exec("create table locations (not_id text)");
      file.exec("create table tenants (id integer)");
      file.exec("create table nodes (id text, location_id text)");
      file.close();
      await expect(inspectVenues(broken, null)).rejects.toThrow(/no such column/i);
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });
});

describe("developer demo regions", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "", " ", "madrid", " catalonia ", "balearic"])(
    "resolves the selector %j before work",
    async (value) => {
      const module = await import("./dev-setup.js");
      expect(module).toHaveProperty("resolveDeveloperDemo", expect.any(Function));
      const preset = module.resolveDeveloperDemo(value);
      expect(preset).toMatchObject(
        value?.trim() === "catalonia"
          ? { dataSet: "casa-delgado-ca", postalCode: "08001", locationName: "Can Delgado" }
          : value === "balearic"
            ? { dataSet: "casa-delgado-ca", postalCode: "07001", locationName: "Can Delgado" }
            : { dataSet: "casa-delgado-es", postalCode: "28013", locationName: "Casa Delgado" },
      );
    },
  );
  it.each(["unknown", "constructor", "__proto__"])(
    "refuses %s without creating a database or settings",
    async (selector) => {
      const root = await mkdtemp(join(tmpdir(), "a972-dev-invalid-"));
      try {
        vi.stubEnv("WAITRON_ENV", "dev");
        vi.stubEnv("WAITRON_DEMO_REGION", selector);
        vi.stubEnv("WAITRON_SEED_SALES_DAYS", "0");
        await expect(
          devSetup({
            venueDir: join(root, "venue"),
            envPath: join(root, ".env"),
            stateDir: join(root, "state"),
          }),
        ).rejects.toThrow(/demo region/i);
        for (const file of ["venue", ".env", "state"])
          expect(existsSync(join(root, file))).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  for (const region of ["madrid", "catalonia", "balearic"])
    for (const staff of ["en", "es"] as const)
      it(`seeds ${region} in ${staff} and retains its stored geography when reused`, async () => {
        const root = await mkdtemp(join(tmpdir(), "a972-dev-region-"));
        try {
          vi.stubEnv("WAITRON_ENV", "dev");
          vi.stubEnv("WAITRON_DEMO_REGION", region);
          vi.stubEnv("WAITRON_SEED_LOCALE", staff === "es" ? "es-ES" : "en-GB");
          vi.stubEnv("WAITRON_SEED_SALES_DAYS", "0");
          const opts = {
            venueDir: join(root, "venue"),
            envPath: join(root, ".env"),
            stateDir: root,
          };
          const first = await devSetup(opts);
          const expected =
            region === "catalonia"
              ? {
                  name: "Can Delgado",
                  postal_code: "08001",
                  province: "Barcelona",
                  receipt: "ca-ES",
                }
              : region === "balearic"
                ? {
                    name: "Can Delgado",
                    postal_code: "07001",
                    province: "Balears, Illes",
                    receipt: "es-ES",
                  }
                : {
                    name: "Casa Delgado",
                    postal_code: "28013",
                    province: "Madrid",
                    receipt: staff === "es" ? "es-ES" : "en-GB",
                  };
          expect(first.env.WAITRON_TILL_LOCALE).toBe(expected.receipt);
          const store = await openVenueDatabase(opts.venueDir);
          try {
            const locations = store.venue.all(
              sql`select name,postal_code,province,invoice_locales from locations`,
            );
            expect(locations).toEqual([
              {
                name: expected.name,
                postal_code: expected.postal_code,
                province: expected.province,
                invoice_locales: JSON.stringify([expected.receipt]),
              },
            ]);
            const rows = store.venue.all<{ name: string }>(sql`select name from products`);
            expect(rows.some((p) => p.name === "Botifarra amb mongetes")).toBe(region !== "madrid");
            expect(store.venue.all(sql`select country from tenants`)).toEqual([{ country: "ES" }]);
          } finally {
            await store.close();
          }
          vi.stubEnv("WAITRON_DEMO_REGION", region === "madrid" ? "catalonia" : "madrid");
          const reused = await devSetup(opts);
          expect(reused.reused).toBe(true);
          expect(reused.env).toEqual(first.env);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }, 30000);
});

describe("Valencian developer demo", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("resolves a trimmed selector with Spanish receipts and Valencian geography", async () => {
    const { resolveDeveloperDemo } = await import("./dev-setup.js");
    expect(resolveDeveloperDemo(" valencia ")).toMatchObject({
      dataSet: "casa-delgado-valencia",
      locationName: VALENCIA_DEMO_TEXT.locationName,
      postalCode: "46001",
      city: VALENCIA_DEMO_TEXT.city,
      province: VALENCIA_DEMO_TEXT.province,
      timeZone: "Europe/Madrid",
      receiptLocale: "es-ES",
    });
  });
  it.each(["en-GB", "es-ES"])(
    "seeds Valencian names with %s staff and preserves reuse",
    async (locale) => {
      const root = await mkdtemp(join(tmpdir(), "a972-valencia-dev-"));
      try {
        vi.stubEnv("WAITRON_ENV", "dev");
        vi.stubEnv("WAITRON_DEMO_REGION", "valencia");
        vi.stubEnv("WAITRON_SEED_LOCALE", locale);
        vi.stubEnv("WAITRON_SEED_SALES_DAYS", "0");
        const opts = { venueDir: join(root, "venue"), envPath: join(root, ".env"), stateDir: root };
        const first = await devSetup(opts);
        expect(first.env.WAITRON_TILL_LOCALE).toBe("es-ES");
        const store = await openVenueDatabase(opts.venueDir);
        try {
          expect(
            store.venue.all(sql`select name,postal_code,province,invoice_locales from locations`),
          ).toEqual([
            {
              name: VALENCIA_DEMO_TEXT.locationName,
              postal_code: "46001",
              province: VALENCIA_DEMO_TEXT.province,
              invoice_locales: '["es-ES"]',
            },
          ]);
          expect(
            store.venue.all(
              sql`select name,kitchen_name from products where name=${VALENCIA_DEMO_TEXT.dish}`,
            ),
          ).toEqual([
            { name: VALENCIA_DEMO_TEXT.dish, kitchen_name: VALENCIA_DEMO_TEXT.dishKitchen },
          ]);
        } finally {
          await store.close();
        }
        vi.stubEnv("WAITRON_DEMO_REGION", "madrid");
        const reused = await devSetup(opts);
        expect(reused.reused).toBe(true);
        expect(reused.env).toEqual(first.env);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
});

describe("Galician developer demo", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("resolves a trimmed selector with Spanish receipts and Galician geography", async () => {
    const { resolveDeveloperDemo } = await import("./dev-setup.js");
    expect(resolveDeveloperDemo(" galicia ")).toMatchObject({
      dataSet: "casa-delgado-gl",
      locationName: GALICIA_DEMO_TEXT.locationName,
      postalCode: "15001",
      city: GALICIA_DEMO_TEXT.city,
      province: GALICIA_DEMO_TEXT.province,
      timeZone: "Europe/Madrid",
      receiptLocale: "es-ES",
    });
  });
  it.each(["en-GB", "es-ES"])(
    "seeds Galician names with %s staff and preserves reuse",
    async (locale) => {
      const root = await mkdtemp(join(tmpdir(), "a972-galicia-dev-"));
      try {
        vi.stubEnv("WAITRON_ENV", "dev");
        vi.stubEnv("WAITRON_DEMO_REGION", "galicia");
        vi.stubEnv("WAITRON_SEED_LOCALE", locale);
        vi.stubEnv("WAITRON_SEED_SALES_DAYS", "0");
        const opts = { venueDir: join(root, "venue"), envPath: join(root, ".env"), stateDir: root };
        const first = await devSetup(opts);
        expect(first.env.WAITRON_TILL_LOCALE).toBe("es-ES");
        const store = await openVenueDatabase(opts.venueDir);
        try {
          expect(
            store.venue.all(sql`select name,postal_code,province,invoice_locales from locations`),
          ).toEqual([
            {
              name: GALICIA_DEMO_TEXT.locationName,
              postal_code: "15001",
              province: GALICIA_DEMO_TEXT.province,
              invoice_locales: '["es-ES"]',
            },
          ]);
          expect(
            store.venue.all(
              sql`select name,kitchen_name from products where name=${GALICIA_DEMO_TEXT.dish}`,
            ),
          ).toEqual([
            { name: GALICIA_DEMO_TEXT.dish, kitchen_name: GALICIA_DEMO_TEXT.dishKitchen },
          ]);
        } finally {
          await store.close();
        }
        vi.stubEnv("WAITRON_DEMO_REGION", "madrid");
        const reused = await devSetup(opts);
        expect(reused.reused).toBe(true);
        expect(reused.env).toEqual(first.env);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30000,
  );
});
