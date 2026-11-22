import type { Hono } from "hono";
import { BUILD_HEADER } from "@waitron/shared";
import * as handoverGates from "./handover-gate.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { mkdir } from "node:fs/promises";
import { seedVenueSettings, seedBusinessDay, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { payments } from "@waitron/payments";
import { sql } from "drizzle-orm";
import { connect, type Server } from "node:net";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { Agent } from "undici";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  invoiceSeries,
  nodes,
  openVenueDatabase,
  readVenueHolder,
  stampDeployment,
  subscribeToChanges,
  taxpayer,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { appendOnlyTriggerFaults } from "@waitron/store";
import { tamperWatchJob } from "./append-only-watch.js";
import { freeSpaceJob } from "./free-space-watch.js";
import { createBoxEmailDuty } from "./box-alert-email.js";
import { startSpareFollow } from "./spare-follow.js";
import { runSpareSettings } from "./spare-settings.js";
import { StreamHost } from "./stream-host.js";
import { clockWatchJob } from "./clock-watch.js";
import { startServer as bootServer, type StartedServer } from "./boot.js";
import { listBoxIpv4 } from "./box-reach.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { backupsJob } from "./backup-supervisor.js";
import { cloudConnectionJob } from "./cloud-worker.js";
import { createContentSuggestionRunner } from "./content-suggestion-runner.js";
import { PENDING_ADOPTION_FILE } from "./finish-adoption.js";
import { LiveEvents } from "./live-api.js";
import { startMdnsResponder } from "./mdns.js";
import { createJobRunner } from "./job-runner.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { stopTenderRefundResolvers } from "./tender-refund-sends.js";
import { cardFollowUpJob } from "./card-follow-up.js";
import { createSealedStateRefresher } from "./sealed-state.js";
import { adoptRetainedListeners } from "./testing/retained-http-adoption.mjs";
import { retainHttpListener, type RetainedHttpListener } from "./testing/retained-http-listener.js";
import { startStaffListener } from "./cloud-remote.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { stopBackgroundDuties } from "./background-duties.js";
import { rememberCheckedAddressesIn } from "./mirror-bundle-fetch.js";
import { startSpareStore } from "./spare-store.js";
import { loadKeyRing, writePairLinkTx } from "@waitron/credentials";
import { writeArchiveSettings } from "./archive-settings.js";
import { withTransaction, withNodeTransaction } from "@waitron/db";
vi.mock("./background-duties.js", async (original) => {
  const actual = await original<typeof import("./background-duties.js")>();
  return { ...actual, stopBackgroundDuties: vi.fn(actual.stopBackgroundDuties) };
});
vi.mock("./clock-watch.js", async (load) => {
  const actual = await load<typeof import("./clock-watch.js")>();
  return { ...actual, clockWatchJob: vi.fn(actual.clockWatchJob) };
});

vi.mock("./mirror-bundle-fetch.js", async (original) => {
  const actual = await original<typeof import("./mirror-bundle-fetch.js")>();
  return { ...actual, rememberCheckedAddressesIn: vi.fn(actual.rememberCheckedAddressesIn) };
});

vi.mock("./spare-store.js", async (original) => {
  const actual = await original<typeof import("./spare-store.js")>();
  return { ...actual, startSpareStore: vi.fn(actual.startSpareStore) };
});

vi.mock("./cloud-remote.js", async (original) => {
  const actual = await original<typeof import("./cloud-remote.js")>();
  return { ...actual, startStaffListener: vi.fn(actual.startStaffListener) };
});

/**
 * A start that fails after boot's long-lived open of the venue folder must give the folder back:
 * the open holds `venue.lock` for this process, and nothing else would ever close it. What it
 * started beside the store must stop too.
 *
 * Observed through `venue.holder.json`, which this process writes when it first holds a folder and
 * removes on the last release (`packages/store/src/venue-liveness.ts`). So every folder here is
 * seeded through a handle closed BEFORE `startServer` runs: a handle the suite kept open would keep
 * the file whatever boot did.
 *
 * A started server's `close()` must give the folder back too, even when a stop inside it fails.
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
  return { ...actual, cloudConnectionJob: vi.fn(actual.cloudConnectionJob) };
});
vi.mock("./content-suggestion-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-suggestion-runner.js")>();
  return {
    ...actual,
    createContentSuggestionRunner: vi.fn(actual.createContentSuggestionRunner),
  };
});
vi.mock("./backup-supervisor.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./backup-supervisor.js")>();
  return { ...actual, backupsJob: vi.fn(actual.backupsJob) };
});
vi.mock("./job-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-runner.js")>();
  return { ...actual, createJobRunner: vi.fn(actual.createJobRunner) };
});

vi.mock("./append-only-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./append-only-watch.js")>();
  return { ...actual, tamperWatchJob: vi.fn(actual.tamperWatchJob) };
});

vi.mock("./free-space-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./free-space-watch.js")>();
  return { ...actual, freeSpaceJob: vi.fn(actual.freeSpaceJob) };
});

vi.mock("./box-alert-email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./box-alert-email.js")>();
  return { ...actual, createBoxEmailDuty: vi.fn(actual.createBoxEmailDuty) };
});

vi.mock("./spare-follow.js", async (original) => {
  const actual = await original<typeof import("./spare-follow.js")>();
  return {
    ...actual,
    startSpareFollow: vi.fn((deps) => {
      const duty = actual.startSpareFollow(deps);
      return { ...duty, stop: vi.fn(() => duty.stop()) };
    }),
  };
});

vi.mock("./spare-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spare-settings.js")>();
  return { ...actual, runSpareSettings: vi.fn(actual.runSpareSettings) };
});

vi.mock("./tender-refund-recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tender-refund-recovery.js")>();
  return { ...actual, recoverTenderRefunds: vi.fn(actual.recoverTenderRefunds) };
});

vi.mock("./sealed-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sealed-state.js")>();
  return { ...actual, createSealedStateRefresher: vi.fn(actual.createSealedStateRefresher) };
});

vi.mock("./card-follow-up.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./card-follow-up.js")>();
  return { ...actual, cardFollowUpJob: vi.fn(actual.cardFollowUpJob) };
});
vi.mock("./tender-refund-sends.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tender-refund-sends.js")>();
  return { ...actual, stopTenderRefundResolvers: vi.fn(actual.stopTenderRefundResolvers) };
});

const SEEDED_SERIES_ID = "44444444-4444-4444-8444-444444444444";
const TILL_ENV = {
  WAITRON_NODE_ID: "33333333-3333-4333-8333-333333333333",
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
  await seedVenueWithNode(seededTemplate);
  leafTemplate = await mkdtemp(join(tmpdir(), "waitron-failed-start-leaf-"));
  await ensureBoxSecrets({
    stateDir: leafTemplate,
    hostnames: ["waitron.local"],
    now: () => new Date(),
    listIpv4: () => [],
  });
}, 180_000);

const reservations = new Map<number, RetainedHttpListener>();
const adopted = new Map<number, Server>();

async function reservePort(): Promise<number> {
  const held = await retainHttpListener();
  reservations.set(held.port, held);
  return held.port;
}

async function withPortAdoption<T>(
  ports: readonly number[],
  start: () => T | Promise<T>,
): Promise<T> {
  const entries = ports.flatMap((port) => {
    const held = reservations.get(port);
    return held !== undefined && !adopted.has(port) ? [held] : [];
  });
  if (entries.length === 0) return start();
  const adoption = adoptRetainedListeners(entries);
  try {
    return await start();
  } finally {
    adoption.restore();
    for (const [port, server] of adoption.adopted) adopted.set(port, server);
  }
}

function startServer(...args: Parameters<typeof bootServer>): ReturnType<typeof bootServer> {
  const env = args[0];
  return withPortAdoption(
    [env?.WAITRON_HTTP_PORT, env?.WAITRON_HTTP_LANDING_PORT, env?.WAITRON_STAFF_PORT].map(Number),
    () => bootServer(...args),
  );
}

afterEach(async () => {
  vi.mocked(startMdnsResponder).mockReset();
  vi.mocked(listBoxIpv4).mockReset();
  vi.mocked(subscribeToChanges).mockReset();
  vi.mocked(cloudConnectionJob).mockClear();
  vi.mocked(createContentSuggestionRunner).mockClear();
  vi.mocked(backupsJob).mockClear();
  vi.mocked(startSpareStore).mockClear();
  vi.mocked(createJobRunner).mockClear();
  vi.mocked(tamperWatchJob).mockClear();
  vi.mocked(recoverTenderRefunds).mockReset();
  vi.mocked(stopTenderRefundResolvers).mockReset();
  vi.mocked(cardFollowUpJob).mockReset();
  for (const held of reservations.values()) if (held.server.listening) await held.close();
  reservations.clear();
  adopted.clear();
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  for (const dir of [migrationsRoot, seededTemplate, leafTemplate]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

const { backupsJob: realBackupsJob } =
  await vi.importActual<typeof import("./backup-supervisor.js")>("./backup-supervisor.js");
const { cloudConnectionJob: realCloudJob } =
  await vi.importActual<typeof import("./cloud-worker.js")>("./cloud-worker.js");

/** Spies on the stop of the next job runner boot starts. */
async function spyOnJobRunnerStop() {
  const { createJobRunner: realStart } =
    await vi.importActual<typeof import("./job-runner.js")>("./job-runner.js");
  const stop = vi.fn<() => Promise<void>>();
  vi.mocked(createJobRunner).mockImplementationOnce((deps) => {
    const duty = realStart(deps);
    stop.mockImplementation(() => duty.stopJobs());
    return { ...duty, stopJobs: stop };
  });
  return stop;
}

/** Spies on the stop of the next append-only watch boot starts. */
async function spyOnAppendOnlyWatchStop() {
  const { tamperWatchJob: realStart } =
    await vi.importActual<typeof import("./append-only-watch.js")>("./append-only-watch.js");
  const stop = vi.fn<() => void>();
  vi.mocked(tamperWatchJob).mockImplementationOnce((deps) => {
    const job = realStart(deps);
    return {
      ...job,
      onStop: async () => {
        stop();
      },
    };
  });
  return stop;
}

/** Spies on the stop of the next free-space watch boot starts. */
async function spyOnFreeSpaceWatchStop() {
  const { freeSpaceJob: realStart } =
    await vi.importActual<typeof import("./free-space-watch.js")>("./free-space-watch.js");
  const stop = vi.fn<() => Promise<void>>();
  vi.mocked(freeSpaceJob).mockImplementationOnce((deps) => {
    const job = realStart(deps);
    stop.mockResolvedValue(undefined);
    return { ...job, onStop: stop };
  });
  return stop;
}

/** Spies on the stop of the next managers' email check boot starts. */
async function spyOnBoxEmailDutyStop() {
  const { createBoxEmailDuty: realStart } =
    await vi.importActual<typeof import("./box-alert-email.js")>("./box-alert-email.js");
  const stop = vi.fn<() => Promise<void>>();
  vi.mocked(createBoxEmailDuty).mockImplementationOnce((deps) => {
    const duty = realStart(deps);
    stop.mockImplementation(async () => {
      duty.halt();
    });
    return {
      ...duty,
      halt: () => {
        void stop();
      },
    };
  });
  return stop;
}

/** Spies on the stop of the next spare-settings sender boot starts. */
async function spyOnSpareSettingsStop() {
  const { runSpareSettings: realStart } =
    await vi.importActual<typeof import("./spare-settings.js")>("./spare-settings.js");
  const stop = vi.fn<() => Promise<void>>();
  vi.mocked(runSpareSettings).mockImplementationOnce((deps) => {
    const duty = realStart(deps);
    stop.mockImplementation(() => duty.stop());
    return { stop };
  });
  return stop;
}

/**
 * Spies on the function that lets go of the state folder the next start keeps checked addresses in;
 * `holders` gets the process holding `venueDir` at each call, `null` for none.
 */
async function spyOnCheckedAddressesLetGo(venueDir?: string) {
  const { rememberCheckedAddressesIn: realRemember } = await vi.importActual<
    typeof import("./mirror-bundle-fetch.js")
  >("./mirror-bundle-fetch.js");
  const letGo = vi.fn<() => Promise<void>>();
  const folders: string[] = [];
  const holders: Array<number | null> = [];
  vi.mocked(rememberCheckedAddressesIn).mockImplementationOnce(async (stateDir, onWriteFailed) => {
    folders.push(stateDir);
    const letGoOfFolder = await realRemember(stateDir, onWriteFailed);
    letGo.mockImplementation(() => {
      if (venueDir !== undefined) holders.push(readVenueHolder(venueDir)?.pid ?? null);
      return letGoOfFolder();
    });
    return letGo;
  });
  return { letGo, folders, holders };
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** Migrates `directory` and writes the venue's identity on this node, leaving no handle open on it. */
async function seedVenueWithNode(directory: string): Promise<void> {
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  try {
    const db = store.venue;
    await seedModuleSettings(db, { "fiscal-none": false });
    await db
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "90444444J", legalName: "Failed Start SL" });
    await seedVenueSettings(db, {
      name: "Barra",
      invoiceLocales: ["es-ES"],
    });
    await seedBusinessDay(db, {});
    await db.insert(nodes).values({
      id: TILL_ENV.WAITRON_NODE_ID,
      name: "Node",
      filingModule: "verifactu",
    });
    await db.insert(invoiceSeries).values({
      id: SEEDED_SERIES_ID,
      nodeId: TILL_ENV.WAITRON_NODE_ID,
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

/** Runs `statements` on `venueDir`'s database through a raw handle closed before it returns. */
function tamper(venueDir: string, statements: string): void {
  const raw = new DatabaseSync(join(venueDir, "venue.db"), { timeout: 5000 });
  try {
    raw.exec(statements);
  } finally {
    raw.close();
  }
}

/** Whichever of `tables`' append-only triggers are missing or altered, read with no handle left open. */
async function triggerFaults(venueDir: string, tables: readonly string[]) {
  const store = await openVenueDatabase(venueDir);
  try {
    return appendOnlyTriggerFaults(store.venue, tables);
  } finally {
    await store.close();
  }
}

/** Waits for the adopter to bind. The holder itself can already accept a TCP connection. */
async function listening(port: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(adopted.get(port)?.listening).toBe(true);
      return new Promise<void>((resolve, reject) => {
        const socket = connect(port, "127.0.0.1", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
    },
    { timeout: 10_000 },
  );
}

function isStartedServer(value: unknown): value is StartedServer {
  return (
    typeof value === "object" && value !== null && !(value instanceof Error) && "close" in value
  );
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
const moduleOverrides = new Map<string, Record<string, boolean>>();

async function stateDir(
  modules?: Record<string, boolean>,
  { leaf = false }: { leaf?: boolean } = {},
) {
  const dir = await tempDir("waitron-failed-start-state-");
  if (modules !== undefined) moduleOverrides.set(dir, modules);
  if (leaf) await cp(join(leafTemplate, "tls"), join(dir, "tls"), { recursive: true });
  return dir;
}

/** Tries a separate loopback bind so a leaked listener fails the probe with EADDRINUSE. */
async function bindAndRelease(port: number): Promise<void> {
  // Closing an adopted holder before probing can hide a server that never released the socket.
  const unused = reservations.get(port);
  if (!adopted.has(port) && unused?.server.listening) {
    await unused.close();
    reservations.delete(port);
  }
  const probe = await retainHttpListener("127.0.0.1", undefined, port);
  await probe.close();
}

/** Every line boot logs to stdout while `fn` runs, parsed; each chunk still reaches stdout. */
async function withLoggedLines(
  fn: () => Promise<void>,
): Promise<{ event: string; [field: string]: unknown }[]> {
  const original = process.stdout.write.bind(process.stdout);
  const lines: { event: string; [field: string]: unknown }[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      try {
        lines.push(JSON.parse(line) as { event: string });
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
  return lines;
}

/** The `event` of every line boot logs to stdout while `fn` runs. */
async function withLoggedEvents(fn: () => Promise<void>): Promise<string[]> {
  return (await withLoggedLines(fn)).map((line) => line.event);
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
    return { stop, announce: () => {}, withdraw: () => {} };
  });
  return stop;
}

async function tradingEnv(venueDir: string, state: string, { landing = false } = {}) {
  const overrides = moduleOverrides.get(state);
  if (overrides !== undefined) await seedModuleSettings(venueDir, overrides);
  const httpPort = await reservePort();
  const landingPort = landing ? await reservePort() : 0;
  return {
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_STATE_DIR: state,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_HTTP_PORT: String(httpPort),
    WAITRON_HTTP_LANDING_PORT: landing ? String(landingPort) : "0",
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    ...TILL_ENV,
  };
}

describe("a start that fails after the venue folder is opened gives the folder back", () => {
  it.each(["waiting", "busy", "shutdown"])(
    "handles the staff entrance while %s",
    async (mode) => {
      const venueDir = await seededVenueDir(),
        state = await stateDir(undefined, { leaf: true });
      const localPort = await reservePort();
      const blocker = mode === "busy" ? await retainHttpListener() : undefined;
      const staffPort = blocker?.port ?? (await reservePort());
      const material = mintSelfSignedServerCert({
        now: new Date(),
        hostnames: ["staff.example.test"],
        ipAddresses: [],
      });
      const install = async () => {
        await mkdir(join(state, "cloud"), { recursive: true });
        await writeFile(join(state, "cloud/staff.key"), material.serverKeyPem, { mode: 0o600 });
        await mkdir(join(state, "cloud"), { recursive: true });
        await writeFile(join(state, "cloud/staff.crt"), material.serverCertPem);
      };
      let workerOptions: Parameters<typeof cloudConnectionJob>[0] | undefined;
      let workerSignal!: AbortSignal;
      vi.mocked(cloudConnectionJob).mockImplementationOnce((options) => {
        workerOptions = options;
        return {
          ...realCloudJob(options),
          pass: async ({ signal }) => {
            workerSignal = signal;
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            );
            return { nextDueAt: null };
          },
        };
      });
      let refused = () => {};
      const refusal = new Promise<void>((resolve) => {
        refused = resolve;
      });
      let server: StartedServer | undefined;
      try {
        if (mode === "busy") {
          await install();
          const actual =
            await vi.importActual<typeof import("./cloud-remote.js")>("./cloud-remote.js");
          vi.mocked(startStaffListener).mockImplementationOnce((config, app, log) =>
            actual.startStaffListener(
              config,
              app,
              (...args) => {
                if (args[1] === "server.listen_failed") refused();
                log(...args);
              },
              async () => true,
            ),
          );
        }
        const lines = await withLoggedLines(async () => {
          server = await startServer({
            WAITRON_VENUE_DIR: venueDir,
            WAITRON_STATE_DIR: state,
            WAITRON_MIGRATIONS_DIR: migrationsRoot,
            WAITRON_ENV: "preproduction",
            WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
            WAITRON_CREDENTIALS_KEY_VERSION: "1",
            ...TILL_ENV,
            WAITRON_HTTP_PORT: String(localPort),
            WAITRON_HTTP_LANDING_PORT: "0",
            WAITRON_CLOUD_ORIGIN: "https://cloud.example.test",
            WAITRON_STAFF_PORT: String(staffPort),
          });
        });
        if (mode === "waiting") {
          expect(
            lines.filter(
              (line) => line.event === "server.listen_failed" && line.listener === "staff",
            ),
          ).toEqual([]);
          expect(adopted.has(staffPort)).toBe(false);
          await install();
          expect(workerOptions?.onStaffCertificate).toBeTypeOf("function");
          await withPortAdoption([staffPort], () =>
            workerOptions!.onStaffCertificate!(workerSignal),
          );
          await listening(staffPort);
          await expect(bindAndRelease(staffPort)).rejects.toMatchObject({ code: "EADDRINUSE" });
        } else if (mode === "busy") {
          await refusal;
          reservations.set(staffPort, blocker!);
          await withPortAdoption([staffPort], () =>
            workerOptions!.onStaffCertificate!(workerSignal),
          );
          await listening(staffPort);
          await expect(bindAndRelease(staffPort)).rejects.toMatchObject({ code: "EADDRINUSE" });
          const calls = vi.mocked(startStaffListener).mock.calls.length;
          await workerOptions!.onStaffCertificate!(workerSignal);
          expect(vi.mocked(startStaffListener).mock.calls.length).toBe(calls);
        } else {
          await install();
          const actual =
            await vi.importActual<typeof import("./background-duties.js")>(
              "./background-duties.js",
            );
          vi.mocked(stopBackgroundDuties).mockImplementationOnce(async (duties) => {
            await withPortAdoption([staffPort], () =>
              workerOptions!.onStaffCertificate!(workerSignal),
            );
            await actual.stopBackgroundDuties(duties);
          });
        }
        await server!.close();
        await bindAndRelease(staffPort);
      } finally {
        try {
          await server?.close();
          for (const result of vi.mocked(startStaffListener).mock.results)
            await result.value?.close();
        } finally {
          if (blocker?.server.listening && !reservations.has(staffPort)) await blocker.close();
        }
      }
    },
    60000,
  );

  it("closes the staff socket when a later boot step fails", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const localPort = await reservePort();
    const landingPort = await reservePort();
    const staffPort = await reservePort();
    const certificate = mintSelfSignedServerCert({
      now: new Date(),
      hostnames: ["staff.example.test"],
      ipAddresses: [],
    });
    await mkdir(join(state, "cloud"), { recursive: true });
    await writeFile(join(state, "cloud/staff.key"), certificate.serverKeyPem);
    await mkdir(join(state, "cloud"), { recursive: true });
    await writeFile(join(state, "cloud/staff.crt"), certificate.serverCertPem);
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    try {
      await expect(
        startServer({
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_STATE_DIR: state,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_ENV: "preproduction",
          WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
          WAITRON_CREDENTIALS_KEY_VERSION: "1",
          ...TILL_ENV,
          WAITRON_HTTP_PORT: String(localPort),
          WAITRON_HTTP_LANDING_PORT: String(landingPort),
          WAITRON_CLOUD_ORIGIN: "https://cloud.example.test",
          WAITRON_STAFF_PORT: String(staffPort),
        }),
      ).rejects.toBe(failure);
      expect(adopted.has(staffPort)).toBe(true);
      await expect(bindAndRelease(staffPort)).resolves.toBeUndefined();
    } finally {
      await vi.mocked(startStaffListener).mock.results.at(-1)?.value?.close();
    }
  }, 60_000);

  it("when a later step throws, letting go of the state folder it kept checked addresses in", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    await writeFile(join(state, PENDING_ADOPTION_FILE), "not json");
    const { letGo, folders, holders } = await spyOnCheckedAddressesLetGo(venueDir);

    await expect(startServer(await tradingEnv(venueDir, state))).rejects.toThrow(SyntaxError);
    expect(folders).toEqual([state]);
    expect(letGo).toHaveBeenCalled();
    expect(holders[0]).toBe(process.pid);
  }, 60_000);

  it("when the pending-adoption file cannot be read", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    await writeFile(join(state, PENDING_ADOPTION_FILE), "not json");

    await expect(startServer(await tradingEnv(venueDir, state))).rejects.toThrow(SyntaxError);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when an append-only trigger was replaced", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    tamper(
      venueDir,
      `drop trigger sales_append_only_update;
       create trigger sales_append_only_update before update on sales for each row begin select 1; end;`,
    );
    const env = await tradingEnv(venueDir, state);

    const outcome = await startServer(env).then(
      (server) => server,
      (error: unknown) => error,
    );
    try {
      expect(outcome).toMatchObject({
        code: "append_only.triggers_changed",
        params: { missing: [], altered: ["sales_append_only_update"] },
      });
      expect(readVenueHolder(venueDir)).toBeNull();
      await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
    } finally {
      if (isStartedServer(outcome)) {
        await listening(Number(env.WAITRON_HTTP_PORT));
        await outcome.close();
      }
    }
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

  it("when a joining spare's start cannot read its certificate, stopping its store", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir();
    await writeFile(join(state, PENDING_ADOPTION_FILE), "{}");
    const env = await tradingEnv(venueDir, state);
    const seeded = await openVenueDatabase(venueDir);
    try {
      await withNodeTransaction(seeded.node, (tx) =>
        writePairLinkTx(tx, loadKeyRing(env), TILL_ENV.WAITRON_NODE_ID, {
          role: "serves",
          state: "awaiting_copy",
          peerNodeId: "77777777-7777-4777-8777-777777777777",
          peerPublicKey: "pub",
          storeUrl: "https://box-7777.waitron.local:7443",
          venueId: "venue",
          accessKeyId: "waitron0123456789abcdef",
          secretAccessKey: "c".repeat(64),
        }),
      );
    } finally {
      await seeded.close();
    }
    const stop = vi.fn(async () => {});
    vi.mocked(startSpareStore).mockResolvedValueOnce({ loopbackUrl: "http://127.0.0.1:1", stop });

    await expect(
      startServer({
        ...env,
        WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
        WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(startSpareStore).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
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
    const env = await tradingEnv(venueDir, state);
    const store = await openVenueDatabase(venueDir);
    try {
      await withTransaction(store.venue, (tx) =>
        writeArchiveSettings(
          tx,
          loadKeyRing(env),
          {
            enabled: true,
            destinations: [{ kind: "local-fs", id: "primary", dir: backupDir }],
            schedule: { kind: "interval", ms: 3_600_000 },
            retention: { count: 7, days: 30 },
            destinationTimeoutMs: 900_000,
          },
          null,
        ),
      );
    } finally {
      await store.close();
    }

    await expect(
      startServer(
        {
          ...env,
          WAITRON_TLS_CERT_FILE: join(state, "does-not-exist.crt"),
          WAITRON_TLS_KEY_FILE: join(state, "does-not-exist.key"),
        },
        { WAITRON_BACKUP_RECOVERY_KEY: "twelve-chars!" },
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping what started", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state, { landing: true })),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const competingBind = retainHttpListener("127.0.0.1", undefined, Number(env.WAITRON_HTTP_PORT));
    try {
      await expect(competingBind).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await competingBind.then(
        (held) => held.close(),
        () => {},
      );
    }
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

    await expect(startServer(env)).rejects.toBe(failure);
    expect(readVenueHolder(venueDir)).toBeNull();
    expect(adopted.has(Number(env.WAITRON_HTTP_PORT))).toBe(true);
    await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
    const jobs = vi.mocked(createJobRunner).mock.results.at(-1)!.value.views();
    expect(jobs["card.follow_up"]?.state).toBe("stopped");
    expect(mdnsStop).toHaveBeenCalledOnce();
    expect(
      vi.mocked(createJobRunner).mock.results.at(-1)!.value.views()["cloud.connection"].state,
    ).toBe("stopped");
    expect(
      vi.mocked(createJobRunner).mock.results.at(-1)!.value.views()["backups.scheduled"].state,
    ).toBe("stopped");
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping the job runner", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const stop = await spyOnJobRunnerStop();

    const streamStop = vi.spyOn(StreamHost.prototype, "stop");
    try {
      await expect(startServer(env)).rejects.toBe(failure);
      expect(stop).toHaveBeenCalledOnce();
      expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
        streamStop.mock.invocationCallOrder[0]!,
      );
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      streamStop.mockRestore();
    }
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping the append-only watch", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const stop = await spyOnAppendOnlyWatchStop();

    await expect(startServer(env)).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping the free-space watch", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const stop = await spyOnFreeSpaceWatchStop();

    await expect(startServer(env)).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping the managers' email check", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const stop = await spyOnBoxEmailDutyStop();

    await expect(startServer(env)).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, stopping the spare-settings sender", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const stop = await spyOnSpareSettingsStop();

    await expect(startServer(env)).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledOnce();
    expect(vi.mocked(startSpareFollow).mock.results.at(-1)!.value.stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("aborts and awaits a started cloud worker when the landing listener fails", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state, { landing: true })),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    let workerSignal: AbortSignal | undefined;
    let workerStopped = false;
    let release!: () => void;
    vi.mocked(cloudConnectionJob).mockImplementationOnce((options) => ({
      ...realCloudJob(options),
      pass: async ({ signal }) => {
        workerSignal = signal;
        await new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener(
            "abort",
            () => {
              setImmediate(() => {
                workerStopped = true;
                resolve();
              });
            },
            { once: true },
          );
        });
        return { nextDueAt: null };
      },
    }));
    try {
      await expect(startServer(env)).rejects.toBe(failure);
      expect(workerSignal?.aborted).toBe(true);
      expect(workerStopped).toBe(true);
      expect(readVenueHolder(venueDir)).toBeNull();
      await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
    } finally {
      release?.();
    }
  }, 60_000);

  it("waits for the backup job when the Cloud connection job refuses to stop", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state, { landing: true })),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    vi.mocked(cloudConnectionJob).mockImplementationOnce((options) => ({
      ...realCloudJob(options),
      onStop: async () => {
        throw new Error("cloud worker stop failed");
      },
    }));
    let backupStopped = false;
    vi.mocked(backupsJob).mockImplementationOnce((...args) => {
      const job = realBackupsJob(...args);
      return {
        ...job,
        onStop: async () => {
          await new Promise((resolve) => setImmediate(resolve));
          await job.onStop?.();
          backupStopped = true;
        },
      };
    });
    await expect(startServer(env)).rejects.toBe(failure);
    expect(backupStopped).toBe(true);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("stops the Translate all runner before waiting for it", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state, { landing: true })),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const { createContentSuggestionRunner: realCreate } = await vi.importActual<
      typeof import("./content-suggestion-runner.js")
    >("./content-suggestion-runner.js");
    let runSignal: AbortSignal | undefined;
    vi.mocked(createContentSuggestionRunner).mockImplementationOnce((deps) => ({
      ...realCreate(deps),
      step: async (signal) => {
        runSignal = signal;
        await new Promise<void>((resolve) => {
          signal!.addEventListener("abort", () => resolve(), { once: true });
        });
        return "idle";
      },
    }));
    const deadline = new AbortController();
    const outcome = startServer(env).then(
      () => "started",
      (error: unknown) => error,
    );
    const stuck = delay(20_000, "the unwind waited on a runner nobody had stopped", {
      signal: deadline.signal,
    }).catch(() => "deadline cancelled");

    try {
      expect(await Promise.race([outcome, stuck])).toBe(failure);
    } finally {
      deadline.abort();
    }
    expect(createContentSuggestionRunner).toHaveBeenCalledOnce();
    expect(runSignal?.aborted).toBe(true);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("closes live events when unsubscribing from the change feed throws during failed start", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const { subscribeToChanges: realSubscribe } =
      await vi.importActual<typeof import("@waitron/db")>("@waitron/db");
    vi.mocked(subscribeToChanges).mockImplementationOnce((listener) => {
      const off = realSubscribe(listener);
      return () => {
        off();
        throw new Error("unsubscribe failed");
      };
    });
    const liveEventsClose = vi.spyOn(LiveEvents.prototype, "close");
    try {
      await expect(startServer(env)).rejects.toBe(failure);
      expect(liveEventsClose).toHaveBeenCalledOnce();
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      liveEventsClose.mockRestore();
    }
  }, 60_000);

  it("in trading mode, when a step after the listener is started throws, waiting for a sealed-state refresh before closing the store", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state, { landing: true });
    const failure = new Error("interfaces unreadable");
    failLandingAfterMdns(failure);
    const { createSealedStateRefresher: realCreate } =
      await vi.importActual<typeof import("./sealed-state.js")>("./sealed-state.js");
    // Stands in for a refresh a node.db save started just before the failure.
    let finishRefresh!: () => void;
    const refreshFinished = new Promise<void>((resolve) => (finishRefresh = resolve));
    const order: string[] = [];
    const settled = vi.fn(() => {
      order.push("settled");
      return refreshFinished;
    });
    vi.mocked(createSealedStateRefresher).mockImplementationOnce((deps) => {
      const node = deps.node;
      const onCommit = node.onCommit.bind(node);
      node.onCommit = (listener) => {
        const off = onCommit(listener);
        return () => {
          order.push("unsubscribe");
          off();
        };
      };
      return { ...realCreate(deps), settled };
    });

    let rejected = false;
    const outcome = startServer(env).then(
      () => "started",
      (error: unknown) => {
        rejected = true;
        return error;
      },
    );
    try {
      await vi.waitFor(() => expect(rejected || settled.mock.calls.length > 0).toBe(true), {
        timeout: 30_000,
      });
      expect(settled).toHaveBeenCalledOnce();
      await delay(100);
      expect(rejected).toBe(false);
      expect(readVenueHolder(venueDir)).not.toBeNull();
    } finally {
      finishRefresh();
    }
    expect(await outcome).toBe(failure);
    expect(order).toEqual(["unsubscribe", "settled"]);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("while an adoption is pending, when a step after the listener is started throws", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    await writeFile(join(state, PENDING_ADOPTION_FILE), "{}");
    const env = {
      ...(await tradingEnv(venueDir, state, { landing: true })),
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
      ...(await tradingEnv(venueDir, state, { landing: true })),
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
    async function setupEnv({ landing = false } = {}) {
      const httpPort = await reservePort();
      const landingPort = landing ? await reservePort() : 0;
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
          WAITRON_HTTP_PORT: String(httpPort),
          WAITRON_HTTP_LANDING_PORT: landing ? String(landingPort) : "0",
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
      const { venueDir, env } = await setupEnv({ landing: true });
      const failure = new Error("interfaces unreadable");
      const mdnsStop = failLandingAfterMdns(failure);

      await expect(startServer(env)).rejects.toBe(failure);
      expect(readVenueHolder(venueDir)).toBeNull();
      await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
      expect(mdnsStop).toHaveBeenCalledOnce();
    }, 60_000);
  });
});

describe("append-only triggers at boot", () => {
  it("repairs both payment guards with Payments Off, retaining payment and journal", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir({ "fiscal-none": false, payments: false }, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const store = await openVenueDatabase(venueDir);
    let before;
    try {
      const order = await seedWorkingOrder(store.venue, { source: "operator_script" });
      await store.venue.insert(payments).values({
        workingOrderId: order.id,
        source: "operator_script",
        nodeId: TILL_ENV.WAITRON_NODE_ID,
        provider: "fake",
        paymentRef: "retained",
        amount: 1000,
        state: "failed",
      });
      before = {
        payments: store.venue.all(sql`select * from payments`),
        journal: store.venue.all(sql`select * from __drizzle_migrations_payments`),
      };
      store.venue.run(sql`drop trigger payments_guard_update`);
      store.venue.run(sql`drop trigger payments_no_delete`);
    } finally {
      await store.close();
    }
    const lines = await withLoggedLines(async () => {
      const server = await startServer(env);
      try {
        await listening(Number(env.WAITRON_HTTP_PORT));
      } finally {
        await server.close();
      }
    });
    const reopened = await openVenueDatabase(venueDir);
    try {
      expect({
        payments: reopened.venue.all(sql`select * from payments`),
        journal: reopened.venue.all(sql`select * from __drizzle_migrations_payments`),
      }).toEqual(before);
      expect(
        reopened.venue.all(
          sql`select name from sqlite_master where name in ('payments_guard_update', 'payments_no_delete') order by name`,
        ),
      ).toEqual([{ name: "payments_guard_update" }, { name: "payments_no_delete" }]);
    } finally {
      await reopened.close();
    }
    expect(lines.filter((line) => line.event === "append_only.triggers_restored")).toEqual([
      expect.objectContaining({
        level: "warn",
        triggers: ["payments_guard_update", "payments_no_delete"],
      }),
    ]);
  }, 60_000);

  it("refuses an altered payment guard with Payments Off and gives the folder back", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir({ "fiscal-none": false, payments: false }, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    tamper(
      venueDir,
      "drop trigger payments_guard_update; create trigger payments_guard_update before update on payments begin select 1; end",
    );
    const outcome = await startServer(env).then(
      async (server) => {
        await server.close();
        return server;
      },
      (error: unknown) => error,
    );
    expect(outcome).toMatchObject({
      code: "append_only.triggers_changed",
      params: { missing: [], altered: ["payments_guard_update"] },
    });
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("stops running jobs before the stream when startup fails after stream registration", async () => {
    const venueDir = await seededVenueDir();
    const env = await tradingEnv(venueDir, await stateDir());
    const calls: string[] = [];
    const actual = await vi.importActual<typeof import("./job-runner.js")>("./job-runner.js");
    vi.mocked(createJobRunner).mockImplementationOnce((deps) => {
      const runner = actual.createJobRunner(deps);
      return {
        ...runner,
        stopJobs: async () => {
          calls.push("jobs");
          await runner.stopJobs();
        },
      };
    });
    const stop = StreamHost.prototype.stop;
    const stopping = vi.spyOn(StreamHost.prototype, "stop").mockImplementation(function (
      this: StreamHost,
    ) {
      calls.push("stream");
      return stop.call(this);
    });
    const failure = new Error("clock watch startup failed");
    vi.mocked(clockWatchJob).mockImplementationOnce(() => {
      throw failure;
    });
    try {
      await expect(startServer(env)).rejects.toBe(failure);
      expect(calls).toEqual(["jobs", "stream"]);
    } finally {
      stopping.mockRestore();
    }
  });

  it("a seeded venue starts, serves /health and closes", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    // The box's own self-signed leaf: what is under test is that the start was not refused.
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    let events: string[];
    try {
      events = await withLoggedEvents(async () => {
        const server = await startServer(env);
        try {
          const response = await vi.waitFor(
            () =>
              fetch(`https://127.0.0.1:${env.WAITRON_HTTP_PORT}/health`, {
                dispatcher,
              } as RequestInit),
            { timeout: 10_000 },
          );
          await response.body?.cancel();
          expect([200, 503]).toContain(response.status);
        } finally {
          await server.close();
        }
      });
    } finally {
      await dispatcher.close();
    }
    expect(readVenueHolder(venueDir)).toBeNull();
    // The control: the start's own lines were captured.
    expect(events).toContain("stream.stopped");
    expect(events).not.toContain("append_only.triggers_restored");
  }, 60_000);

  it.each([
    ["sales", "sales_append_only_delete"],
    ["verifactu_records", "verifactu_records_append_only_delete"],
  ])(
    "a %s trigger dropped while the box was off is put back and the start goes on",
    async (table, trigger) => {
      const venueDir = await seededVenueDir();
      const state = await stateDir(undefined, { leaf: true });
      tamper(venueDir, `drop trigger ${trigger};`);
      // The control: the drop took.
      expect(await triggerFaults(venueDir, [table])).toEqual({
        missing: [trigger],
        altered: [],
      });

      const env = await tradingEnv(venueDir, state);
      const lines = await withLoggedLines(async () => {
        const server = await startServer(env);
        try {
          await listening(Number(env.WAITRON_HTTP_PORT));
        } finally {
          await server.close();
        }
      });
      expect(await triggerFaults(venueDir, [table])).toEqual({ missing: [], altered: [] });
      expect(lines.filter((line) => line.event === "append_only.triggers_restored")).toEqual([
        expect.objectContaining({ level: "warn", triggers: [trigger] }),
      ]);
    },
    60_000,
  );
});

describe("which starts watch the append-only triggers", () => {
  async function startAndClose(env: Record<string, string>) {
    const server = await startServer(env);
    try {
      await listening(Number(env.WAITRON_HTTP_PORT));
    } finally {
      await server.close();
    }
  }

  it("a trading start does", async () => {
    const venueDir = await seededVenueDir();
    await startAndClose(await tradingEnv(venueDir, await stateDir(undefined, { leaf: true })));
    expect(tamperWatchJob).toHaveBeenCalledOnce();
  }, 60_000);

  it("a start waiting on an adoption does not", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    await writeFile(join(state, PENDING_ADOPTION_FILE), "{}");
    await startAndClose(await tradingEnv(venueDir, state));
    expect(tamperWatchJob).not.toHaveBeenCalled();
  }, 60_000);

  it("a setup start does not", async () => {
    const httpPort = await reservePort();
    await startAndClose({
      WAITRON_VENUE_DIR: await tempDir("waitron-failed-start-setup-venue-"),
      WAITRON_STATE_DIR: await tempDir("waitron-failed-start-setup-state-"),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_PORT: String(httpPort),
      WAITRON_HTTP_LANDING_PORT: "0",
    });
    expect(tamperWatchJob).not.toHaveBeenCalled();
  }, 60_000);
});

describe("closing a started server", () => {
  it("when stopping one background task fails, still stops the rest and gives the folder back", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = {
      ...(await tradingEnv(venueDir, state)),
      WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    };
    const failure = new Error("Cloud connection job failed to stop");
    vi.mocked(cloudConnectionJob).mockImplementationOnce((options) => ({
      ...realCloudJob(options),
      onStop: async () => {
        throw failure;
      },
    }));
    const server = await startServer(env);
    expect(readVenueHolder(venueDir)?.pid).toBe(process.pid);

    const events = await withLoggedEvents(async () => {
      await expect(server.close()).rejects.toBe(failure);
    });
    expect(server.health.readJobs?.()["card.follow_up"]?.state).toBe("stopped");
    // The last stop in trading mode's teardown.
    expect(events).toContain("stream.stopped");
    expect(readVenueHolder(venueDir)).toBeNull();
    await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
  }, 60_000);

  it("stops the menu activation and housekeeping duties", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const stop = await spyOnJobRunnerStop();
    const server = await startServer(env);
    await listening(Number(env.WAITRON_HTTP_PORT));
    const runner = vi.mocked(createJobRunner).mock.results.at(-1)!.value;
    try {
      expect(stop).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(runner.views().housekeeping?.state).toBe("waiting"));
      expect(runner.views().housekeeping?.lastRunAt).toBeNull();
      await vi.waitFor(
        () => expect(runner.views().housekeeping?.lastRunAt).toEqual(expect.any(String)),
        { timeout: 5000 },
      );
    } finally {
      await server.close();
    }
    expect(runner.views().housekeeping?.state).toBe("stopped");
    expect(stop).toHaveBeenCalledTimes(2);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("lets go of the state folder it kept checked addresses in while it still holds the venue folder", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const { letGo, folders, holders } = await spyOnCheckedAddressesLetGo(venueDir);
    const server = await startServer(env);
    await listening(Number(env.WAITRON_HTTP_PORT));
    expect(folders).toEqual([state]);
    expect(letGo).not.toHaveBeenCalled();

    await server.close();
    expect(letGo).toHaveBeenCalledOnce();
    expect(holders).toEqual([process.pid]);
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("stops the free-space watch", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const stop = await spyOnFreeSpaceWatchStop();
    const server = await startServer(env);
    await listening(Number(env.WAITRON_HTTP_PORT));
    expect(stop).not.toHaveBeenCalled();

    await server.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("stops the managers' email check", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const stop = await spyOnBoxEmailDutyStop();
    const server = await startServer(env);
    await listening(Number(env.WAITRON_HTTP_PORT));
    expect(stop).not.toHaveBeenCalled();

    await server.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("stops the spare-settings sender", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const stop = await spyOnSpareSettingsStop();
    const server = await startServer(env);
    await listening(Number(env.WAITRON_HTTP_PORT));
    expect(stop).not.toHaveBeenCalled();

    await server.close();
    expect(stop).toHaveBeenCalledOnce();
    expect(readVenueHolder(venueDir)).toBeNull();
  }, 60_000);

  it("when unsubscribing from the change feed throws, still closes live events and gives the folder back", async () => {
    const venueDir = await seededVenueDir();
    const state = await stateDir(undefined, { leaf: true });
    const env = await tradingEnv(venueDir, state);
    const failure = new Error("unsubscribe threw");
    const { subscribeToChanges: realSubscribe } =
      await vi.importActual<typeof import("@waitron/db")>("@waitron/db");
    vi.mocked(subscribeToChanges).mockImplementationOnce((listener) => {
      const off = realSubscribe(listener);
      return () => {
        off();
        throw failure;
      };
    });
    const liveEventsClose = vi.spyOn(LiveEvents.prototype, "close");

    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      server = await startServer(env);

      const settled = await Promise.race([
        server.close().then(
          () => "resolved",
          (error: unknown) => error,
        ),
        delay(15_000, "close() had not settled after 15s"),
      ]);
      expect(settled).toBe(failure);
      expect(liveEventsClose).toHaveBeenCalled();
      expect(readVenueHolder(venueDir)).toBeNull();
      await expect(bindAndRelease(Number(env.WAITRON_HTTP_PORT))).resolves.toBeUndefined();
    } finally {
      await server?.close().catch(() => {});
      liveEventsClose.mockRestore();
    }
  }, 60_000);
});

describe("settled-tender recovery boot lifetime", () => {
  it("logs the unresolved refund ids when recovery reaches its shutdown limit", async () => {
    const venueDir = await seededVenueDir();
    const env = await tradingEnv(venueDir, await stateDir(undefined, { leaf: true }));
    const refundId = "66666666-6666-4666-8666-666666666666";
    const lines: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((line) => {
      lines.push(String(line));
      return true;
    });
    vi.mocked(stopTenderRefundResolvers).mockResolvedValueOnce([refundId]);
    let server: StartedServer | undefined;
    try {
      server = await startServer(env);
      await listening(Number(env.WAITRON_HTTP_PORT));
      await server.close();
      const entries = lines
        .flatMap((line) => line.trim().split("\n"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entries.filter((entry) => entry.event === "tender_refund.shutdown_pending")).toEqual([
        {
          at: expect.any(String),
          level: "warn",
          event: "tender_refund.shutdown_pending",
          refundIds: [refundId],
        },
      ]);
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      await server?.close();
      stdout.mockRestore();
    }
  }, 60_000);

  it("awaits refund resolver shutdown when a later trading-start step fails", async () => {
    const venueDir = await seededVenueDir();
    const env = await tradingEnv(venueDir, await stateDir(undefined, { leaf: true }), {
      landing: true,
    });
    const failure = new Error("landing interfaces unavailable");
    failLandingAfterMdns(failure);
    let release = () => {};
    vi.mocked(stopTenderRefundResolvers).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const result = startServer(env).then(
      (server) => server,
      (error: unknown) => error,
    );
    const deadline = new AbortController();
    try {
      await vi.waitFor(() => expect(stopTenderRefundResolvers).toHaveBeenCalledOnce());
      expect(recoverTenderRefunds).not.toHaveBeenCalled();
      expect(await Promise.race([result, delay(50, "waiting", { signal: deadline.signal })])).toBe(
        "waiting",
      );
      expect(readVenueHolder(venueDir)?.pid).toBe(process.pid);
      release();
      expect(await result).toBe(failure);
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      deadline.abort();
      release();
      const outcome = await result;
      if (isStartedServer(outcome)) await outcome.close();
    }
  }, 60_000);
  it("stops recovery on an ordinary server close", async () => {
    const venueDir = await seededVenueDir();
    const env = await tradingEnv(venueDir, await stateDir(undefined, { leaf: true }));
    let stopped = false;
    let signal: AbortSignal | undefined;
    let release = () => {};
    let abort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      abort = resolve;
    });
    vi.mocked(recoverTenderRefunds).mockImplementationOnce((options) => {
      signal = options.stopSignal!;
      return new Promise((resolve) => {
        release = () => {
          stopped = true;
          resolve({ pending: 0, nextDueAt: null });
        };
        options.stopSignal!.addEventListener("abort", abort, { once: true });
      });
    });
    const server = await startServer(env);
    let closing: Promise<void> | undefined;
    const deadline = new AbortController();
    try {
      await listening(Number(env.WAITRON_HTTP_PORT));
      expect(recoverTenderRefunds).toHaveBeenCalledOnce();
      expect(recoverTenderRefunds).toHaveBeenCalledWith(
        expect.objectContaining({ log: expect.any(Function) }),
      );
      closing = server.close();
      await Promise.race([aborted, closing]);
      expect(signal?.aborted).toBe(true);
      expect(
        await Promise.race([
          closing.then(() => "closed"),
          delay(50, "waiting", { signal: deadline.signal }),
        ]),
      ).toBe("waiting");
      expect(readVenueHolder(venueDir)?.pid).toBe(process.pid);
      release();
      await closing;
      expect(stopped).toBe(true);
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      deadline.abort();
      release();
      if (closing !== undefined) await closing;
      else await server.close();
    }
  }, 60_000);
});

describe("pending card checks boot lifetime", () => {
  it("stops and awaits the card follow-up pass when a later boot step fails", async () => {
    const venueDir = await seededVenueDir();
    const env = await tradingEnv(venueDir, await stateDir(undefined, { leaf: true }));
    const failure = new Error("late card-loop boot failure");
    let signal: AbortSignal | undefined;
    let release = () => {};
    let markAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const define = vi.mocked(cardFollowUpJob).getMockImplementation()!;
    vi.mocked(cardFollowUpJob).mockImplementationOnce((...args) => ({
      ...define(...args),
      pass: (ctx) => {
        signal = ctx.signal;
        return new Promise((resolve) => {
          release = () => resolve({ nextDueAt: null });
          ctx.signal.addEventListener("abort", markAborted, { once: true });
        });
      },
    }));
    vi.mocked(startMdnsResponder).mockImplementationOnce(() => {
      throw failure;
    });
    const starting = startServer(env).then(
      () => "started" as const,
      (error: unknown) => error,
    );
    const deadline = new AbortController();
    try {
      await Promise.race([aborted, starting]);
      expect(cardFollowUpJob).toHaveBeenCalledOnce();
      expect(signal?.aborted).toBe(true);
      expect(
        await Promise.race([starting, delay(50, "waiting", { signal: deadline.signal })]),
      ).toBe("waiting");
      expect(readVenueHolder(venueDir)).not.toBeNull();
      release();
      expect(await starting).toBe(failure);
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      deadline.abort();
      release();
      await starting;
    }
  }, 60_000);

  it("awaits the card follow-up pass before closing its venue", async () => {
    const venueDir = await seededVenueDir();
    const env = await tradingEnv(venueDir, await stateDir(undefined, { leaf: true }));
    let signal: AbortSignal | undefined;
    let release = () => {};
    let markAborted!: () => void;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const define = vi.mocked(cardFollowUpJob).getMockImplementation()!;
    vi.mocked(cardFollowUpJob).mockImplementationOnce((...args) => ({
      ...define(...args),
      pass: (ctx) => {
        signal = ctx.signal;
        return new Promise((resolve) => {
          release = () => resolve({ nextDueAt: null });
          ctx.signal.addEventListener("abort", markAborted, { once: true });
        });
      },
    }));
    const server = await startServer(env);
    const deadline = new AbortController();
    let closing: Promise<void> | undefined;
    try {
      await listening(Number(env.WAITRON_HTTP_PORT));
      closing = server.close();
      await Promise.race([aborted, closing]);
      expect(signal?.aborted).toBe(true);
      expect(
        await Promise.race([
          closing.then(() => "closed"),
          delay(50, "waiting", { signal: deadline.signal }),
        ]),
      ).toBe("waiting");
      expect(readVenueHolder(venueDir)).not.toBeNull();
      release();
      await closing;
      expect(readVenueHolder(venueDir)).toBeNull();
    } finally {
      deadline.abort();
      release();
      await server.close();
    }
  }, 60_000);
});

it("boot gives remote dashboard files the main handover stop and request metadata", async () => {
  const venueDir = await seededVenueDir();
  const state = await stateDir();
  const dashboard = await tempDir("waitron-staff-dashboard-");
  const material = mintSelfSignedServerCert({
    now: new Date(),
    hostnames: ["staff.example.test"],
    ipAddresses: [],
  });
  await mkdir(join(state, "cloud"), { recursive: true });
  await writeFile(join(state, "cloud/staff.key"), material.serverKeyPem);
  await writeFile(join(state, "cloud/staff.crt"), material.serverCertPem);
  await writeFile(join(dashboard, "index.html"), "<html>dashboard</html>");
  await mkdir(join(dashboard, "assets"));
  await writeFile(join(dashboard, "assets/app.js"), "dashboard asset");
  let local: Hono | undefined;
  let staff: Hono | undefined;
  let gate: ReturnType<typeof handoverGates.createHandoverGate> | undefined;
  const createGate = handoverGates.createHandoverGate;
  const capture = vi.spyOn(handoverGates, "createHandoverGate").mockImplementation((...args) => {
    gate = createGate(...args);
    return gate;
  });
  const { createStaffApp } = await import("./cloud-remote.js");
  vi.mocked(startStaffListener).mockImplementationOnce(
    (config, app, log, _admitted, gates = []) => {
      staff = createStaffApp(
        app,
        async () => "https://staff.example.test",
        { root: config.dashboardAppDir!, gates },
        log,
      );
      return { close: async () => {}, isListening: () => true, checkNow: () => {} };
    },
  );
  let server: StartedServer | undefined;
  try {
    server = await startServer(
      {
        ...(await tradingEnv(venueDir, state)),
        WAITRON_DASHBOARD_APP_DIR: dashboard,
        WAITRON_CLOUD_ORIGIN: "https://cloud.example.test",
      },
      {},
      {
        observeApp: (app) => {
          local = app;
        },
      },
    );
    const open = await staff!.request("https://staff.example.test/devices", {
      headers: { accept: "text/html", "x-request-id": "remote-page" },
    });
    expect(open.status).toBe(200);
    expect(await open.text()).toBe("<html>dashboard</html>");
    const localOpen = await local!.request("/devices", { headers: { accept: "text/html" } });
    const build = open.headers.get(BUILD_HEADER);
    gate!.close({ allowed: () => false });
    const stoppedLines = await withLoggedLines(async () => {
      for (const path of ["/devices", "/assets/app.js"]) {
        const stopped = await staff!.request(`https://staff.example.test${path}`, {
          headers: { accept: "text/html", "x-request-id": "remote-stopped" },
        });
        expect(stopped.status).toBe(503);
        expect(await stopped.json()).toEqual({
          error: { code: "handover.stepping_down", params: {} },
        });
      }
      const stopped = await local!.request("/devices", {
        headers: { accept: "text/html", "x-request-id": "local-stopped" },
      });
      expect(stopped.status).toBe(503);
    });
    expect(stoppedLines.filter((line) => line.event === "http.request")).toEqual(
      ["remote-stopped", "remote-stopped", "local-stopped"].map((requestId) =>
        expect.objectContaining({
          requestId,
          level: "warn",
          status: 503,
          errorCode: "handover.stepping_down",
        }),
      ),
    );
    expect(build).not.toBeNull();
    expect(build).toBe(localOpen.headers.get(BUILD_HEADER));
    expect(open.headers.get("x-request-id")).toBe("remote-page");
  } finally {
    await server?.close();
    capture.mockRestore();
    vi.mocked(startStaffListener).mockReset();
  }
});
