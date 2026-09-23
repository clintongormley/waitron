// A real venue DIRECTORY under `os.tmpdir()`: exercises setup through the two SQLite files the
// product opens, not a fake. There is no container and no role here — the engine has neither.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    // The new key round-trips (a dropped key would fail the toEqual below), and the demo default is
    // English (Spanish is opt-in via WAITRON_SEED_LOCALE=es-ES — see resolveSeedLocale).
    expect(sampleEnv.WAITRON_TILL_LOCALE).toBe("en-GB");
    expect(parseEnvFile(renderEnvFile(sampleEnv)).WAITRON_TILL_LOCALE).toBe("en-GB");
  });

  it("round-trips exactly through parseEnvFile", () => {
    // toEqual, not toMatchObject: a stray or dropped key must fail (CLAUDE.md §4).
    expect(parseEnvFile(renderEnvFile(sampleEnv))).toEqual({ ...sampleEnv });
    // A real 32-byte credentials key ends in base64 `=` padding, so the value itself contains `=` —
    // exercise the parser's "split on the FIRST `=`" branch, not just `=`-free values.
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
    // The returned value is the BARE content locale (`en`/`es`); the env var stays the full tag.
    delete process.env.WAITRON_SEED_LOCALE;
    expect(resolveSeedLocale()).toBe("en");
    process.env.WAITRON_SEED_LOCALE = "fr-FR";
    expect(resolveSeedLocale()).toBe("en");
    process.env.WAITRON_SEED_LOCALE = "es-ES";
    expect(resolveSeedLocale()).toBe("es");
  });
});

// The env-building step `devSetup` runs to assemble its `.env`. Proving BOTH locales here (pure, no
// database) closes the gap the review flagged: the venue-directory `devSetup` suite only ever
// exercises the default English path, so nothing else proves the Spanish `seedLocale` reaches
// `WAITRON_TILL_LOCALE` in the written `.env`. `devSetup` builds its env via exactly this function
// (dev-setup.ts), and the directory-backed suite proves that env is what reaches disk (CLAUDE.md
// §1: the value must reach `.env` through the flow). The mapping is bare content locale → full
// display tag: `WAITRON_TILL_LOCALE` is a `SUPPORTED_LOCALES` code.
describe("buildDevEnv carries the resolved seed locale into the env contract", () => {
  const ids = {
    tillId: "22222222-2222-2222-2222-222222222222",
    nodeId: "33333333-3333-3333-3333-333333333333",
    seriesId: "44444444-4444-4444-4444-444444444444",
    locationId: "55555555-5555-5555-5555-555555555555",
  };

  it("sets WAITRON_ENV=dev so the switcher is on under pnpm dev", () => {
    // deploymentEnvironment("dev") maps to "preproduction" (config.ts) — this is a DEV-only input
    // that turns the switcher on and never touches the fiscal stamp (see devSetup's own
    // venue-directory suite, which pins config.environment to "preproduction" separately).
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
    // The one storage setting left: `config.ts` resolves `WAITRON_VENUE_DIR` to the directory
    // `openVenueStore` creates `venue.db` and `node.db` in, so the written `.env` points `pnpm dev`
    // at the very directory this run provisioned.
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
      // The mapping (dev-setup.ts): the bare content locale becomes the full-tag
      // WAITRON_TILL_LOCALE (a SUPPORTED_LOCALES code)…
      expect(env.WAITRON_TILL_LOCALE).toBe(expectedTillLocale);
      // …and survives the round-trip out to the written `.env` text and back.
      expect(parseEnvFile(renderEnvFile(env)).WAITRON_TILL_LOCALE).toBe(expectedTillLocale);
    },
  );
});

// A real venue directory exercises dev-setup's actual migration, provisioning and reuse. The
// directory is the product's own (`openVenueDatabase`), so what this suite proves about migrating
// and provisioning is what a laptop gets.
describe("devSetup against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let envPath: string;
  let first: DevSetupResult;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-setup-"));
    venueDir = join(workDir, "venue");
    envPath = join(workDir, ".env");
    // The FIRST run: a virgin directory with no `.env` — provisions.
    first = await devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** Read the provisioned venue through the product's own opener, then close both files: the suite
   * calls `devSetup` again between assertions, and a handle left open would be a second writer. */
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
    // Two registers: provisioning's "Caja 1" plus the "Mostrador" register the seeded till DEVICE
    // auto-creates when it enrols (seedDemoDevices). The handheld shares "Mostrador" and adds none.
    expect(await tillsCount()).toBe(2);

    // The four fiscal ids are real uuids and the file on disk matches the returned env.
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
    // dev-setup boots pnpm dev with the switcher on (WAITRON_ENV=dev) while the venue still behaves as
    // preproduction — proven by the `config.environment` toBe("preproduction") assertion in the
    // loadConfig `it()` block below (dev-setup writes no deployment stamp at all).
    expect(first.env.WAITRON_ENV).toBe("dev");
    // The demo seeds English by default, and the till boots against it.
    expect(written.WAITRON_TILL_LOCALE).toBe("en-GB");
    expect(first.env.WAITRON_TILL_LOCALE).toBe("en-GB");
  });

  it("migrates into the venue file the server opens, not somewhere else", async () => {
    // The regression this catches is a `devSetup` that migrates one directory and writes another
    // into `.env`: the server would then open a virgin database and refuse at boot. Read the venue
    // FILE the written `WAITRON_VENUE_DIR` names and find the provisioned rows in it.
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
    // The regression this guards: `ALL_MODULES` carries TWO fiscal-slot members, so an absent
    // modules.json is all-enabled and boot refuses `module.fiscal_slot_ambiguous`. dev-setup now writes
    // one selecting the ES-common venue's regime, so `pnpm dev` boots. Read the file back through the
    // SAME parser boot uses and prove the enabled set resolves to a single member — the boot-time
    // `fiscalSlot` call, minus the processes a full boot needs.
    const raw: unknown = JSON.parse(readFileSync(join(workDir, "modules.json"), "utf8"));
    const config = parseModuleConfig(raw, ALL_MODULES);
    // fiscal-none is explicitly disabled; verifactu stays enabled (default-on).
    expect((raw as { modules: Record<string, boolean> }).modules["fiscal-none"]).toBe(false);
    expect(fiscalSlot(enabledModules(ALL_MODULES, config), null).id).toBe("verifactu");
  });

  it("writes a .env that loadConfig and loadKeyRing accept as valid server config", () => {
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    // loadConfig resolves the whole server config, including the four WAITRON_TILL_* ids via
    // loadTillConfig — a throw here would be server.config_missing / server.till_config_* (the
    // codes dev-setup's whole purpose is to make impossible). Placeholder roots: loadConfig only
    // uses them as string fallbacks, never stats them.
    const config = loadConfig(written, "/dev/null/migrations", "/dev/null/state");
    expect(config.environment).toBe("preproduction");
    expect(config.httpPort).toBe(8080);
    // The venue directory the `.env` names is the one the server will open.
    expect(config.venueDir).toBe(venueDir);
    // dev-setup ALWAYS provisions a venue, so `loadConfig` resolves the four ids into `config.till`
    // (never setup mode's `undefined` — which is exactly the state dev-setup exists to make
    // impossible). Assert it is present, then read the fiscal ids off it — the `?.` keeps each
    // assertion honest (an undefined till would fail the `toBe`, not throw) now that `config.till` is
    // optional (slice 1b).
    expect(config.till).toBeDefined();
    expect(config.till?.tillId).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(config.till?.seriesId).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(config.till?.locationId).toBe(first.env.WAITRON_TILL_LOCATION_ID);
    // The generated credentials key is a valid 32-byte base64 ring.
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
    // The fiscal assertion: no re-provision, so the two registers from the first run stand unchanged
    // (no second SIF, no second chain).
    expect(await tillsCount()).toBe(2);
    // Same identity handed back, read from the untouched `.env`.
    expect(second.env.WAITRON_TILL_TILL_ID).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(second.env.WAITRON_TILL_NODE_ID).toBe(first.env.WAITRON_TILL_NODE_ID);
    expect(second.env.WAITRON_TILL_SERIES_ID).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(second.env.WAITRON_TILL_LOCATION_ID).toBe(first.env.WAITRON_TILL_LOCATION_ID);
  });

  it("provisioning seeds the starter profiles", async () => {
    // The en-GB demo gets localized starter profiles, with default capabilities and no canvas binding.
    // Read through the table definition, so the JSON capability list is decoded the way every
    // product reader gets it rather than as the text the column stores.
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
    // Each device came through join-and-accept (`enrolDeviceForTest`, seedDemoDevices), NOT a direct
    // insert, so this pins the bindings that path produces: the till auto-created its own "Mostrador"
    // register, the handheld rings into that SAME register (no third till), and the kds is bound to
    // the venue's default preparation station, after the demo has renamed it to "Kitchen".
    // toEqual, not toMatchObject (CLAUDE.md §4).
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
    // The dangerous case: a `.env` lost/deleted (or its ids gone stale) against a directory that
    // still holds a venue. Provisioning fresh here would mint a SECOND SIF and a second hash chain
    // (CLAUDE.md §5), so devSetup must REFUSE rather than provision — removing the venue directory
    // (`pnpm dev:reset`) is the only sanctioned way to start over.
    rmSync(envPath);
    await expect(devSetup({ venueDir, envPath, stateDir: workDir, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    // The fiscal assertion: still the two registers from the first run, no second chain.
    expect(await tillsCount()).toBe(2);
  });
});

describe("resetVenueDir", () => {
  it("removes the venue directory and both write-ahead sidecars with it", async () => {
    // What `pnpm dev:reset` now does instead of wiping a Docker volume. The whole directory goes,
    // not just `venue.db`: a venue file removed while its `-wal` stays behind is the shape the
    // restore surgery measured as a silent wrong answer.
    const dir = await mkdtemp(join(tmpdir(), "waitron-reset-"));
    const store = await openVenueDatabase(dir);
    await store.venue.execute(sql`create table marker (id integer primary key)`);
    await store.close();
    expect(existsSync(join(dir, "venue.db"))).toBe(true);

    resetVenueDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op on a directory that is not there yet", () => {
    // The first-ever `pnpm dev:reset` on a fresh checkout: there is no venue directory, and that is
    // not a failure.
    const missing = join(tmpdir(), `waitron-reset-absent-${String(process.pid)}`);
    expect(existsSync(missing)).toBe(false);
    expect(() => resetVenueDir(missing)).not.toThrow();
  });
});

// `inspectVenues` decides whether devSetup provisions or refuses, so what it does with a directory
// whose migrations have NOT run is the interesting half — that is the fresh-laptop case.
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
    // A virgin directory OPENS (`openVenueStore` creates it), so "no venue" cannot be an open
    // failure — it is the absence of the tables, and that is what lets a fresh laptop fall through
    // to migrate rather than refuse.
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
    // The rule this holds: only an ABSENT table means "no venue". A directory whose `tills` table
    // exists but cannot answer the question must THROW, because reporting it empty would let
    // devSetup provision a second venue over a live one (CLAUDE.md §5). Staged by creating the two
    // tables with the wrong shape, which is the cheapest failure that is not an absent table.
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
