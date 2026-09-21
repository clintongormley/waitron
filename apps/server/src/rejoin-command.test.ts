import { mkdtempSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { openVenueDatabase, type Database } from "@waitron/db";
import { describe, expect, it, vi } from "vitest";
import type { RejoinDeps, RejoinResult } from "./rejoin.js";
import { runRejoin } from "./rejoin-command.js";

// The venue directory the wipe empties and the re-migrate rebuilds. Named explicitly here rather
// than left to the `<stateDir>/venue` default, so a case that asserts on the directory is asserting
// on a path this file chose.
const STATE_DIR = mkdtempSync(join(tmpdir(), "rejoin-cmd-"));
const VENUE_DIR = join(STATE_DIR, "venue");

const TILL = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const SERIES = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";

const base: Record<string, string | undefined> = {
  WAITRON_STATE_DIR: STATE_DIR,
  WAITRON_VENUE_DIR: VENUE_DIR,
  WAITRON_TILL_TILL_ID: TILL,
  WAITRON_TILL_NODE_ID: NODE,
  WAITRON_TILL_SERIES_ID: SERIES,
  WAITRON_TILL_LOCATION_ID: LOCATION,
};

type OpenedVenue = { db: Database; close(): Promise<void> };

// A minimal fake venue handle: `readNodeMembership` asks the catalogue whether `node_membership`
// exists and only then reads the value. Returning NO rows is the catalogue's answer for a table that
// is not there, which is this suite's common path — no held document — and it is also why the fake
// needs no query builder: the value read is never reached. `close` is a spy so the close can be
// asserted.
function fakeVenue(execute?: Database["execute"]): OpenedVenue {
  return {
    db: { execute: execute ?? (vi.fn(async () => ({ rows: [] })) as never) } as unknown as Database,
    close: vi.fn(async () => {}),
  };
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
    openDb?: (directory: string) => Promise<OpenedVenue>;
    migrate?: (venueDir: string) => Promise<void>;
  } = {},
): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await runRejoin({
    argv: opts.argv ?? ["rejoin"],
    env: { ...base, ...over },
    out: (l) => out.push(l),
    rejoin: opts.rejoin ?? HAPPY_REJOIN,
    openDb: opts.openDb ?? (async () => fakeVenue()),
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

  it("takes <stateDir>/venue when WAITRON_VENUE_DIR is EMPTY, never the working directory", async () => {
    const opened: string[] = [];
    const { code } = await run(
      { WAITRON_VENUE_DIR: "" },
      {
        // Its own stub rather than the shared one: `clearMocks` is off in this package's config,
        // so a case that leaned on `HAPPY_REJOIN` would add to the call count another case asserts.
        rejoin: async () => ({ wiped: true as const, carrierNodeId: "carrier-x" }),
        openDb: async (directory) => {
          opened.push(directory);
          return fakeVenue();
        },
      },
    );
    expect(code).toBe(0);
    expect(opened).toEqual([join(STATE_DIR, "venue")]);
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
    expect(out.join("\n")).toContain(`wiped ${VENUE_DIR}`);
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

  // The real closure against a REAL venue directory, not a fake: the whole of what `wipeDatabase`
  // does is filesystem work, so a mock standing in for it would assert that this function calls
  // something rather than that the box is wiped.
  it("drives the real wipe closure: both database files go, then the directory is re-migrated and trading.env cleared", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "rejoin-live-"));
    const venueDir = join(stateDir, "venue");
    try {
      const live = await openVenueDatabase(venueDir);
      live.venue.run(sql`create table venue_marker (v text)`);
      live.node.run(sql`create table node_marker (v text)`);
      await live.close();
      await writeFile(join(stateDir, "trading.env"), "WAITRON_TILL_NODE_ID=old\n");

      const migrated: string[] = [];
      const rejoin = async (d: RejoinDeps): Promise<RejoinResult> => {
        await d.closePreWipe();
        await d.wipeDatabase();
        return { wiped: true as const, carrierNodeId: "carrier-result" };
      };
      const { code } = await run(
        { WAITRON_STATE_DIR: stateDir, WAITRON_VENUE_DIR: venueDir },
        {
          openDb: async () => fakeVenue(),
          migrate: async (directory) => {
            migrated.push(directory);
          },
          rejoin,
        },
      );

      expect(code).toBe(0);
      // Both files and both sets of sidecars are gone — the venue's tables AND this node's own
      // `local` ones, which is what `DROP DATABASE` took when the two lived in one database.
      for (const name of ["venue.db", "venue.db-wal", "venue.db-shm", "node.db", "node.db-wal"]) {
        await expect(stat(join(venueDir, name))).rejects.toMatchObject({ code: "ENOENT" });
      }
      // The re-migrate targets the directory just emptied, and the next boot is setup mode.
      expect(migrated).toEqual([venueDir]);
      await expect(stat(join(stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
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

  it("never echoes a raw error's .message — a box operator has no terminal to read around it", async () => {
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

  it("closes the pre-wipe handle when a guard rejects (no open file left behind)", async () => {
    const opened: OpenedVenue[] = [];
    const openDb = async (): Promise<OpenedVenue> => {
      const venue = fakeVenue();
      opened.push(venue);
      return venue;
    };
    const { code } = await run(
      {},
      {
        openDb,
        rejoin: async () => {
          throw new AppError("rejoin.not_fenced", {});
        },
      },
    );
    expect(code).toBe(1);
    expect(opened).toHaveLength(1);
    for (const venue of opened) expect(venue.close).toHaveBeenCalledTimes(1);
  });

  it("reports generically (never raw) when opening the venue fails", async () => {
    const { code, out } = await run(
      {},
      {
        openDb: async (directory) => {
          throw new Error(`unable to open database file ${join(directory, "venue.db")}`);
        },
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed"]);
    expect(out.join("\n")).not.toContain("unable to open database file");
  });

  it("reports generically and closes the handle when the membership read fails", async () => {
    const close = vi.fn(async () => {});
    const throwingRead = vi.fn(async () => {
      throw new Error("relation node_membership read failed");
    }) as unknown as Database["execute"];
    const { code, out } = await run(
      {},
      {
        openDb: async () => ({ db: { execute: throwingRead } as unknown as Database, close }),
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed"]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
