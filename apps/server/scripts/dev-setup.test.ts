import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { loadKeyRing } from "@waitron/credentials";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import {
  devSetup,
  parseEnvFile,
  renderEnvFile,
  type DevEnv,
  type DevSetupResult,
} from "./dev-setup.js";

const sampleEnv: DevEnv = {
  DATABASE_URL: "postgres://postgres:pg@localhost:5432/postgres",
  WAITRON_ENV: "preproduction",
  WAITRON_HTTP_PORT: "8080",
  WAITRON_CREDENTIALS_KEY: "c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_TILL_TENANT_ID: "11111111-1111-1111-1111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-2222-2222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-3333-3333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-4444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-5555-5555-555555555555",
};

describe("renderEnvFile", () => {
  it("emits every key=value line in the server's env-contract order", () => {
    const lines = renderEnvFile(sampleEnv)
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines).toEqual([
      "DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres",
      "WAITRON_ENV=preproduction",
      "WAITRON_HTTP_PORT=8080",
      "WAITRON_CREDENTIALS_KEY=c2FtcGxlLTMyLWJ5dGUta2V5LWZvci10ZXN0aW5nLW9r",
      "WAITRON_CREDENTIALS_KEY_VERSION=1",
      "WAITRON_TILL_TENANT_ID=11111111-1111-1111-1111-111111111111",
      "WAITRON_TILL_TILL_ID=22222222-2222-2222-2222-222222222222",
      "WAITRON_TILL_NODE_ID=33333333-3333-3333-3333-333333333333",
      "WAITRON_TILL_SERIES_ID=44444444-4444-4444-4444-444444444444",
      "WAITRON_TILL_LOCATION_ID=55555555-5555-5555-5555-555555555555",
    ]);
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
  let first: DevSetupResult;

  beforeAll(async () => {
    envDir = await mkdtemp(join(tmpdir(), "waitron-dev-setup-"));
    envPath = join(envDir, ".env");
    // The FIRST run: a fresh database with no `.env` — provisions.
    first = await devSetup({ databaseUrl: suite.pg.uri, envPath, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (envDir !== undefined) await rm(envDir, { recursive: true, force: true });
  });

  async function tillsCount(): Promise<number> {
    // As the container superuser (RLS bypassed) — a raw count of every till in the database.
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
    expect(first.env.WAITRON_ENV).toBe("preproduction");
  });

  it("writes a .env that loadConfig and loadKeyRing accept as valid server config", () => {
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    // loadConfig resolves the whole server config, including the five WAITRON_TILL_* ids via
    // loadTillConfig — a throw here would be server.config_missing / server.till_config_* (the
    // codes dev-setup's whole purpose is to make impossible). Placeholder roots: loadConfig only
    // uses them as string fallbacks, never stats them.
    const config = loadConfig(written, "/dev/null/migrations", "/dev/null/media");
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
    // The load-bearing fiscal assertion: no second till (no second SIF, no second chain).
    expect(await tillsCount()).toBe(1);
    // Same identity handed back, read from the untouched `.env`.
    expect(second.env.WAITRON_TILL_TENANT_ID).toBe(first.env.WAITRON_TILL_TENANT_ID);
    expect(second.env.WAITRON_TILL_TILL_ID).toBe(first.env.WAITRON_TILL_TILL_ID);
    expect(second.env.WAITRON_TILL_NODE_ID).toBe(first.env.WAITRON_TILL_NODE_ID);
    expect(second.env.WAITRON_TILL_SERIES_ID).toBe(first.env.WAITRON_TILL_SERIES_ID);
    expect(second.env.WAITRON_TILL_LOCATION_ID).toBe(first.env.WAITRON_TILL_LOCATION_ID);
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
    // The load-bearing fiscal assertion: still exactly one till, no second chain.
    expect(await tillsCount()).toBe(1);
  });
});
