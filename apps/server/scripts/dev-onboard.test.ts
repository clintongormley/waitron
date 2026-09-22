// A real venue DIRECTORY under `os.tmpdir()`: exercises onboarding against the two SQLite files the
// product opens, which is what a laptop gets.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openVenueDatabase, tenants } from "@waitron/db";
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
  WAITRON_VENUE_DIR: "/var/lib/waitron/venue",
  WAITRON_ENV: "dev",
  WAITRON_HTTP_PORT: "8080",
};

describe("renderSetupEnvFile", () => {
  it("emits exactly the three setup keys in order, and NONE of the trading-only keys", () => {
    const text = renderSetupEnvFile(sampleSetupEnv);
    const lines = text.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines).toEqual([
      "WAITRON_VENUE_DIR=/var/lib/waitron/venue",
      "WAITRON_ENV=dev",
      "WAITRON_HTTP_PORT=8080",
    ]);
    // The load-bearing setup-mode property: the file writes NEITHER the four WAITRON_TILL_*_ID (whose
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

// A real venue directory exercises dev-onboard's actual migration and inspection.
describe("devOnboard against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let envPath: string;
  let first: DevOnboardResult;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-onboard-"));
    venueDir = join(workDir, "venue");
    envPath = join(workDir, ".env");
    // The FIRST run: a virgin directory with no venue — migrates + writes a setup-mode .env.
    first = await devOnboard({ venueDir, envPath, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** Open the venue directory the written `.env` names, run `body`, then close both files — the
   * suite calls `devOnboard` again between assertions and a handle left open is a second writer. */
  async function inVenue<T>(
    body: (db: Awaited<ReturnType<typeof openVenueDatabase>>["venue"]) => Promise<T>,
  ): Promise<T> {
    const store = await openVenueDatabase(first.env.WAITRON_VENUE_DIR);
    try {
      return await body(store.venue);
    } finally {
      await store.close();
    }
  }

  async function tenantsCount(): Promise<number> {
    // Count every tenant in the venue file, the exact fact inspectVenues keys the refuse decision on.
    return inVenue(async (db) => {
      const { rows } = await db.execute<{ n: number }>(sql`select count(*) as n from tenants`);
      return rows[0]!.n;
    });
  }

  it("migrates a virgin directory and writes a venue-less .env, provisioning no venue", async () => {
    // Migrations ran — the tenants table exists to be counted — AND no venue was provisioned.
    expect(await tenantsCount()).toBe(0);

    // The file on disk is the three-key setup env, matching the returned env exactly.
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    expect(written).toEqual({ ...first.env });
    expect(written).toEqual({
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_ENV: "dev",
      WAITRON_HTTP_PORT: "8080",
    });
    // No trading-only keys leaked into the file (the boot-mode selector — see the render test above).
    expect(Object.keys(written)).not.toContain("WAITRON_CREDENTIALS_KEY");
    expect(Object.keys(written).some((k) => k.startsWith("WAITRON_TILL_"))).toBe(false);
  });

  it("migrates the venue file the written .env names, not somewhere else", async () => {
    // The regression this catches is a run that migrates one directory and writes another: the
    // server would open a virgin database and refuse at boot. Ask the venue file the `.env` names
    // for a table only the migrations create.
    const present = await inVenue(async (db) => {
      const { rows } = await db.execute<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' and name = ${"tenants"}`,
      );
      return rows.length;
    });
    expect(present).toBe(1);
  });

  it("writes a .env that loadConfig accepts as a SETUP-MODE config (config.till undefined)", () => {
    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    // loadConfig resolves the whole server config. Placeholder roots: loadConfig only uses them as
    // string fallbacks, never stats them (same as dev-setup.test.ts).
    const config = loadConfig(written, "/dev/null/migrations", "/dev/null/state");
    expect(config.environment).toBe("preproduction");
    expect(config.devMode).toBe(true);
    expect(config.httpPort).toBe(8080);
    // The venue directory the `.env` names is the one the server will open.
    expect(config.venueDir).toBe(venueDir);
    // The property that makes this SETUP mode: no venue is bound, so `tryLoadTillConfig`
    // returns undefined and boot.ts takes its setup branch. dev-setup's .env resolves config.till to
    // the four ids (trading mode); dev-onboard's must NOT — that is the whole point of this script.
    expect(config.till).toBeUndefined();
  });

  it("refuses to touch a venue directory that already holds a venue", async () => {
    // Insert a bare tenant through the table definition, the exact condition inspectVenues keys on
    // (`exists(select 1 from tenants)`). A provisioned venue is a TRADING target, never a setup one,
    // so dev-onboard must REFUSE rather than migrate/overwrite: turning a box that holds a fiscal
    // chain into a setup box is precisely what CLAUDE.md §5 forbids. Runs LAST so the fresh-directory
    // assertions above saw the venue-less state.
    await inVenue(async (db) => {
      await db
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "00000000T", legalName: "Onboard Refuse SL" });
    });
    await expect(devOnboard({ venueDir, envPath, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    // Still exactly the one tenant — the refusal touched nothing.
    expect(await tenantsCount()).toBe(1);
  });
});
