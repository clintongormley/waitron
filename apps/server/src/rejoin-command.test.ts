import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { Database } from "@waitron/db";
import type { SignedMembershipDocument } from "@waitron/membership";
import { describe, expect, it, vi } from "vitest";
import type { RejoinDeps, RejoinResult } from "./rejoin.js";
import type { RestoreDeps, ValidatedArtifact } from "./restore.js";
import { runRejoin } from "./rejoin-command.js";

const RECOVERY_KEY = "s3cr3t-recovery-key-value";
// DATABASE_URL and WAITRON_RESTORE_DATABASE_URL name the SAME host+port+database by default (the R3
// target invariant Gap #2 enforces) — differing only in the connecting role, which is not compared.
const RESTORE_URL = "postgres://admin:hunter2@localhost/app_db";
const APP_URL = "postgres://app@localhost/app_db";
const SYNC_URL = "postgres://tailer@localhost/app_db";
const MAINTENANCE_URL = "postgres://admin:hunter2@localhost/postgres";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TILL = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const SERIES = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";

const base: Record<string, string | undefined> = {
  WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
  WAITRON_RESTORE_DATABASE_URL: RESTORE_URL,
  DATABASE_URL: APP_URL,
  WAITRON_SYNC_DATABASE_URL: SYNC_URL,
  WAITRON_MAINTENANCE_DATABASE_URL: MAINTENANCE_URL,
  WAITRON_TILL_TENANT_ID: TENANT,
  WAITRON_TILL_TILL_ID: TILL,
  WAITRON_TILL_NODE_ID: NODE,
  WAITRON_TILL_SERIES_ID: SERIES,
  WAITRON_TILL_LOCATION_ID: LOCATION,
};

function makeArtifact(): string {
  const dir = mkdtempSync(join(tmpdir(), "rejoin-command-"));
  return join(dir, "backup.wrb");
}

// A minimal fake `Database`: `readNodeMembership` runs two `execute`s (the `to_regclass` existence
// probe, then the `document` read) and `dropAndCreateDatabase` runs two more. By default the existence
// probe returns false → no held document → `carrier` undefined (the common test path); tests needing a
// carrier override `execute` with a sequence. `close` is a spy so `closePreWipe` can be asserted.
function fakeDb(execute?: Database["execute"]): Database {
  return {
    execute: execute ?? (vi.fn(async () => ({ rows: [{ exists: false }] })) as never),
    close: vi.fn(async () => {}),
  } as unknown as Database;
}

const HAPPY_REJOIN = vi.fn(async (): Promise<RejoinResult> => ({
  restored: true as const,
  carrierNodeId: "carrier-result",
}));

const FAKE_VALIDATED = {} as ValidatedArtifact;

async function run(
  over: Record<string, string | undefined>,
  opts: {
    argv?: string[];
    rejoin?: (d: RejoinDeps) => Promise<RejoinResult>;
    connect?: (url: string) => Promise<Database>;
    validate?: (args: RestoreDeps) => Promise<ValidatedArtifact>;
    write?: (v: ValidatedArtifact, args: RestoreDeps) => Promise<void>;
    artifactExists?: boolean;
  } = {},
): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const artifactPath = makeArtifact();
  if (opts.artifactExists !== false) {
    await writeFile(artifactPath, "not a real artifact, never decrypted (rejoin is faked)");
  }
  const code = await runRejoin({
    argv: opts.argv ?? ["rejoin", artifactPath],
    env: { ...base, ...over },
    out: (l) => out.push(l),
    rejoin: opts.rejoin ?? HAPPY_REJOIN,
    connect: opts.connect ?? (async () => fakeDb()),
    validate: opts.validate ?? (async () => FAKE_VALIDATED),
    write: opts.write ?? (async () => {}),
  });
  return { code, out };
}

describe("waitron-rejoin rejoin", () => {
  it("returns 2 and prints usage without a subcommand", async () => {
    const { code, out } = await run({}, { argv: [] });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("returns 2 and prints usage when the artifact path is missing", async () => {
    const { code, out } = await run({}, { argv: ["rejoin"] });
    expect(code).toBe(2);
    expect(out).toEqual([expect.stringMatching(/usage/i)]);
  });

  it("returns 1 and names the variable when the recovery key is missing", async () => {
    const { code, out } = await run({ WAITRON_BACKUP_RECOVERY_KEY: undefined });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_BACKUP_RECOVERY_KEY/)]);
  });

  it("refuses an empty WAITRON_RESTORE_DATABASE_URL (fail closed)", async () => {
    const { code, out } = await run({ WAITRON_RESTORE_DATABASE_URL: "" });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_RESTORE_DATABASE_URL/)]);
  });

  it("refuses an empty DATABASE_URL (fail closed)", async () => {
    const { code, out } = await run({ DATABASE_URL: "" });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/DATABASE_URL/)]);
  });

  it("refuses an empty WAITRON_SYNC_DATABASE_URL (fail closed)", async () => {
    const { code, out } = await run({ WAITRON_SYNC_DATABASE_URL: "" });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_SYNC_DATABASE_URL/)]);
  });

  it("refuses an empty WAITRON_MAINTENANCE_DATABASE_URL (fail closed)", async () => {
    const { code, out } = await run({ WAITRON_MAINTENANCE_DATABASE_URL: "" });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/WAITRON_MAINTENANCE_DATABASE_URL/)]);
  });

  it("refuses when the WAITRON_TILL_*_ID are absent (unprovisioned box)", async () => {
    const { code, out } = await run({
      WAITRON_TILL_TENANT_ID: undefined,
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

  it("returns 1 and names the path when the artifact file is missing", async () => {
    const { code, out } = await run({}, { artifactExists: false });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/cannot read artifact file/);
  });

  it("returns 1 (never rejects raw) on an invalid WAITRON_ENV", async () => {
    await expect(run({ WAITRON_ENV: "garbage" }).then((r) => r.code)).resolves.toBe(1);
    const { out } = await run({ WAITRON_ENV: "garbage" });
    expect(out.join("\n")).toContain("server.config_invalid");
  });

  it("refuses a WAITRON_RESTORE_DATABASE_URL with no database name in its path", async () => {
    const { code, out } = await run({ WAITRON_RESTORE_DATABASE_URL: "postgres://admin@localhost" });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/WAITRON_RESTORE_DATABASE_URL/);
  });

  it("refuses when DATABASE_URL and WAITRON_RESTORE_DATABASE_URL name different databases, opening no pool and wiping nothing", async () => {
    // Gap #2: the guards inspect DATABASE_URL's db while the wipe force-drops WAITRON_RESTORE_DATABASE_URL's
    // db — a mismatch would vouch for db A and destroy db B. Refuse BEFORE any pool is opened. Proven by
    // deletion: remove the same-target check in rejoin-command.ts and this proceeds (connect + rejoin run).
    const connect = vi.fn(async () => fakeDb());
    const rejoin = vi.fn(HAPPY_REJOIN);
    const { code, out } = await run(
      { WAITRON_RESTORE_DATABASE_URL: "postgres://admin:hunter2@localhost/OTHER_db" },
      { connect, rejoin },
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/same host, port and database/);
    expect(connect).not.toHaveBeenCalled(); // no pool opened
    expect(rejoin).not.toHaveBeenCalled(); // the wipe/restore orchestrator never ran
  });

  it("refuses when the two target URLs differ only by host (guards would vouch for the wrong server)", async () => {
    const { code, out } = await run({
      WAITRON_RESTORE_DATABASE_URL: "postgres://admin:hunter2@other-host/app_db",
    });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/same host, port and database/);
  });

  it("refuses (fail closed) when DATABASE_URL cannot be parsed as a standard URL", async () => {
    const connect = vi.fn(async () => fakeDb());
    const { code, out } = await run({ DATABASE_URL: "not a url" }, { connect });
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/standard libpq URLs/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("proceeds when the two target URLs match on host+port+database (differing only by role)", async () => {
    // APP_URL connects as `app`, RESTORE_URL as `admin`, both to localhost/app_db — a legitimate pair.
    const rejoin = vi.fn(HAPPY_REJOIN);
    const { code } = await run({}, { rejoin });
    expect(code).toBe(0);
    expect(rejoin).toHaveBeenCalledOnce();
  });

  it("reports a rejoin.* code without echoing a raw message and returns 1", async () => {
    const { code, out } = await run(
      {},
      {
        rejoin: async () => {
          throw new AppError("rejoin.not_drained", {});
        },
      },
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("rejoin.not_drained");
  });

  it("closes both pre-wipe pools when a guard/validate rejects (no connection leak)", async () => {
    // On the refusal path the orchestrator throws BEFORE `closePreWipe`, so `runRejoin`'s `finally`
    // must close `appDb`/`syncDb` (the wipe never ran, so no maintenance conn is opened either).
    // Proven by deletion: remove that `finally` and both close spies drop to 0.
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
    expect(opened).toHaveLength(2); // appDb + syncDb; the wipe's maintenance conn is never opened
    for (const db of opened) expect(db.close).toHaveBeenCalledTimes(1);
  });

  it("reports a restore.* gate code by code and returns 1", async () => {
    const { code, out } = await run(
      {},
      {
        rejoin: async () => {
          throw new AppError("restore.environment_mismatch", {
            backup: "production",
            target: "preproduction",
          });
        },
      },
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("restore.environment_mismatch");
  });

  it("collapses a decrypt-phase AppError into one non-leaking message and returns 1", async () => {
    const { code, out } = await run(
      {},
      {
        rejoin: async () => {
          throw new AppError("recovery.passphrase_invalid", {});
        },
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed: wrong recovery key or corrupt artifact"]);
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
          throw new Error(`Command failed: pg_restore --dbname ${leaked} ...`);
        },
      },
    );
    expect(code).toBe(1);
    const printed = out.join("\n");
    expect(printed).not.toContain("S3CR3T-ADMIN-PASSWORD");
    expect(printed).not.toContain(leaked);
    expect(out).toEqual(["rejoin failed"]);
  });

  it("returns 0, reports the carrier, exercises the wiring, and leaks no secret", async () => {
    let received: RejoinDeps | undefined;
    const rejoin = vi.fn(async (d: RejoinDeps): Promise<RejoinResult> => {
      received = d;
      // Exercise the real closures the orchestrator would drive, on the fakes: validate BEFORE the
      // wipe, write AFTER it.
      const validated = await d.validate();
      await d.closePreWipe();
      await d.wipeDatabase();
      await d.write(validated);
      d.log("info", "rejoin.test", {});
      return { restored: true as const, carrierNodeId: "carrier-result" };
    });
    const { code, out } = await run({}, { rejoin });
    expect(code).toBe(0);
    expect(received?.nodeId).toBe(NODE);
    // No held document (existence probe false) → no carrier → no drain reader.
    expect(received?.readDrainProgress).toBeUndefined();
    const printed = out.join("\n");
    expect(printed).toMatch(/restored/);
    expect(printed).toContain("carrier-result");
    expect(printed).not.toContain(RECOVERY_KEY);
    expect(printed).not.toContain("hunter2");
  });

  it("builds a carrier-keyed drain reader when the held chart names a serving-primary", async () => {
    const held: SignedMembershipDocument = {
      body: { nodes: [{ nodeId: "carrier-1", standing: "serving-primary" }] },
    } as unknown as SignedMembershipDocument;
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ document: held }] }) as unknown as Database["execute"];
    let received: RejoinDeps | undefined;
    const { code } = await run(
      {},
      {
        connect: async () => fakeDb(execute),
        rejoin: async (d): Promise<RejoinResult> => {
          received = d;
          return { restored: true as const, carrierNodeId: "carrier-1" };
        },
      },
    );
    expect(code).toBe(0);
    expect(typeof received?.readDrainProgress).toBe("function");
  });

  it("reports generically (never raw) when opening the app pool fails", async () => {
    // A `pg` connect failure rejects with a message that can carry the connection string — it must be
    // reported generically, not rejected raw out of `runRejoin` (bin-rejoin.ts's `.then(process.exit)`
    // has no `.catch`).
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

  it("reports generically and closes the app pool when opening the sync pool fails", async () => {
    const appClose = vi.fn(async () => {});
    const { code, out } = await run(
      {},
      {
        connect: async (url) => {
          if (url === SYNC_URL) throw new Error(`connect ECONNREFUSED ${SYNC_URL}`);
          return {
            execute: vi.fn(async () => ({ rows: [] })),
            close: appClose,
          } as unknown as Database;
        },
      },
    );
    expect(code).toBe(1);
    expect(out).toEqual(["rejoin failed"]);
    expect(appClose).toHaveBeenCalledOnce();
  });

  it("reports generically and closes both pools when the membership read fails", async () => {
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
    // appDb + syncDb both closed.
    expect(close).toHaveBeenCalledTimes(2);
  });
});
