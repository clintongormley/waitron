import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withNodeTransaction, withTransaction } from "@waitron/db";
import { useVenueDb, type VenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { recordHandoverRestrictionTx } from "@waitron/node-db";
import type { SpawnFn } from "@waitron/stream";
import { FakeLitestream } from "@waitron/stream/testing/fake-litestream.js";
import { SwitchableStore } from "@waitron/stream/testing/switchable-store.js";
import type { StartedServer } from "./boot.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { establishNodeIdentity } from "./node-identity.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { httpsVia } from "./testing/boot-harness.js";
import { STREAM_PURPOSE } from "./stream-host.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { insertFiscalRegistro, insertFiscalSale } from "./testing/fiscal-fixtures.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();

const calls = vi.hoisted(() => ({ authority: 0, sweep: 0, spawn: 0, drain: 0 }));

// Counts the fiscal drain's passes, each still running the real drain.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      return {
        ...real,
        drain: (...drainArgs: Parameters<typeof real.drain>) => {
          calls.drain += 1;
          return real.drain(...drainArgs);
        },
      };
    },
  };
});

// AEAT's clock reading is replaced by a stand-in that answers nothing, so no case reaches AEAT;
// the watch checks often enough to ask within the quiet period.
vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    startClockWatch: (...args: Parameters<typeof actual.startClockWatch>) => {
      const [deps] = args;
      return actual.startClockWatch({
        ...deps,
        intervalMs: 200,
        // A proxy, not a spread: the backend is a class instance whose methods a spread drops.
        backend: new Proxy(deps.backend, {
          get: (target, key) => {
            if (key === "readAuthorityTime") {
              return () => {
                calls.authority += 1;
                return Promise.resolve(null);
              };
            }
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
    },
  };
});

vi.mock("./pending-card-recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pending-card-recovery.js")>();
  return {
    ...actual,
    runPendingCardLoop: (...args: Parameters<typeof actual.runPendingCardLoop>) => {
      const [deps] = args;
      return actual.runPendingCardLoop({
        ...deps,
        pass: (now) => {
          calls.sweep += 1;
          return deps.pass(now);
        },
      });
    },
  };
});

const migrations = migrationOptionsFor(manifestSets(), null);

const QUIET_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};

interface Observed {
  hashBefore: string;
  hashAfter: string;
  authority: number;
  sweep: number;
  spawn: number;
  drain: number;
  /** The status of a GET of `/` made during the quiet period. */
  pageStatus: number;
}

function venueFile(suite: VenueDb): string {
  return suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
}

/** venue.db together with its write-ahead log, where a write lands before a checkpoint. */
async function venueHash(suite: VenueDb): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [venueFile(suite), `${venueFile(suite)}-wal`]) {
    try {
      hash.update(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Registers, in the calling `describe`, one start of a folder that a full start would stream,
 * sweep, run the fiscal drain on and ask AEAT's time for: it holds a bucket copy's settings and a membership, and a fiscal
 * record a day ahead of the clock, which puts the box in a clock stop. `restricted` adds the
 * handover restriction row. The start runs for `QUIET_MS`, then venue.db's hash and the stand-ins'
 * counts are read for the describe's cases.
 */
function observeStart(options: { restricted: boolean }): () => Observed {
  const suite = useVenueDb({ migrations, resetPerTest: false });
  let server: StartedServer | undefined;
  let scratch: string | undefined;
  let observed: Observed | undefined;
  let closeHttp: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    beforeServerStarts();
    const venue = await setupVenue(suite.db);
    const nodeId = venue.cfg.nodeId;
    const ring = loadKeyRing(KEY_ENV);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
    await seedTermZeroMembership(
      { db: suite.db, node: suite.node, ring },
      nodeId,
      "https://box.example",
    );
    const [sif] = suite.db.all<{ id: string }>(
      sql`select id from registro_sif where node_id = ${nodeId}`,
    );
    const ids = {
      locationId: venue.cfg.locationId,
      nodeId,
      seriesId: venue.seriesId,
      saleId: randomUUID(),
      sifId: sif!.id,
    };
    await insertFiscalSale(suite.db, ids);
    await insertFiscalRegistro(suite.db, ids, {
      entorno: "preproduction",
      generatedAt: new Date(Date.now() + DAY_MS),
    });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, ring, {
        purpose: STREAM_PURPOSE,
        value: {
          venueId: "venue-1",
          endpoint: "-",
          region: "eu-south-2",
          bucket: "venue-copies",
          prefix: "-",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secret-example",
        },
      }),
    );
    if (options.restricted) {
      await withNodeTransaction(suite.node, (tx) =>
        recordHandoverRestrictionTx(tx, {
          nodeId,
          operationId: null,
          kind: "superseded",
          successorNodeId: "00000000-0000-4000-8000-0000000000aa",
          membershipTerm: 1,
        }),
      );
    }
    // A pending change row, as a write outside `withTransaction` leaves one: a GET that opened a
    // write transaction would drain it and change the file.
    suite.db.run(
      sql`insert into change_log (id, payload) values (${randomUUID()}, ${JSON.stringify({ resource: "venue" })})`,
    );
    scratch = await mkdtemp(join(tmpdir(), "waitron-boot-restricted-quiet-"));
    await ensureBoxSecrets({
      stateDir: scratch,
      hostnames: ["localhost"],
      now: () => new Date(),
      makeKeyRing: () => ({ key: KEY_ENV.WAITRON_CREDENTIALS_KEY, version: 1 }),
    });
    await writeFile(join(scratch, "trading.env"), "");
    const { via, close } = httpsVia(await readFile(join(scratch, "tls", "ca.crt")));
    closeHttp = close;
    const migrationsRoot = join(scratch, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }
    await writeFile(
      join(scratch, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const env: Record<string, string> = {
      ...KEY_ENV,
      WAITRON_BACKUP_RECOVERY_KEY: "backup-key-for-test-0123456789",
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(venueFile(suite)),
      WAITRON_NODE_ID: nodeId,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
      WAITRON_MAX_TICK_MS: "600000",
      WAITRON_MIN_TICK_MS: "200",
      WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
    };
    const litestream = new FakeLitestream();
    const spawn: SpawnFn = (...args) => {
      calls.spawn += 1;
      return litestream.spawn(...args);
    };
    calls.authority = 0;
    calls.sweep = 0;
    calls.spawn = 0;
    calls.drain = 0;
    const hashBefore = await venueHash(suite);
    server = await startServer(env, env, {
      stream: { spawn, store: new SwitchableStore(() => new Date()) },
    });
    await vi.waitFor(
      async () => {
        expect((await fetch(`https://127.0.0.1:${httpPort()}/health`, via)).status).toBe(200);
      },
      { timeout: 10_000 },
    );
    // A person opening the box's address is part of the quiet period: the page must not write.
    const pageStatus = (await fetch(`https://127.0.0.1:${httpPort()}/`, via)).status;
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    observed = { hashBefore, hashAfter: await venueHash(suite), ...calls, pageStatus };
  }, 60_000);

  afterAll(async () => {
    try {
      if (server !== undefined) await server.close();
    } finally {
      await closeHttp?.();
      if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    }
  });

  return () => {
    if (observed === undefined) throw new Error("the start was not observed");
    return observed;
  };
}

describe("a restricted start touches nothing outside and nothing in venue.db", () => {
  const observed = observeStart({ restricted: true });

  it("writes nothing to venue.db, with its own page opened", () => {
    expect(observed().pageStatus).toBe(200);
    expect(observed().hashAfter).toBe(observed().hashBefore);
  });

  it("asks AEAT's host for no clock reading", () => {
    expect(observed().authority).toBe(0);
  });

  it("runs no card-provider sweep", () => {
    expect(observed().sweep).toBe(0);
  });

  it("starts no Litestream child", () => {
    expect(observed().spawn).toBe(0);
  });

  it("starts no fiscal pass", () => {
    expect(observed().drain).toBe(0);
  });
});

describe("control: the same folder without the restriction row", () => {
  const observed = observeStart({ restricted: false });

  it("writes to venue.db, asks AEAT's time, sweeps card providers and starts Litestream", () => {
    const { hashBefore, hashAfter, authority, sweep, spawn } = observed();
    expect(hashAfter).not.toBe(hashBefore);
    expect(authority).toBeGreaterThan(0);
    expect(sweep).toBeGreaterThan(0);
    expect(spawn).toBeGreaterThan(0);
  });

  it("starts the fiscal drain", () => {
    expect(observed().drain).toBeGreaterThan(0);
  });
});
