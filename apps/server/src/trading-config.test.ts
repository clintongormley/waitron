import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { writeTradingEnv, type TradingConfig } from "./trading-config.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
const newDir = async () => {
  const d = await mkdtemp(join(tmpdir(), "tradingconfig-"));
  dirs.push(d);
  return d;
};

const cfg: TradingConfig = {
  tenantId: "tenant-1",
  tillId: "till-2",
  nodeId: "node-3",
  seriesId: "series-4",
  locationId: "location-5",
  databaseUrl: "postgres://app@localhost/waitron",
  migrationsDatabaseUrl: "postgres://mig@localhost/waitron",
  syncDatabaseUrl: "postgres://sync@localhost/waitron",
  environment: "production",
};

describe("writeTradingEnv", () => {
  it("returns the <stateDir>/trading.env path it wrote", async () => {
    const d = await newDir();
    const path = await writeTradingEnv(d, cfg);
    expect(path).toBe(join(d, "trading.env"));
  });

  it("writes all 9 KEY=value lines with the exact env names, LF-terminated", async () => {
    const d = await newDir();
    // Exact-equality on the whole file is the strongest check: it pins the nine names, their
    // values, the order the supervisor sources them in, and the trailing LF, all at once. The five
    // WAITRON_TILL_*_ID + DATABASE_URL(+migrations, +sync) + WAITRON_ENV are what the next boot reads
    // to enter TRADING mode — WAITRON_SYNC_DATABASE_URL is the mirror's own sync pool the next boot's
    // `loadMirrorSyncConfig` reads back (without it an adopted mirror never boots into mirror mode).
    const env = await readFile(await writeTradingEnv(d, cfg), "utf8");
    expect(env).toBe(
      "WAITRON_TILL_TENANT_ID=tenant-1\n" +
        "WAITRON_TILL_TILL_ID=till-2\n" +
        "WAITRON_TILL_NODE_ID=node-3\n" +
        "WAITRON_TILL_SERIES_ID=series-4\n" +
        "WAITRON_TILL_LOCATION_ID=location-5\n" +
        "DATABASE_URL=postgres://app@localhost/waitron\n" +
        "WAITRON_MIGRATIONS_DATABASE_URL=postgres://mig@localhost/waitron\n" +
        "WAITRON_SYNC_DATABASE_URL=postgres://sync@localhost/waitron\n" +
        "WAITRON_ENV=production\n",
    );
  });

  it("omits WAITRON_SYNC_DATABASE_URL entirely when syncDatabaseUrl is undefined (the primary provision path)", async () => {
    const d = await newDir();
    // A provisioned PRIMARY has no sync peers yet, so its writer leaves syncDatabaseUrl undefined —
    // and `writeTradingEnv` must then emit NO `WAITRON_SYNC_DATABASE_URL` line at all, not a blank
    // `WAITRON_SYNC_DATABASE_URL=` that a later `loadSyncConfig` would read as missing (CLAUDE.md §3).
    // Exact-equality on the whole file proves the line is absent, not merely empty. The MIRROR case
    // (present) is the 9-line test above; only the ADOPT path supplies it.
    const primaryCfg: TradingConfig = { ...cfg };
    delete primaryCfg.syncDatabaseUrl;
    const env = await readFile(await writeTradingEnv(d, primaryCfg), "utf8");
    expect(env).toBe(
      "WAITRON_TILL_TENANT_ID=tenant-1\n" +
        "WAITRON_TILL_TILL_ID=till-2\n" +
        "WAITRON_TILL_NODE_ID=node-3\n" +
        "WAITRON_TILL_SERIES_ID=series-4\n" +
        "WAITRON_TILL_LOCATION_ID=location-5\n" +
        "DATABASE_URL=postgres://app@localhost/waitron\n" +
        "WAITRON_MIGRATIONS_DATABASE_URL=postgres://mig@localhost/waitron\n" +
        "WAITRON_ENV=production\n",
    );
    expect(env).not.toContain("WAITRON_SYNC_DATABASE_URL");
  });

  it("writes the file 0600 (owner-only)", async () => {
    const d = await newDir();
    await writeTradingEnv(d, cfg);
    // 0o600 is not masked by any sane umask (022/002/077 leave the owner bits alone), so assert it
    // exactly — same guarantee as secrets.env, the sibling this file lives beside.
    const mode = (await stat(join(d, "trading.env"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("leaves no *.tmp behind (temp-then-rename completed)", async () => {
    const d = await newDir();
    await writeTradingEnv(d, cfg);
    // A lingering trading.env.tmp would mean the rename was skipped — i.e. a reader could observe a
    // torn file, which is the whole point of the atomic write. A successful run leaves only the file.
    const names = await readdir(d);
    expect(names).toEqual(["trading.env"]);
  });
});
