import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { describe, expect, it, vi } from "vitest";
import type { RejoinDeps, RejoinResult } from "./rejoin.js";
import { runRejoin } from "./rejoin-command.js";

// The maintenance URL names a DIFFERENT db on the same server (the wipe cannot drop the db it is
// connected to); `DATABASE_URL`'s path names the target the wipe recreates.
const APP_URL = "postgres://app@localhost/app_db";
const MAINTENANCE_URL = "postgres://admin:hunter2@localhost/postgres";
const STATE_DIR = mkdtempSync(join(tmpdir(), "rejoin-cmd-"));

const TILL = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const SERIES = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";

const base: Record<string, string | undefined> = {
  DATABASE_URL: APP_URL,
  WAITRON_MAINTENANCE_DATABASE_URL: MAINTENANCE_URL,
  WAITRON_STATE_DIR: STATE_DIR,
  WAITRON_TILL_TILL_ID: TILL,
  WAITRON_TILL_NODE_ID: NODE,
  WAITRON_TILL_SERIES_ID: SERIES,
  WAITRON_TILL_LOCATION_ID: LOCATION,
};

// A minimal fake `Database`: `readNodeMembership` asks the catalogue whether `node_membership`
// exists and only then reads the value. Returning NO rows is the catalogue's answer for a table that
// is not there, which is this suite's common path — no held document — and it is also why the fake
// needs no query builder: the value read is never reached. `close` is a spy so the close can be
// asserted.
function fakeDb(execute?: Database["execute"]): Database {
  return {
    execute: execute ?? (vi.fn(async () => ({ rows: [] })) as never),
    close: vi.fn(async () => {}),
  } as unknown as Database;
}

const HAPPY_REJOIN = vi.fn(async (): Promise<RejoinResult> => ({
  wiped: true as const,
  carrierNodeId: "carrier-result",
}));

async function run(
  over: Record<string, string | undefined>,
  opts: {
    argv?: string[];
    rejoin?: (d: RejoinDeps) => Promise<RejoinResult>;
    connect?: (url: string) => Promise<Database>;
    migrate?: (connectionString: string) => Promise<void>;
  } = {},
): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await runRejoin({
    argv: opts.argv ?? ["rejoin"],
    env: { ...base, ...over },
    out: (l) => out.push(l),
    rejoin: opts.rejoin ?? HAPPY_REJOIN,
    connect: opts.connect ?? (async () => fakeDb()),
    migrate: opts.migrate ?? (async () => {}),
  });
  return { code, out };
}

describe("waitron-rejoin rejoin", () => {
  it("returns 2 and prints usage without the subcommand", async () => {
    const { code, out } = await run({}, { argv: [] });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("returns 2 and prints usage when an unexpected positional (an artifact path) is given", async () => {
    const { code, out } = await run({}, { argv: ["rejoin", "/some/artifact"] });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("refuses an empty DATABASE_URL (fail closed)", async () => {
    const { code, out } = await run({ DATABASE_URL: "" });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/DATABASE_URL/)]);
  });

  it("refuses an empty WAITRON_MAINTENANCE_DATABASE_URL (fail closed)", async () => {
    const { code, out } = await run({ WAITRON_MAINTENANCE_DATABASE_URL: "" });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_MAINTENANCE_DATABASE_URL/)]);
  });

  it("refuses (fail closed) when DATABASE_URL cannot be parsed as a standard URL", async () => {
    const connect = vi.fn(async () => fakeDb());
    const { code, out } = await run({ DATABASE_URL: "not a url" }, { connect });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/DATABASE_URL must be a standard libpq URL/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses when the WAITRON_TILL_*_ID are absent (unprovisioned box)", async () => {
    const { code, out } = await run({
      WAITRON_TILL_TILL_ID: undefined,
      WAITRON_TILL_NODE_ID: undefined,
      WAITRON_TILL_SERIES_ID: undefined,
      WAITRON_TILL_LOCATION_ID: undefined,
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/WAITRON_TILL/);
  });

  it("reports a partial till config by code (server.config_invalid) and returns 1", async () => {
    const { code, out } = await run({ WAITRON_TILL_NODE_ID: undefined });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("server.config_invalid");
  });

  it("returns 1 (never rejects raw) on an invalid WAITRON_ENV", async () => {
    const { code, out } = await run({ WAITRON_ENV: "garbage" });
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("server.config_invalid");
  });

  it("returns 0 and reports the carrier on the happy path", async () => {
    const rejoin = vi.fn(HAPPY_REJOIN);
    const { code, out } = await run({}, { rejoin });
    expect(code).toBe(0);
    expect(rejoin).toHaveBeenCalledOnce();
    expect(out.join("\n")).toMatch(/wiped app_db/);
    expect(out.join("\n")).toContain("carrier-result");
  });

  it("passes acceptLoss:true through when --accept-loss is given", async () => {
    let received: RejoinDeps | undefined;
    const rejoin = async (d: RejoinDeps): Promise<RejoinResult> => {
      received = d;
      return { wiped: true as const, carrierNodeId: "carrier-x" };
    };
    const { code } = await run({}, { argv: ["rejoin", "--accept-loss"], rejoin });
    expect(code).toBe(0);
    expect(received?.acceptLoss).toBe(true);
  });

  it("drives the real wipe closure: drop+create on two handles then re-migrate, leaking no secret", async () => {
    const connected: string[] = [];
    const migrated: string[] = [];
    const rejoin = async (d: RejoinDeps): Promise<RejoinResult> => {
      await d.closePreWipe();
      await d.wipeDatabase();
      return { wiped: true as const, carrierNodeId: "carrier-result" };
    };
    const { code, out } = await run(
      {},
      {
        connect: async (url) => {
          connected.push(url);
          return fakeDb();
        },
        migrate: async (connectionString) => {
          migrated.push(connectionString);
        },
        rejoin,
      },
    );
    expect(code).toBe(0);
    // The wipe opened the migrator-role DROP handle and the plain-admin CREATE handle.
    expect(connected).toContain(MAINTENANCE_URL); // createAs (plain admin, has CREATEDB)
    expect(connected.some((u) => u.includes("options=-c+role%3Dwaitron_migrator"))).toBe(true); // dropAs
    // Re-migration targets the recreated db AS the migrator.
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toContain("app_db");
    expect(migrated[0]).toContain("options=-c+role%3Dwaitron_migrator");
    // No secret leaked to the terminal.
    expect(out.join("\n")).not.toContain("hunter2");
  });

  it("reports a rejoin.* code without echoing a raw message and returns 1", async () => {
    const { code, out } = await run(
      {},
      {
        rejoin: async () => {
          throw new AppError("rejoin.no_carrier", {});
        },
      },
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("rejoin.no_carrier");
  });

  it("reports an out-of-namespace AppError generically, never rethrown", async () => {
    const { code, out } = await run(
      {},
      {
        rejoin: async () => {
          throw new AppError("server.config_invalid", { variable: "x", reason: "nope" });
        },
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed"]);
  });

  it("never echoes a raw error's .message — it can carry the admin password", async () => {
    const leaked = "postgres://admin:S3CR3T-ADMIN-PASSWORD@db-host:5432/fresh";
    const { code, out } = await run(
      {},
      {
        rejoin: async () => {
          throw new Error(`Command failed: migrate --dbname ${leaked} ...`);
        },
      },
    );
    expect(code).toBe(1);
    const printed = out.join("\n");
    expect(printed).not.toContain("S3CR3T-ADMIN-PASSWORD");
    expect(printed).not.toContain(leaked);
    expect(out).toEqual(["rejoin failed"]);
  });

  it("closes the pre-wipe pool when a guard rejects (no connection leak)", async () => {
    const opened: Database[] = [];
    const connect = async (): Promise<Database> => {
      const db = fakeDb();
      opened.push(db);
      return db;
    };
    const { code } = await run(
      {},
      {
        connect,
        rejoin: async () => {
          throw new AppError("rejoin.not_fenced", {});
        },
      },
    );
    expect(code).toBe(1);
    expect(opened).toHaveLength(1); // the app pool alone; the wipe's handles are never opened
    for (const db of opened) expect(db.close).toHaveBeenCalledTimes(1);
  });

  it("reports generically (never raw) when opening the app pool fails", async () => {
    const { code, out } = await run(
      {},
      {
        connect: async (url) => {
          if (url === APP_URL) throw new Error(`connect ECONNREFUSED ${APP_URL}`);
          return fakeDb();
        },
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed"]);
    expect(out.join("\n")).not.toContain("app_db");
  });

  it("reports generically and closes the pool when the membership read fails", async () => {
    const close = vi.fn(async () => {});
    const throwingRead = vi.fn(async () => {
      throw new Error("relation node_membership read failed");
    }) as unknown as Database["execute"];
    const { code, out } = await run(
      {},
      {
        connect: async () => ({ execute: throwingRead, close }) as unknown as Database,
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed"]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
