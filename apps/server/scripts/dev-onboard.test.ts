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
    // A stray WAITRON_TILL_*_ID would push the box into trading mode.
    expect(text).not.toMatch(/WAITRON_TILL_/);
    expect(text).not.toMatch(/WAITRON_CREDENTIALS_KEY/);
  });

  it("round-trips exactly through parseEnvFile", () => {
    expect(parseEnvFile(renderSetupEnvFile(sampleSetupEnv))).toEqual({ ...sampleSetupEnv });
  });
});

describe("devOnboard against a real venue directory", () => {
  let workDir: string;
  let venueDir: string;
  let envPath: string;
  let first: DevOnboardResult;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-onboard-"));
    venueDir = join(workDir, "venue");
    envPath = join(workDir, ".env");
    first = await devOnboard({ venueDir, envPath, log: () => {} });
  }, 180_000);

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** Closes the store after each read: the suite calls `devOnboard` again between assertions. */
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
    return inVenue(async (db) => {
      const { rows } = await db.execute<{ n: number }>(sql`select count(*) as n from tenants`);
      return rows[0]!.n;
    });
  }

  it("migrates a virgin directory and writes a venue-less .env, provisioning no venue", async () => {
    expect(await tenantsCount()).toBe(0);

    const written = parseEnvFile(readFileSync(envPath, "utf8"));
    expect(written).toEqual({ ...first.env });
    expect(written).toEqual({
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_ENV: "dev",
      WAITRON_HTTP_PORT: "8080",
    });
    expect(Object.keys(written)).not.toContain("WAITRON_CREDENTIALS_KEY");
    expect(Object.keys(written).some((k) => k.startsWith("WAITRON_TILL_"))).toBe(false);
  });

  it("migrates the venue file the written .env names, not somewhere else", async () => {
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
    // Placeholder roots: loadConfig uses them as string fallbacks and never stats them.
    const config = loadConfig(written, "/dev/null/migrations", "/dev/null/state");
    expect(config.environment).toBe("preproduction");
    expect(config.devMode).toBe(true);
    expect(config.httpPort).toBe(8080);
    expect(config.venueDir).toBe(venueDir);
    expect(config.till).toBeUndefined();
  });

  it("refuses to touch a venue directory that already holds a venue", async () => {
    // Runs last, so the assertions above saw the venue-less directory.
    await inVenue(async (db) => {
      await db
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "00000000T", legalName: "Onboard Refuse SL" });
    });
    await expect(devOnboard({ venueDir, envPath, log: () => {} })).rejects.toThrow(
      /already holds a venue/i,
    );
    expect(await tenantsCount()).toBe(1);
  });
});
