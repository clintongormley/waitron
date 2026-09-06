import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useRealPostgres, useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { roleUrl, startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { loadKeyRing } from "@waitron/credentials";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import {
  ADMIN_PIN,
  buildDevEnv,
  devSetup,
  inspectVenues,
  parseEnvFile,
  renderEnvFile,
  resolveSeedLocale,
  type DevEnv,
  type DevSetupResult,
} from "./dev-setup.js";

const sampleEnv: DevEnv = {
  DATABASE_URL: "postgres://postgres:pg@localhost:5432/postgres",
  WAITRON_ENV: "dev",
  WAITRON_HTTP_PORT: "8080",
  WAITRON_CREDENTIALS_KEY: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_TILL_TENANT_ID: "11111111-1111-1111-1111-111111111111",
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
      "DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres",
      "WAITRON_ENV=dev",
      "WAITRON_HTTP_PORT=8080",
      "WAITRON_CREDENTIALS_KEY=c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
      "WAITRON_CREDENTIALS_KEY_VERSION=1",
      "WAITRON_TILL_TENANT_ID=11111111-1111-1111-1111-111111111111",
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
// container) closes the gap the review flagged: the real-PG `devSetup` suite only ever exercises the
// default English path, so nothing else proves the Spanish `seedLocale` reaches `WAITRON_TILL_LOCALE` in
// the written `.env`. `devSetup` builds its env via exactly this function (dev-setup.ts), and the
// container suite proves that env is what reaches disk — so English end-to-end there plus both locales
// here covers the mapping for real (CLAUDE.md §1: the value must reach `.env` through the flow). The
// mapping is bare content locale → full display tag: `WAITRON_TILL_LOCALE` is a `SUPPORTED_LOCALES` code.
describe("buildDevEnv carries the resolved seed locale into the env contract", () => {
  const ids = {
    tenantId: "11111111-1111-1111-1111-111111111111",
    tillId: "22222222-2222-2222-2222-222222222222",
    nodeId: "33333333-3333-3333-3333-333333333333",
    seriesId: "44444444-4444-4444-4444-444444444444",
    locationId: "55555555-5555-5555-5555-555555555555",
  };

  it("sets WAITRON_ENV=dev so the switcher is on under pnpm dev", () => {
    // deploymentEnvironment("dev") maps to "preproduction" (config.ts) — this is a DEV-only input
    // that turns the switcher on and never touches the fiscal stamp (see devSetup's own
    // "against real Postgres" suite, which pins config.environment to "preproduction" separately).
    const env = buildDevEnv({
      databaseUrl: "postgres://postgres:pg@localhost:5432/postgres",
      credentialsKey: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
      ids,
      seedLocale: "en",
    });
    expect(env.WAITRON_ENV).toBe("dev");
  });

  it.each([
    ["en", "en-GB"],
    ["es", "es-ES"],
  ] as const)(
    "maps bare seed locale %s into full-tag WAITRON_TILL_LOCALE and renders it into the .env text",
    (seedLocale, expectedTillLocale) => {
      const env = buildDevEnv({
        databaseUrl: "postgres://postgres:pg@localhost:5432/postgres",
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

// Real Postgres, not PGlite: dev-setup migrates + provisions as the container superuser and its
// whole point is that the reused/fresh decision is right against a persisted database — PGlite's
// per-connection superuser can't stand in for that. Requires TESTCONTAINERS_RYUK_DISABLED=true
// locally (CLAUDE.md §4) or the container hooks hang to the 180s timeout.
describe("devSetup against real Postgres", () => {
  // A BARE container (no-op migrate): devSetup runs the migrations itself, exactly as a fresh dev DB.
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "dev-setup provisions and reuses a venue against a real Postgres as the container " +
          "superuser; PGlite's per-connection superuser cannot exercise the persisted decision.",
        migrate: async () => {
          /* devSetup applies the full manifest itself — a bare container is the fresh-DB shape. */
        },
      }),
    timeoutMs: 180_000,
  });

  let envDir: string;
  let envPath: string;
  let mediaDir: string;
  let first: DevSetupResult;
  const priorMediaDir = process.env.WAITRON_MEDIA_DIR;

  beforeAll(async () => {
    envDir = await mkdtemp(join(tmpdir(), "waitron-dev-setup-"));
    envPath = join(envDir, ".env");
    // devSetup now seeds media through the whole demo restaurant, resolving `WAITRON_MEDIA_DIR ||
    // DEFAULT_MEDIA_ROOT`. Point it at a throwaway dir so the seed never writes PNGs into the repo's
    // source tree (apps/server/src/media, the from-source DEFAULT_MEDIA_ROOT).
    mediaDir = await mkdtemp(join(tmpdir(), "waitron-dev-setup-media-"));
    process.env.WAITRON_MEDIA_DIR = mediaDir;
    // The FIRST run: a fresh database with no `.env` — provisions.
    first = await devSetup({ databaseUrl: suite.pg.uri, envPath, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (priorMediaDir === undefined) delete process.env.WAITRON_MEDIA_DIR;
    else process.env.WAITRON_MEDIA_DIR = priorMediaDir;
    if (envDir !== undefined) await rm(envDir, { recursive: true, force: true });
    if (mediaDir !== undefined) await rm(mediaDir, { recursive: true, force: true });
  });

  async function tillsCount(): Promise<number> {
    // Count every till through the container owner connection.
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from tills`,
    );
    return rows[0]!.n;
  }

  it("provisions a fresh database, writing a .env and exactly one tills row", async () => {
    expect(first.reused).toBe(false);
    expect(await tillsCount()).toBe(1);

    // The five fiscal ids are real uuids and the file on disk matches the returned env.
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    expect(written).toEqual({ ...first.env });
    for (const key of [
      "WAITRON_TILL_TENANT_ID",
      "WAITRON_TILL_TILL_ID",
      "WAITRON_TILL_NODE_ID",
      "WAITRON_TILL_SERIES_ID",
      "WAITRON_TILL_LOCATION_ID",
    ] as const) {
      expect(first.env[key]).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(first.env.DATABASE_URL).toBe(suite.pg.uri);
    // dev-setup boots pnpm dev with the switcher on (WAITRON_ENV=dev) while the venue still behaves as
    // preproduction — proven by the `config.environment` toBe("preproduction") assertion in the
    // loadConfig `it()` block below (dev-setup writes no deployment stamp at all).
    expect(first.env.WAITRON_ENV).toBe("dev");
    // The demo seeds English by default, and the till boots against it.
    expect(written.WAITRON_TILL_LOCALE).toBe("en-GB");
    expect(first.env.WAITRON_TILL_LOCALE).toBe("en-GB");
  });

  it("writes a .env that loadConfig and loadKeyRing accept as valid server config", () => {
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    // loadConfig resolves the whole server config, including the five WAITRON_TILL_* ids via
    // loadTillConfig — a throw here would be server.config_missing / server.till_config_* (the
    // codes dev-setup's whole purpose is to make impossible). Placeholder roots: loadConfig only
    // uses them as string fallbacks, never stats them.
    const config = loadConfig(
      written,
      "/dev/null/migrations",
      "/dev/null/media",
      "/dev/null/state",
    );
    expect(config.environment).toBe("preproduction");
    expect(config.httpPort).toBe(8080);
    // dev-setup ALWAYS provisions a venue, so `loadConfig` resolves the five ids into `config.till`
    // (never setup mode's `undefined` — which is exactly the state dev-setup exists to make
    // impossible). Assert it is present, then read the fiscal ids off it — the `?.` keeps each
    // assertion honest (an undefined till would fail the `toBe`, not throw) now that `config.till` is
    // optional (slice 1b).
    expect(config.till).toBeDefined();
    expect(config.till?.tenantId).toBe(first.env.WAITRON_TILL_TENANT_ID);
    expect(config.till?.tillId).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(config.till?.seriesId).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(config.till?.locationId).toBe(first.env.WAITRON_TILL_LOCATION_ID);
    // The generated credentials key is a valid 32-byte base64 ring.
    const ring = loadKeyRing(written);
    expect(ring.current.key).toHaveLength(32);
    expect(ring.current.version).toBe(1);
  });

  it("reuses an already-provisioned venue rather than minting a second chain", async () => {
    const second = await devSetup({ databaseUrl: suite.pg.uri, envPath, log: () => {} });

    expect(second.reused).toBe(true);
    // The fiscal assertion: no second till (no second SIF, no second chain).
    expect(await tillsCount()).toBe(1);
    // Same identity handed back, read from the untouched `.env`.
    expect(second.env.WAITRON_TILL_TENANT_ID).toBe(first.env.WAITRON_TILL_TENANT_ID);
    expect(second.env.WAITRON_TILL_TILL_ID).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(second.env.WAITRON_TILL_NODE_ID).toBe(first.env.WAITRON_TILL_NODE_ID);
    expect(second.env.WAITRON_TILL_SERIES_ID).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(second.env.WAITRON_TILL_LOCATION_ID).toBe(first.env.WAITRON_TILL_LOCATION_ID);
  });

  it("does not mint a pairing code — the fixed dev code enrols the till — but provisioning seeds the starter profiles", async () => {
    // The en-GB demo gets localized starter profiles, with default capabilities and no canvas binding.
    const { rows: profiles } = await suite.admin.execute<{
      name: string;
      canvas_id: string | null;
      capabilities: string[];
    }>(
      sql`select name, canvas_id, capabilities from device_profiles
          where tenant_id = ${first.env.WAITRON_TILL_TENANT_ID} order by name`,
    );
    expect(profiles).toEqual([
      {
        name: "Counter",
        canvas_id: null,
        capabilities: ["integrated-card-payment", "open-cash-drawer"],
      },
      { name: "Handheld", canvas_id: null, capabilities: [] },
      { name: "Kitchen", canvas_id: null, capabilities: ["act-as-kds"] },
    ]);
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from device_pairing_codes
          where tenant_id = ${first.env.WAITRON_TILL_TENANT_ID}`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("refuses to provision a second venue when the .env no longer names the DB's venue", async () => {
    // The dangerous case: a `.env` lost/deleted (or its ids gone stale) against a live volume that
    // still holds a venue. Provisioning fresh here would mint a SECOND SIF and a second hash chain
    // (CLAUDE.md §5), so devSetup must REFUSE rather than provision — the volume wipe (dev:reset) is
    // the only sanctioned way to start over.
    rmSync(envPath);
    await expect(devSetup({ databaseUrl: suite.pg.uri, envPath, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    // The fiscal assertion: still exactly one till, no second chain.
    expect(await tillsCount()).toBe(1);
  });
});

// Real Postgres enforces SELECT privileges; PGlite's superuser cannot test refusal.
describe("inspectVenues reads existing venues with ordinary SELECT rights", () => {
  const suite = useTemplateDb({ template: "manifest" });

  it("finds the expected tenant and refuses to overlook a different existing tenant", async () => {
    const tenantId = "11111111-2222-3333-4444-555555555555";
    await suite.admin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name)
      values (${tenantId}, 'ES', '00000000T', 'Inspection SL')`);
    const readerUri = roleUrl(suite.pg.uri, "app_login", "app_pw");
    await expect(inspectVenues(readerUri, tenantId)).resolves.toEqual({
      hasExpected: true,
      hasAny: true,
    });
    await expect(inspectVenues(readerUri, null)).resolves.toEqual({
      hasExpected: false,
      hasAny: true,
    });
  });

  it("propagates permission denied instead of reporting an empty database", async () => {
    await suite.admin.execute(sql`create role venue_inspection_denied login password 'denied'`);
    const uri = roleUrl(suite.pg.uri, "venue_inspection_denied", "denied");
    await expect(inspectVenues(uri, null)).rejects.toMatchObject({ code: "42501" });
  });
});
