import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  locations,
  openVenueDatabase,
  runMigrations,
  tenants,
  tills,
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
  WAITRON_TILL_TILL_ID: "22222222-2222-2222-2222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-3333-3333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-4444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-5555-5555-555555555555",
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
      "WAITRON_TILL_TILL_ID=22222222-2222-2222-2222-222222222222",
      "WAITRON_TILL_NODE_ID=33333333-3333-3333-3333-333333333333",
      "WAITRON_TILL_SERIES_ID=44444444-4444-4444-4444-444444444444",
      "WAITRON_TILL_LOCATION_ID=55555555-5555-5555-5555-555555555555",
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
    tillId: "22222222-2222-2222-2222-222222222222",
    nodeId: "33333333-3333-3333-3333-333333333333",
    seriesId: "44444444-4444-4444-4444-444444444444",
    locationId: "55555555-5555-5555-5555-555555555555",
  };

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

  async function tillsCount(): Promise<number> {
    return readVenue(async (db) => {
      const { rows } = await db.execute<{ n: number }>(sql`select count(*) as n from tills`);
      return rows[0]!.n;
    });
  }

  it("provisions a virgin directory, writing a .env and two tills rows", async () => {
    expect(first.reused).toBe(false);
    // Provisioning's "Caja 1" plus the "Mostrador" register the till device auto-creates.
    expect(await tillsCount()).toBe(2);

    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    expect(written).toEqual({ ...first.env });
    for (const key of [
      "WAITRON_TILL_TILL_ID",
      "WAITRON_TILL_NODE_ID",
      "WAITRON_TILL_SERIES_ID",
      "WAITRON_TILL_LOCATION_ID",
    ] as const) {
      expect(first.env[key]).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(first.env.WAITRON_VENUE_DIR).toBe(venueDir);
    expect(first.env.WAITRON_ENV).toBe("dev");
    expect(written.WAITRON_TILL_LOCALE).toBe("en-GB");
    expect(first.env.WAITRON_TILL_LOCALE).toBe("en-GB");
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
    expect(config.till).toBeDefined();
    expect(config.till?.tillId).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(config.till?.seriesId).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(config.till?.locationId).toBe(first.env.WAITRON_TILL_LOCATION_ID);
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
    expect(await tillsCount()).toBe(2);
    expect(second.env.WAITRON_TILL_TILL_ID).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(second.env.WAITRON_TILL_NODE_ID).toBe(first.env.WAITRON_TILL_NODE_ID);
    expect(second.env.WAITRON_TILL_SERIES_ID).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(second.env.WAITRON_TILL_LOCATION_ID).toBe(first.env.WAITRON_TILL_LOCATION_ID);
  });

  it("provisioning seeds the starter profiles", async () => {
    // Read through the table definition, so the JSON capability list is decoded as product readers
    // get it.
    const profiles = await readVenue(async (db) =>
      db
        .select({
          name: deviceProfiles.name,
          canvasId: deviceProfiles.canvasId,
          capabilities: deviceProfiles.capabilities,
        })
        .from(deviceProfiles)
        .orderBy(deviceProfiles.name),
    );
    expect(profiles).toEqual([
      {
        name: "Counter",
        canvasId: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer", "print-receipt"],
      },
      { name: "Handheld", canvasId: null, capabilities: [] },
      { name: "Kitchen", canvasId: null, capabilities: ["act-as-kds"] },
    ]);
  });

  it("enrols a till, handheld and kitchen display via the real enrol path", async () => {
    const rows = await readVenue(async (db) => {
      const result = await db.execute<{
        label: string;
        form_factor: string;
        register_name: string | null;
        station_name: string | null;
      }>(
        sql`select d.label, dp.form_factor, t.name as register_name, ks.name as station_name
            from devices d
            join device_profiles dp on dp.id = d.device_profile_id
            left join tills t on t.id = d.till_id
            left join kitchen_stations ks on ks.id = d.station_id
            order by d.label`,
      );
      return result.rows;
    });
    expect(rows).toEqual([
      {
        label: "Camarero 1",
        form_factor: "phone-portrait",
        register_name: "Mostrador",
        station_name: null,
      },
      { label: "Mostrador", form_factor: "till", register_name: "Mostrador", station_name: null },
      {
        label: "Pantalla Cocina",
        form_factor: "kds",
        register_name: null,
        station_name: "Kitchen",
      },
    ]);
  });

  it("refuses to provision a second venue when the .env no longer names the directory's venue", async () => {
    // Provisioning here would mint a second SIF and a second hash chain (CLAUDE.md §5).
    rmSync(envPath);
    await expect(devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    expect(await tillsCount()).toBe(2);
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
    await expect(inspectVenues(venueDir, corrected.env.WAITRON_TILL_TILL_ID)).resolves.toEqual({
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
  const tillId = "11111111-2222-3333-4444-555555555555";
  let migrated: string;

  beforeAll(async () => {
    migrated = await mkdtemp(join(tmpdir(), "waitron-inspect-"));
    const store = await openVenueDatabase(migrated);
    try {
      await runMigrations(store.venue, CORE_MIGRATIONS);
      await store.venue
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "00000000T", legalName: "Inspection SL" });
      const [location] = await store.venue
        .insert(locations)
        .values({
          name: "Inspection",
          invoiceLocales: ["es-ES"],
          operationDescription: "Hospitality",
        })
        .returning({ id: locations.id });
      await store.venue
        .insert(tills)
        .values({ id: tillId, locationId: location!.id, name: "Caja" });
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

  it("finds the expected till and refuses to overlook a different existing venue", async () => {
    await expect(inspectVenues(migrated, tillId)).resolves.toEqual({
      hasExpected: true,
      hasAny: true,
    });
    await expect(inspectVenues(migrated, null)).resolves.toEqual({
      hasExpected: false,
      hasAny: true,
    });
  });

  it("propagates a failed read instead of reporting an empty directory", async () => {
    // Only an absent table means "no venue"; reporting this one empty would let devSetup provision
    // a second venue over a live one (CLAUDE.md §5).
    const broken = await mkdtemp(join(tmpdir(), "waitron-inspect-broken-"));
    try {
      const file = new DatabaseSync(join(broken, "venue.db"));
      file.exec("create table tills (not_id text)");
      file.exec("create table tenants (id integer)");
      file.close();
      await expect(inspectVenues(broken, null)).rejects.toThrow(/no such column/i);
    } finally {
      await rm(broken, { recursive: true, force: true });
    }
  });
});
