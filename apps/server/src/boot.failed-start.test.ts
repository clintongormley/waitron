import { createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  readVenueHolder,
  stampDeployment,
  subscribeToChanges,
  tenants,
  tills,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
import { listBoxIpv4 } from "./box-reach.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { runCloudSnapshotLoop } from "./cloud-snapshot-loop.js";
import { runCloudWorker } from "./cloud-worker.js";
import { PENDING_ADOPTION_FILE } from "./finish-adoption.js";
import { startMdnsResponder } from "./mdns.js";

/**
 * A start that fails after boot's long-lived open of the venue folder must give the folder back:
 * the open holds `venue.lock` for this process, and nothing else would ever close it. What it
 * started beside the store must stop too.
 *
 * Observed through `venue.holder.json`, which this process writes when it first holds a folder and
 * removes on the last release (`packages/store/src/venue-liveness.ts`). So every folder here is
 * seeded through a handle closed BEFORE `startServer` runs: a handle the suite kept open would keep
 * the file whatever boot did.
 */

vi.mock("@waitron/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/db")>();
  return { ...actual, subscribeToChanges: vi.fn(actual.subscribeToChanges) };
});
vi.mock("./mdns.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mdns.js")>();
  return { ...actual, startMdnsResponder: vi.fn(actual.startMdnsResponder) };
});
vi.mock("./box-reach.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./box-reach.js")>();
  return { ...actual, listBoxIpv4: vi.fn(actual.listBoxIpv4) };
});
vi.mock("./cloud-worker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloud-worker.js")>();
  return { ...actual, runCloudWorker: vi.fn(actual.runCloudWorker) };
});
vi.mock("./cloud-snapshot-loop.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloud-snapshot-loop.js")>();
  return { ...actual, runCloudSnapshotLoop: vi.fn(actual.runCloudSnapshotLoop) };
});

const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

let migrationsRoot: string;
let seededTemplate: string;
let leafTemplate: string;
const cleanup: string[] = [];

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-failed-start-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }
  seededTemplate = await mkdtemp(join(tmpdir(), "waitron-failed-start-template-"));
  await seedVenue(seededTemplate);
  leafTemplate = await mkdtemp(join(tmpdir(), "waitron-failed-start-leaf-"));
  await ensureBoxSecrets({
    stateDir: leafTemplate,
    hostnames: ["waitron.local"],
    now: () => new Date(),
    listIpv4: () => [],
  });
}, 180_000);

afterEach(async () => {
  vi.mocked(startMdnsResponder).mockReset();
  vi.mocked(listBoxIpv4).mockReset();
  vi.mocked(subscribeToChanges).mockReset();
  vi.mocked(runCloudWorker).mockClear();
  vi.mocked(runCloudSnapshotLoop).mockClear();
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  for (const dir of [migrationsRoot, seededTemplate, leafTemplate]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** Migrates `directory` and writes the till's identity, leaving no handle open on it. */
async function seedVenue(directory: string): Promise<void> {
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  try {
    const db = store.venue;
    await db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "90444444J", legalName: "Failed Start SL" });
    await db.insert(locations).values({
      id: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    });
    await db.insert(nodes).values({
      id: TILL_ENV.WAITRON_TILL_NODE_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Node",
      filingModule: "verifactu",
    });
    await db.insert(tills).values({
      id: TILL_ENV.WAITRON_TILL_TILL_ID,
      locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
      name: "Till",
    });
    await db.insert(invoiceSeries).values({
      id: TILL_ENV.WAITRON_TILL_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
      code: "A",
    });
    await stampDeployment(db, "preproduction");
    // The control: while a handle is open, the file names this process.
    expect(readVenueHolder(directory)?.pid).toBe(process.pid);
  } finally {
    await store.close();
  }
  expect(readVenueHolder(directory)).toBeNull();
}

/** A copy of the seeded template that nobody holds. */
async function seededVenueDir(): Promise<string> {
  const directory = await tempDir("waitron-failed-start-venue-");
  await cp(seededTemplate, directory, { recursive: true });
  expect(readVenueHolder(directory)).toBeNull();
  return directory;
}

/**
 * A state folder whose module set leaves only Veri*Factu in the fiscal slot, unless `modules` says
 * otherwise. `leaf` adds a minted box certificate, which the trading listener serves and without
 * which no landing listener starts.
 */
async function stateDir(
  modules: Record<string, boolean> = { "fiscal-none": false },
  { leaf = false }: { leaf?: boolean } = {},
) {
  const dir = await tempDir("waitron-failed-start-state-");
  await writeFile(join(dir, "modules.json"), JSON.stringify({ modules }));
  if (leaf) await cp(join(leafTemplate, "tls"), join(dir, "tls"), { recursive: true });
  return dir;
}

/** `WAITRON_HTTP_PORT` refuses "0", so the OS picks a free port first. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Resolves once `port` could be bound on boot's default host; rejects `EADDRINUSE` while held. */
async function bindAndRelease(port: number): Promise<void> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
}

/** The `event` of every line boot logs to stdout while `fn` runs; each chunk still reaches stdout. */
async function withLoggedEvents(fn: () => Promise<void>): Promise<string[]> {
  const original = process.stdout.write.bind(process.stdout);
  const events: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      try {
        events.push((JSON.parse(line) as { event: string }).event);
      } catch {
        // Not a log line.
      }
    }
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return events;
}

/**
 * Replaces the next mDNS responder with one whose `stop` is recorded, and makes the next interface
 * listing after it throw `failure`: the landing listener's, which all three modes start after
 * mDNS.
 */
function failLandingAfterMdns(
  failure: Error,
  stopImpl: () => Promise<void> = () => Promise.resolve(),
) {
  const stop = vi.fn(stopImpl);
  vi.mocked(startMdnsResponder).mockImplementationOnce(() => {
    vi.mocked(listBoxIpv4).mockImplementationOnce(() => {
      throw failure;
    });
    return { stop };
  });
  return stop;
}

async function tradingEnv(venueDir: string, state: string) {
  return {
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_STATE_DIR: state,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_HTTP_PORT: String(await freePort()),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    ...TILL_ENV,
  };
}

describe("a start that fails after the venue folder is opened gives the folder back", () => {
  it("when the pending-adoption file cannot be read", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    await writeFile(join(state, PENDING_ADOPTION_FILE), "not json");

    await expect(startServer(await tradingEnv(venueDir, state))).rejects.toThrow(SyntaxError);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when an adoption-pending start cannot read its certificate", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    // Enough to take the adoption-pending branch; its worker fails on the empty record.
    await writeFile(join(state, PENDING_ADOPTION_FILE), "{}");

    await expect(
      startServer({
        ...(await tradingEnv(venueDir, state)),
        WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
        WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when the enabled set fills no fiscal slot", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir({ "fiscal-verifactu": false, "fiscal-none": false });

    await expect(startServer(await tradingEnv(venueDir, state))).rejects.toMatchObject({
      code: "module.fiscal_slot_empty",
    });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when the trading listener cannot read its certificate, stopping the bucket copy too", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();

    const events = await withLoggedEvents(async () => {
      await expect(
        startServer({
          ...(await tradingEnv(venueDir, state)),
          WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
        }),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
    expect(readVenueHolder(venueDir)).toBeNull();
    // `StreamHost.stop()` logs it whether or not a copy was running.
    expect(events).toContain("stream.stopped");
  }, 60_000);

  it("when the listener cannot read its certificate while a backup sweep holds its own open", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    const backupDir = await tempDir("waitron-failed-start-backup-");

    await expect(
      startServer(
        {
          ...(await tradingEnv(venueDir, state)),
          WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
        },
        // The backup settings are read from the raw base env (`loadBoxEnv`), not the merged one.
        { WAITRON_BACKUP_DIR: backupDir, WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" },
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when a step after the tunnel starts throws, closing its connection to the relay", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    // Reads and never answers, so it sees a client close, and a connection nobody stops stays open.
    const open = new Set<Socket>();
    let everAccepted = 0;
    let firstAccept!: () => void;
    const accepted = new Promise<void>((resolve) => (firstAccept = resolve));
    const relay = createNetServer((socket) => {
      everAccepted += 1;
      open.add(socket);
      socket.resume();
      socket.on("close", () => open.delete(socket));
      socket.on("error", () => socket.destroy());
      firstAccept();
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    const relayPort = (relay.address() as AddressInfo).port;
    const failure = new Error("interfaces unreadable");
    // Whether the tunnel has dialled by the time its undo runs is otherwise a race, so the fake mDNS
    // stop, which the unwind runs before the tunnel's undo, waits for the relay's first accept (or
    // 10s, which fails the count below).
    failLandingAfterMdns(failure, () => Promise.race([accepted, delay(10_000)]));

    try {
      await expect(
        startServer({
          ...(await tradingEnv(venueDir, state)),
          WAITRON_HTTP_LANDING_PORT: String(await freePort()),
          WAITRON_TUNNEL_RELAY_URL: `tcp://127.0.0.1:${relayPort}`,
          WAITRON_TUNNEL_BOX_ID: "box-failed-start",
          WAITRON_TUNNEL_TOKEN: "tunnel-secret",
          WAITRON_TUNNEL_POOL_SIZE: "1",
        }),
      ).rejects.toBe(failure);
      expect(readVenueHolder(venueDir)).toBeNull();
      expect(everAccepted).toBeGreaterThanOrEqual(1);
      await vi.waitFor(() => expect(open.size).toBe(0), { timeout: 2_000 });
    } finally {
      for (const socket of open) socket.destroy();
      await new Promise<void>((resolve) => relay.close(() => resolve()));
    }
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping what started", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state)),
      WAITRON_HTTP_LANDING_PORT: String(await freePort()),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const failure = new Error("interfaces unreadable");
    const mdnsStop = failLandingAfterMdns(failure);
    const { subscribeToChanges: realSubscribe } =
      await vi.importActual<typeof import("@waitron/db")>("@waitron/db");
    const unsubscribe = vi.fn();
    vi.mocked(subscribeToChanges).mockImplementationOnce((listener) => {
      const off = realSubscribe(listener);
      return () => {
        unsubscribe();
        off();
      };
    });

    const events = await withLoggedEvents(async () => {
      await expect(startServer(env)).rejects.toBe(failure);
    });
    expect(readVenueHolder(venueDir)).toBeNull();
    await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(events).toContain("loop.stopped");
    expect(mdnsStop).toHaveBeenCalledOnce();
    expect(vi.mocked(runCloudWorker).mock.calls.at(-1)![0].signal.aborted).toBe(true);
    expect(vi.mocked(runCloudSnapshotLoop).mock.calls.at(-1)![0].signal.aborted).toBe(true);
  }, 60_000);

  it("while an adoption is pending, when a step after the listener is started throws", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    await writeFile(join(state, PENDING_ADOPTION_FILE), "{}");
    const env = {
      ...(await tradingEnv(venueDir, state)),
      WAITRON_HTTP_LANDING_PORT: String(await freePort()),
    };
    const failure = new Error("interfaces unreadable");
    const mdnsStop = failLandingAfterMdns(failure);

    await expect(startServer(env)).rejects.toBe(failure);
    expect(readVenueHolder(venueDir)).toBeNull();
    await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
    expect(mdnsStop).toHaveBeenCalledOnce();
  }, 60_000);

  it("when an undo throws before returning a promise, the boot's own error still escapes", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state)),
      WAITRON_HTTP_LANDING_PORT: String(await freePort()),
    };
    const failure = new Error("interfaces unreadable");
    const mdnsStop = failLandingAfterMdns(failure, () => {
      throw new Error("stop threw");
    });

    await expect(startServer(env)).rejects.toBe(failure);
    expect(mdnsStop).toHaveBeenCalledOnce();
    // The undos older than the throwing one still ran.
    expect(readVenueHolder(venueDir)).toBeNull();
    await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
  }, 60_000);

  describe("in setup mode", () => {
    async function setupEnv() {
      const venueDir = await tempDir("waitron-failed-start-setup-venue-");
      const state = await tempDir("waitron-failed-start-setup-state-");
      return {
        venueDir,
        state,
        env: {
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_STATE_DIR: state,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
          WAITRON_HTTP_PORT: String(await freePort()),
          WAITRON_HTTP_LANDING_PORT: "0",
        },
      };
    }

    it("when the listener cannot read its certificate", async () => {
      const { venueDir, state, env } = await setupEnv();

      await expect(
        startServer({
          ...env,
          WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
        }),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(readVenueHolder(venueDir)).toBeNull();
    }, 60_000);

    it("when a step after the listener is started throws", async () => {
      const { venueDir, env } = await setupEnv();
      const failure = new Error("interfaces unreadable");
      const mdnsStop = failLandingAfterMdns(failure);

      await expect(
        startServer({ ...env, WAITRON_HTTP_LANDING_PORT: String(await freePort()) }),
      ).rejects.toBe(failure);
      expect(readVenueHolder(venueDir)).toBeNull();
      await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
      expect(mdnsStop).toHaveBeenCalledOnce();
    }, 60_000);
  });
});
