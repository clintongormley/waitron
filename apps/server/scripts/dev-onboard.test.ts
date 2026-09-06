// Real PostgreSQL: exercises onboarding through a PostgreSQL URL that opens its own connections.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { startMigratedPostgres } from "@waitron/db/testing/postgres.js";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { parseEnvFile } from "./dev-setup.js";
import {
  devOnboard,
  renderSetupEnvFile,
  type DevOnboardResult,
  type SetupEnv,
} from "./dev-onboard.js";

const sampleSetupEnv: SetupEnv = {
  DATABASE_URL: "postgres://postgres:pg@localhost:5432/postgres",
  WAITRON_ENV: "preproduction",
  WAITRON_HTTP_PORT: "8080",
};

describe("renderSetupEnvFile", () => {
  it("emits exactly the three setup keys in order, and NONE of the trading-only keys", () => {
    const text = renderSetupEnvFile(sampleSetupEnv);
    const lines = text.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines).toEqual([
      "DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres",
      "WAITRON_ENV=preproduction",
      "WAITRON_HTTP_PORT=8080",
    ]);
    // The load-bearing setup-mode property: the file writes NEITHER the five WAITRON_TILL_*_ID (whose
    // absence is what makes boot.ts choose setup mode, config.till === undefined) NOR the credentials
    // key (setup mode loads no key ring). A stray one here would silently push the box into trading
    // mode or a half-configured boot (CLAUDE.md §5, slice 1b).
    expect(text).not.toMatch(/WAITRON_TILL_/);
    expect(text).not.toMatch(/WAITRON_CREDENTIALS_KEY/);
  });

  it("round-trips exactly through parseEnvFile", () => {
    // toEqual, not toMatchObject: a stray or dropped key must fail (CLAUDE.md §4).
    expect(parseEnvFile(renderSetupEnvFile(sampleSetupEnv))).toEqual({ ...sampleSetupEnv });
  });
});

// Real Postgres exercises dev-onboard's actual migration and inspection connections.
// TESTCONTAINERS_RYUK_DISABLED=true is required locally (CLAUDE.md §4).
describe("devOnboard against real Postgres", () => {
  // A BARE container (no-op migrate): devOnboard runs the migrations itself, exactly as a fresh dev DB.
  const suite = useRealPostgres({
    start: () =>
      startMigratedPostgres({
        dockerRequired:
          "dev-onboard requires Postgres for its migration and venue-inspection integration test.",
        migrate: async () => {
          /* devOnboard applies the full manifest itself — a bare container is the fresh-DB shape. */
        },
      }),
    timeoutMs: 180_000,
  });

  let envDir: string;
  let envPath: string;
  let first: DevOnboardResult;

  beforeAll(async () => {
    envDir = await mkdtemp(join(tmpdir(), "waitron-dev-onboard-"));
    envPath = join(envDir, ".env");
    // The FIRST run: a fresh database with no venue — migrates + writes a setup-mode .env.
    first = await devOnboard({ databaseUrl: suite.pg.uri, envPath, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (envDir !== undefined) await rm(envDir, { recursive: true, force: true });
  });

  async function tenantsCount(): Promise<number> {
    // Count every tenant through the container owner connection, the exact fact
    // inspectVenues keys the refuse decision on.
    const { rows } = await suite.admin.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    return rows[0]!.n;
  }

  it("migrates a fresh database and writes a venue-less .env, provisioning no venue", async () => {
    // Migrations ran — the tenants table exists to be counted — AND no venue was provisioned.
    expect(await tenantsCount()).toBe(0);

    // The file on disk is the three-key setup env, matching the returned env exactly.
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    expect(written).toEqual({ ...first.env });
    expect(written).toEqual({
      DATABASE_URL: suite.pg.uri,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_PORT: "8080",
    });
    // No trading-only keys leaked into the file (the boot-mode selector — see the render test above).
    expect(Object.keys(written)).not.toContain("WAITRON_CREDENTIALS_KEY");
    expect(Object.keys(written).some((k) => k.startsWith("WAITRON_TILL_"))).toBe(false);
  });

  it("writes a .env that loadConfig accepts as a SETUP-MODE config (config.till undefined)", () => {
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    // loadConfig resolves the whole server config. Placeholder roots: loadConfig only uses them as
    // string fallbacks, never stats them (same as dev-setup.test.ts).
    const config = loadConfig(
      written,
      "/dev/null/migrations",
      "/dev/null/media",
      "/dev/null/state",
    );
    expect(config.environment).toBe("preproduction");
    expect(config.httpPort).toBe(8080);
    // The load-bearing property that makes this SETUP mode: no venue is bound, so `tryLoadTillConfig`
    // returns undefined and boot.ts takes its setup branch. dev-setup's .env resolves config.till to
    // the five ids (trading mode); dev-onboard's must NOT — that is the whole point of this script.
    expect(config.till).toBeUndefined();
  });

  it("refuses to touch a database that already holds a venue", async () => {
    // Insert a bare tenant through the container owner connection, the exact condition
    // inspectVenues keys on (`exists(select 1 from tenants)`). A provisioned database is a TRADING
    // target, never a setup one, so dev-onboard must REFUSE rather than migrate/overwrite: turning a
    // box that holds a fiscal chain into a setup box is precisely what CLAUDE.md §5 forbids. Runs
    // LAST so the fresh-DB assertions above saw the venue-less state.
    await suite.admin.execute(
      sql`insert into tenants (country, tax_id, legal_name) values ('ES', '00000000T', 'Onboard Refuse SL')`,
    );
    await expect(devOnboard({ databaseUrl: suite.pg.uri, envPath, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    // Still exactly the one tenant — the refusal touched nothing.
    expect(await tenantsCount()).toBe(1);
  });
});
