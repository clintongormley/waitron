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
  environment: "production",
};

describe("writeTradingEnv", () => {
  it("returns the <stateDir>/trading.env path it wrote", async () => {
    const d = await newDir();
    const path = await writeTradingEnv(d, cfg);
    expect(path).toBe(join(d, "trading.env"));
  });

  it("writes all 8 KEY=value lines with the exact env names, LF-terminated", async () => {
    const d = await newDir();
    // Exact-equality on the whole file is the strongest check: it pins the eight names, their
    // values, the order the supervisor sources them in, and the trailing LF, all at once. The five
    // WAITRON_TILL_*_ID + DATABASE_URL(+migrations) + WAITRON_ENV are what the next boot reads to
    // enter TRADING mode.
    const env = await readFile(await writeTradingEnv(d, cfg), "utf8");
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
