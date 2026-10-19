import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startAppendOnlyWatch } from "./append-only-watch.js";
import type { StartedServer } from "./boot.js";
import * as reminderWorker from "./certificate-reminder-worker.js";
import { awaitListening, copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { serverFixture } from "./testing/server-fixture.js";
import { setupVenue } from "./testing/venue-fixtures.js";

vi.mock("./append-only-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./append-only-watch.js")>();
  return { ...actual, startAppendOnlyWatch: vi.fn(actual.startAppendOnlyWatch) };
});
// Submissions are switched on for these boots; nothing here may reach AEAT.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: async () => emptyDrainResult(),
    }),
  };
});

const { beforeServerStarts, startServer } = serverFixture();
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
};

async function prepared(submissions: boolean) {
  beforeServerStarts();
  const venue = await setupVenue(suite.db);
  const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-certificate-reminders-"));
  await copyMigrationsRoot(join(scratch, "migrations"));
  await writeFile(
    join(scratch, "modules.json"),
    JSON.stringify({ modules: { "fiscal-none": false } }),
  );
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  return {
    port: port!,
    scratch,
    env: {
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_STATE_DIR: scratch,
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
      WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
      WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
      WAITRON_ENV: "preproduction",
      ...(submissions ? { WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" } : {}),
    },
  };
}

/** A stand-in loop that ends only after its signal aborts and `release` is called. */
function holdingLoop() {
  const release = gate(),
    aborted = gate();
  const state = { db: undefined as Database | undefined, finished: false, aliveAtEnd: false };
  const spy = vi
    .spyOn(reminderWorker, "runCertificateReminderLoop")
    .mockImplementation(async (deps) => {
      state.db = deps.db;
      await new Promise<void>((resolve) =>
        deps.signal.addEventListener(
          "abort",
          () => {
            aborted.release();
            resolve();
          },
          { once: true },
        ),
      );
      await release.promise;
      state.aliveAtEnd = deps.db.all(sql`select 1 as alive`).length === 1;
      state.finished = true;
    });
  return { spy, state, release: release.release, aborted: aborted.promise };
}

const settle = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe("the certificate reminder loop at boot", () => {
  it("does not start where fiscal records are not filed", async () => {
    const f = await prepared(false);
    const spy = vi.spyOn(reminderWorker, "runCertificateReminderLoop");
    let server: StartedServer | undefined;
    try {
      server = await startServer(f.env);
      await awaitListening(f.port);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      await server?.close();
      spy.mockRestore();
      await rm(f.scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("normal close aborts the loop and waits for it before closing its database handle", async () => {
    const f = await prepared(true);
    const loop = holdingLoop();
    let server: StartedServer | undefined;
    let closing: Promise<void> | undefined;
    let completed = false;
    try {
      server = await startServer(f.env);
      await awaitListening(f.port);
      expect(loop.spy).toHaveBeenCalledOnce();
      expect(loop.spy.mock.calls[0]![0]).toMatchObject({ venueLanguage: "es" });
      closing = server.close().then(() => {
        completed = true;
      });
      await loop.aborted;
      await settle();
      expect(completed).toBe(false);
      expect(loop.state.finished).toBe(false);
      loop.release();
      await closing;
      server = undefined;
      expect(loop.state.finished).toBe(true);
      expect(loop.state.aliveAtEnd).toBe(true);
      expect(() => loop.state.db!.all(sql`select 1 as alive`)).toThrow();
    } finally {
      loop.release();
      await closing;
      await server?.close();
      loop.spy.mockRestore();
      await rm(f.scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("a start that fails after the loop began aborts it and waits for it", async () => {
    const f = await prepared(true);
    const loop = holdingLoop();
    const failure = new Error("append-only watch refused");
    vi.mocked(startAppendOnlyWatch).mockImplementationOnce(() => {
      throw failure;
    });
    let rejected = false;
    try {
      const starting = startServer(f.env).catch((error: unknown) => {
        rejected = true;
        return error;
      });
      await loop.aborted;
      await settle();
      expect(rejected).toBe(false);
      loop.release();
      expect(await starting).toBe(failure);
      expect(loop.state.finished).toBe(true);
      expect(loop.state.aliveAtEnd).toBe(true);
    } finally {
      loop.release();
      loop.spy.mockRestore();
      await rm(f.scratch, { recursive: true, force: true });
    }
  }, 60_000);
});
