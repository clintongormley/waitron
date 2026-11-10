import { mkdtemp, readFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { clearTradingEnv, writeTradingEnv, type TradingConfig } from "./trading-config.js";

const { flushEvents } = vi.hoisted(() => ({ flushEvents: [] as string[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        flushEvents.push(`sync ${String(args[0])}`);
        await sync();
      };
      return handle;
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      flushEvents.push(`rename ${String(args[1])}`);
      await actual.rename(...args);
    },
  };
});

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
  nodeId: "node-3",
  environment: "production",
  onboardingIntent: "live",
  accountKey: Buffer.alloc(32, 8).toString("base64"),
};

describe("writeTradingEnv", () => {
  it("trading.env is flushed before it is renamed into place", async () => {
    const dir = await newDir();
    flushEvents.length = 0;
    await writeTradingEnv(dir, cfg);
    expect(flushEvents).toEqual([
      `sync ${join(dir, "trading.env.tmp")}`,
      `rename ${join(dir, "trading.env")}`,
      `sync ${dir}`,
    ]);
    expect(await readFile(join(dir, "trading.env"), "utf8")).toContain("WAITRON_NODE_ID=node-3\n");
  });

  it("persists node without a cached invoice series", async () => {
    const env = await readFile(await writeTradingEnv(await newDir(), cfg), "utf8");
    expect(env).not.toContain("WAITRON_TILL_SERIES_ID");
    expect(env).toContain("WAITRON_NODE_ID=node-3\n");
    expect(env).not.toContain(["WAITRON", "LOCATION", "ID"].join("_"));
  });

  it("returns the <stateDir>/trading.env path it wrote", async () => {
    const d = await newDir();
    const path = await writeTradingEnv(d, cfg);
    expect(path).toBe(join(d, "trading.env"));
  });

  it("writes the onboarding intent separately from the fiscal environment", async () => {
    const d = await newDir();
    // Exact equality pins the names, values, order and trailing LF, and that no database is named:
    // the venue directory is derived from the state root, not handed forward by setup.
    const env = await readFile(await writeTradingEnv(d, cfg), "utf8");
    expect(env).toBe(
      "WAITRON_NODE_ID=node-3\n" +
        "WAITRON_ENV=production\n" +
        "WAITRON_ONBOARDING_INTENT=live\n" +
        "WAITRON_ACCOUNT_KEY=" +
        Buffer.alloc(32, 8).toString("base64") +
        "\n",
    );
  });

  it("omits the intent for joined or recovered configurations", async () => {
    const d = await newDir();
    const env = await readFile(
      await writeTradingEnv(d, { ...cfg, onboardingIntent: undefined }),
      "utf8",
    );
    expect(env).not.toContain("WAITRON_ONBOARDING_INTENT");
  });

  it("writes no account key for a configuration that carries none", async () => {
    const d = await newDir();
    const env = await readFile(await writeTradingEnv(d, { ...cfg, accountKey: undefined }), "utf8");
    expect(env).toBe(
      "WAITRON_NODE_ID=node-3\n" + "WAITRON_ENV=production\n" + "WAITRON_ONBOARDING_INTENT=live\n",
    );
  });

  it("keeps a development Live walkthrough on WAITRON_ENV=dev after restart", async () => {
    const d = await newDir();
    const env = await readFile(
      await writeTradingEnv(d, { ...cfg, environment: "preproduction", developmentMode: true }),
      "utf8",
    );
    expect(env).toContain("WAITRON_ENV=dev\n");
    expect(env).toContain("WAITRON_ONBOARDING_INTENT=live\n");
  });

  it("writes the file 0600 (owner-only)", async () => {
    const d = await newDir();
    await writeTradingEnv(d, cfg);
    // No common umask masks owner bits, so assert 0o600 exactly.
    const mode = (await stat(join(d, "trading.env"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("leaves no *.tmp behind (temp-then-rename completed)", async () => {
    const d = await newDir();
    await writeTradingEnv(d, cfg);
    // A lingering trading.env.tmp would mean the rename was skipped.
    const names = await readdir(d);
    expect(names).toEqual(["trading.env"]);
  });
});

describe("clearTradingEnv", () => {
  it("removes an existing trading.env so the box reboots into SETUP mode", async () => {
    const d = await newDir();
    await writeTradingEnv(d, cfg);
    await clearTradingEnv(d);
    expect(await readdir(d)).toEqual([]);
  });

  it("is a no-op when there is no trading.env (idempotent)", async () => {
    const d = await newDir();
    await clearTradingEnv(d); // must not throw on an absent file
    expect(await readdir(d)).toEqual([]);
  });
});
