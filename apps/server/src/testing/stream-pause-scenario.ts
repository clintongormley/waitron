// The stream's pause at the side-file limit, end to end, with the real pinned Litestream, the bucket
// its fixture names and sales posted to the running server's own sale route:
//   - the bucket is frozen, so every call to it goes unanswered;
//   - Litestream is killed, and the one the supervisor starts in its place holds its read
//     transaction while it waits on the frozen bucket, so nothing can restart the side file;
//   - sales grow the side file past the limit, and the supervisor stops Litestream and folds the
//     file back in the server's own write queue while three sales at a time post on one till
//     session;
//   - every sale, before, across and after the fold-back, finishes within a bound that a call
//     waiting on the frozen bucket is shown to exceed;
//   - once the bucket answers again the pause ends, streaming resumes into the same generation,
//     and a sale made while the bucket was frozen is in it.
// `stream-pause.e2e.test.ts` runs it against versitygw; `aws-stream-pause.aws-rehearsal.test.ts`
// against Amazon S3, by opt-in only.
import { cp, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { Agent } from "undici";
import { expect } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  deviceProfiles,
  devices,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { hashSecret, persons } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { locationId as brandLocationId } from "@waitron/shared";
import {
  bucketKey,
  createS3ObjectStore,
  generationPrefix,
  levelFolder,
  probeBucket,
  readPointer,
  restoreGeneration,
  TICK_MS,
  type BucketConfig,
  type ObjectStore,
  type StreamView,
} from "@waitron/stream";
import { startServer, type StartedServer } from "../boot.js";
import { loadBoxEnv } from "../box-env.js";
import { ensureBoxSecrets } from "../box-secrets.js";
import { DEVICE_COOKIE } from "../device-session.js";
import { formatEnvFile, parseEnvFile } from "../env-file.js";
import { seedTermZeroMembership } from "../membership-seed.js";
import { ALL_MODULES } from "../modules.js";
import { establishNodeIdentity } from "../node-identity.js";
import { streamSettingsPayload, type StreamHostDeps } from "../stream-host.js";
import { freePort } from "./free-ports.js";
import { stageClock, waitUntil } from "./scenario-stages.js";
import {
  framesUnderHeader,
  holdProven,
  readSideFile,
  type CheckpointProbe,
} from "./stream-pause-diagnostics.js";
import { offerProducts } from "./zone-offers.js";
import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";

const LOCALE = "es-ES";
const ADMIN_PIN = "1234";
const DEVICE_TOKEN = "stream-pause-e2e-device-token";

/**
 * Above the side file boot and the baseline sales leave with the bucket up: a 1 MiB limit paused
 * the stream while it was still opening (measured 2026-09-26). The default is 256 MiB.
 */
const WAL_LIMIT_BYTES = 16 * 1024 * 1024;

// `waitFor` checks each POINTER, RESTART, RESUME and UPLOAD wait's deadline between probes, and
// `restoreGeneration` its RESTORE_MS ceiling; the hold wait, the fill and the wait for the
// fold-back each check a deadline between sales. BOOT_MS is a budget nothing here enforces, and
// UNTIMED_MS covers migrations, provisioning and the close. A caller's timeout adds this sum,
// because Vitest's timer fails a healthy run that outlasts it (CLAUDE.md §4). The fold-back is
// waited for until the supervisor's next side-file check after the fill, TICK_MS at most, plus
// FOLD_SLACK_MS for Litestream's stop, which escalates to SIGKILL after five seconds.
const POINTER_WAIT_MS = 30_000;
const BOOT_MS = 30_000;
/** CI run 36210908359 had not reached the limit after 30 s (testing-guide.md, the pause test). */
const FILL_WAIT_MS = 180_000;
const FOLD_SLACK_MS = 15_000;
export const STREAM_PAUSE_RESUME_WAIT_MS = 30_000;
const UPLOAD_WAIT_MS = 30_000;
const RESTORE_MS = 30_000;
const UNTIMED_MS = 60_000;
const POLL_MS = 250;
/** The supervisor restarts an exited Litestream after its first backoff, one second. */
const RESTART_WAIT_MS = 10_000;
/** How long the new Litestream is given to take its read transaction, proven by probe sales. */
const HOLD_WAIT_MS = 10_000;
/**
 * With no reader holding the side file, SQLite's automatic checkpoint restarts it once it holds
 * 1,000 frames (its default; the store sets none), so twice that under one header is a second
 * sign, after the probes, that something holds it.
 */
const HELD_FRAMES = 2 * 1_000;
/**
 * How long before the supervisor's side-file check the sellers start again, so they are selling
 * at it.
 */
const LEAD_MS = 3_000;
/**
 * Sales posted at once on one till session, so sales compete for the write queue the fold-back
 * runs in.
 */
const SELLERS = 3;
/**
 * At least this many sales timed with the bucket up, and again during the pause, across the sellers.
 */
const TIMED_SALES = 10;
/** Each timed sale and the frozen-bucket control, budgeted at the bound's floor. */
const SALE_BUDGET_MS = 1_000;
export const STREAM_PAUSE_SCENARIO_MS =
  BOOT_MS +
  2 * POINTER_WAIT_MS +
  (2 * TIMED_SALES + 1) * SALE_BUDGET_MS +
  RESTART_WAIT_MS +
  HOLD_WAIT_MS +
  FILL_WAIT_MS +
  TICK_MS +
  FOLD_SLACK_MS +
  STREAM_PAUSE_RESUME_WAIT_MS +
  UPLOAD_WAIT_MS +
  RESTORE_MS +
  UNTIMED_MS;

export const STREAM_PAUSE_PHASES = [
  "probe",
  "boot",
  "baseline",
  "freeze-control",
  "restart-held",
  "fill",
  "fold-back",
  "paused-sales",
  "while-paused",
  "resume",
  "restore-sale",
] as const;
export type StreamPausePhase = (typeof STREAM_PAUSE_PHASES)[number];

export interface StreamPauseEvent {
  phase: StreamPausePhase;
  outcome: "ok" | "failed" | "skipped";
  elapsedMs: number;
}

export interface StreamPauseWhilePaused {
  /** The full key prefix the supervisor's pause check lists, the bucket's prefix included. */
  pauseListingPrefix: string;
  streamEvents(): Promise<{ event: string; [field: string]: unknown }[]>;
}

export interface StreamPauseFixture {
  bucket: BucketConfig;
  /** An existing folder the scenario may fill; the caller removes it. */
  scratch: string;
  litestreamBin: string;
  /** Aborting it closes the server at once and ends the scenario at its next wait. */
  signal?: AbortSignal;
  record?(event: StreamPauseEvent): void;
  /** Appended to the probe's failure message and the sellers' failure context. */
  describeTransport(): string;
  /** Hangs every bucket call until `resume`; the pause cannot be reached without it. */
  freeze: { pause(): Promise<void>; resume(): void };
  /** The scenario's own store, for the probe, the pointer reads and the frozen-bucket control. */
  store?: ObjectStore;
  /** Handed to the server with the side-file limit. */
  serverSeams?: Pick<StreamHostDeps, "spawn" | "store">;
  /** Called just before step 7 kills Litestream. */
  beforeRestart?(): void;
  /** Runs once the paused sales are checked, before the bucket is let run again. */
  whilePaused?(paused: StreamPauseWhilePaused): Promise<void>;
  /** Replaces how long the stream is given to resume once the bucket answers. */
  resumeWaitMs?: number;
}

/** The key prefix the supervisor's pause check lists for `generation`, as the bucket holds it. */
export function pauseListingPrefix(
  bucket: { readonly prefix: string },
  venueId: string,
  generation: string,
): string {
  return bucketKey(bucket, `${generationPrefix(venueId, generation)}${levelFolder(0)}`);
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

/**
 * One sale through the route. `walBefore` is the side file measured just before it was posted and
 * `walAfter` just after its answer; each sale's `walBefore` is the previous one's `walAfter`, so
 * back-to-back sales leave no moment outside some sale's pair.
 */
interface TimedSale {
  invoiceNumber: string;
  ms: number;
  walBefore: number;
  walAfter: number;
}

/** The `stream.*` events the server logged, from every file the log has rotated into. */
async function streamEvents(
  logDir: string,
): Promise<{ event: string; [field: string]: unknown }[]> {
  const files = (await readdir(logDir))
    .filter((name) => name.startsWith("waitron.log"))
    .sort()
    .reverse();
  const lines = (await Promise.all(files.map((name) => readFile(join(logDir, name), "utf8"))))
    .join("")
    .split("\n");
  return lines
    .filter((line) => line.includes('"event":"stream.'))
    .map((line) => JSON.parse(line) as { event: string });
}

export async function runStreamPauseScenario(fixture: StreamPauseFixture): Promise<void> {
  const { bucket, scratch, litestreamBin, signal, freeze } = fixture;
  const clock = stageClock(fixture.record, signal);
  const waitFor = <T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined>) =>
    waitUntil(what, timeoutMs, probe, signal, POLL_MS);
  const sleep = (ms: number) => delay(ms, undefined, signal === undefined ? {} : { signal });
  let server: StartedServer | undefined;
  let dispatcher: Agent | undefined;
  // The server leaves this slot before it is closed, so an abort and the finally never close it twice.
  const closeServer = async (): Promise<void> => {
    const closing = server;
    server = undefined;
    if (closing !== undefined) await closing.close();
  };
  let abortClose: Promise<void> | undefined;
  const onAbort = (): void => {
    abortClose = closeServer();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const failures: unknown[] = [];
  try {
    clock.begin("probe");
    const migrationsRoot = join(scratch, "migrations");
    const fromSource = migrationOptionsFor(manifestSets(), null);
    for (const [index, set] of manifestSets().entries()) {
      await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
        recursive: true,
      });
    }

    // 1. The bucket.
    const store = fixture.store ?? createS3ObjectStore(bucket);
    expect(
      await probeBucket(store),
      `The bucket failed the conditional-write probe. Transport: ${fixture.describeTransport()}`,
    ).toEqual({ ok: true });

    clock.begin("boot");
    // 2. A box provisioned as a setup boot leaves it, streaming switched on, plus what a till
    //    needs to ring a sale: an enrolled device and one product on offer.
    const stateDir = join(scratch, "state");
    const venueDir = join(stateDir, "venue");
    await mkdir(venueDir, { recursive: true });
    const port = await freePort();
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
      listIpv4: () => [],
    });
    const ring = loadKeyRing(parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8")));
    await applyMigrations(venueDir, fromSource);
    const seeding = await openVenueDatabase(venueDir);
    let box: {
      nodeId: string;
      seriesId: string;
      locationId: string;
      venueId: string;
      adminId: string;
      deviceId: string;
      offer: string;
    };
    try {
      await stampDeployment(seeding.venue, "preproduction");
      const venue = await applyVenue(
        planVenue(
          {
            country: "ES",
            taxId: "74000002D",
            legalName: "Stream Pause SL",
            location: {
              name: "Sala principal",
              fiscalTerritory: "ES-common",
              invoiceLocales: [LOCALE],
              operationDescription: "Venta en establecimiento",
              addressLine1: "Calle Mayor 2",
              addressLine2: null,
              postalCode: "28013",
              city: "Madrid",
              province: "Madrid",
              timeZone: "Europe/Madrid",
              dayCutover: "05:00",
            },
            seriesCode: "A",
            rectificativeSeriesCode: "R",
            admin: {
              displayName: "Administradora",
              firstNames: "Test",
              lastNames: "Operator",
              pinHash: fixturePinHash(ADMIN_PIN),
              passwordHash: fixturePasswordHash("dashPass123"),
              email: "owner@example.test",
            },
          },
          ALL_MODULES,
        ),
        { db: seeding.venue, modules: ALL_MODULES },
      );
      await establishNodeIdentity({ ownerDb: seeding.venue, ring }, venue.nodeId);
      await seedTermZeroMembership(
        { db: seeding.venue, ring },
        venue.nodeId,
        `https://127.0.0.1:${port}`,
      );
      await withTransaction(seeding.venue, (tx) =>
        putCredential(tx, ring, {
          purpose: "backup.stream",
          value: streamSettingsPayload({ venueId: venue.locationId, bucket }),
        }),
      );
      const [admin] = await seeding.venue
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));
      const [profile] = await seeding.venue
        .select({ id: deviceProfiles.id })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.formFactor, "till"));
      const [device] = await seeding.venue
        .insert(devices)
        .values({
          locationId: venue.locationId,
          deviceProfileId: profile!.id,
          label: "Caja 1",
          tokenHash: hashSecret(DEVICE_TOKEN),
        })
        .returning({ id: devices.id });
      const offer = await withTransaction(seeding.venue, async (tx) => {
        const catalogue = await createCatalogue(tx, { name: "Carta" });
        const drinks = await createCategory(tx, { name: "Bebidas" });
        const water = await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: drinks.id,
          name: "Agua",
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
        });
        await assignCatalogueToLocation(tx, brandLocationId(venue.locationId), catalogue.id);
        const offers = await offerProducts(tx, {
          locationId: brandLocationId(venue.locationId),
        });
        return offers.offerFor(water.id);
      });
      box = {
        nodeId: venue.nodeId,
        seriesId: venue.seriesIds[0]!,
        locationId: venue.locationId,
        venueId: venue.locationId,
        adminId: admin!.id,
        deviceId: device!.id,
        offer,
      };
    } finally {
      await seeding.close();
    }
    await writeFile(
      join(stateDir, "trading.env"),
      formatEnvFile({
        WAITRON_TILL_NODE_ID: box.nodeId,

        WAITRON_TILL_LOCATION_ID: box.locationId,
        WAITRON_ENV: "preproduction",
      }),
    );
    await writeFile(
      join(stateDir, "backup.env"),
      formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: "stream-pause-e2e-recovery-key" }),
    );
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );

    // 3. The server boots with a small side-file limit and opens its generation.
    server = await startServer(
      await loadBoxEnv(
        {
          WAITRON_STATE_DIR: stateDir,
          WAITRON_VENUE_DIR: venueDir,
          WAITRON_MIGRATIONS_DIR: migrationsRoot,
          WAITRON_HTTP_PORT: String(port),
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_LITESTREAM_BIN: litestreamBin,
        },
        stateDir,
      ),
      {},
      { stream: { ...fixture.serverSeams, walLimitBytes: WAL_LIMIT_BYTES } },
    );
    const running = server;
    const stream = (): StreamView => running.health.readStream();
    const pointer = await waitFor(
      "the pointer to name the box's generation",
      POINTER_WAIT_MS,
      async () => {
        const read = await readPointer(store, box.venueId);
        return read !== null && read.pointer.body.nodeId === box.nodeId ? read : undefined;
      },
    );
    const generation = pointer.pointer.body.generation;
    await waitFor("the stream to read streaming", POINTER_WAIT_MS, async () =>
      stream().state === "streaming" ? true : undefined,
    );
    const streamingSince = Date.parse((stream() as { stateSince: string }).stateSince);

    // 4. A till signs in over the box's own TLS.
    dispatcher = new Agent({
      connect: {
        ca: await readFile(join(stateDir, "tls", "ca.crt"), "utf8"),
        servername: "localhost",
      },
    });
    const base = `https://127.0.0.1:${port}`;
    const deviceCookie = `${DEVICE_COOKIE}=${box.deviceId}.${DEVICE_TOKEN}`;
    const login = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: box.adminId, pin: ADMIN_PIN }),
      dispatcher,
    } as RequestInit);
    expect(login.status, await login.clone().text()).toBe(200);
    const cookies = `${login.headers.get("set-cookie")!.split(";")[0]!}; ${deviceCookie}`;

    const walPath = join(venueDir, "venue.db-wal");
    const sell = async (walBefore: number): Promise<TimedSale> => {
      const started = performance.now();
      const response = await fetch(`${base}/api/sales`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookies },
        body: JSON.stringify({
          lines: [{ menuItemId: box.offer, quantity: "1" }],
          tender: { method: "cash", amount: "2.00" },
        }),
        dispatcher,
      } as RequestInit);
      const ms = performance.now() - started;
      const ticket = (await response.json()) as { invoiceNumber?: string };
      expect(response.status, JSON.stringify(ticket)).toBe(200);
      return {
        invoiceNumber: ticket.invoiceNumber!,
        ms,
        walBefore,
        walAfter: await fileBytes(walPath),
      };
    };
    const slowest = (sales: TimedSale[]) => Math.max(...sales.map((sale) => sale.ms));
    /**
     * SELLERS sellers posting back to back on one till session, starting from a side file
     * measured at `walStart`, until `done` holds for one sale; each seller then finishes the sale
     * it has in flight. Answers each seller's sales in order.
     */
    const sellAtOnce = async (
      walStart: number,
      done: (sale: TimedSale, sold: number) => boolean,
      deadline?: { at: number; what: string },
      beforeEachSale?: () => Promise<void>,
    ): Promise<TimedSale[][]> => {
      const began = Date.now();
      let sold = 0;
      let stop = false;
      let saleMs = 0;
      let slowestSaleMs = 0;
      let gateWaitMs = 0;
      const report = (event: "start" | "progress" | "failed" | "finished") => {
        console.log(
          "stream pause sellers",
          JSON.stringify({
            event,
            phase: deadline?.what ?? "timed sales",
            elapsedMs: Date.now() - began,
            sold,
            saleMs,
            slowestSaleMs,
            gateWaitMs,
            wal: readSideFile(walPath),
            stream: stream(),
          }),
        );
      };
      report("start");
      const progress = setInterval(() => report("progress"), 10_000);
      const sellers = Array.from({ length: SELLERS }, async () => {
        const mine: TimedSale[] = [];
        let walBefore = walStart;
        while (!stop) {
          const gateStarted = performance.now();
          await beforeEachSale?.();
          gateWaitMs += performance.now() - gateStarted;
          if (stop) break;
          if (deadline !== undefined && Date.now() > deadline.at) {
            stop = true;
            throw new Error(
              `timed out waiting for ${deadline.what}: the stream reads ${JSON.stringify(stream())}, the side file ${walBefore} bytes, ` +
                `${sold} sales in ${Date.now() - began} ms from ${walStart} bytes`,
            );
          }
          const sale = await sell(walBefore);
          mine.push(sale);
          sold += 1;
          saleMs += sale.ms;
          slowestSaleMs = Math.max(slowestSaleMs, sale.ms);
          walBefore = sale.walAfter;
          if (done(sale, sold)) stop = true;
        }
        return mine;
      });
      try {
        return await Promise.all(sellers);
      } catch (error) {
        stop = true;
        report("failed");
        try {
          console.error(
            "stream pause failure context",
            JSON.stringify({
              events: (await streamEvents(join(stateDir, "logs"))).slice(-20),
              s3: fixture.describeTransport(),
            }),
          );
        } catch (contextError) {
          console.error("stream pause context unavailable", {
            errorCode: (contextError as NodeJS.ErrnoException).code ?? "unreadable",
          });
        }
        throw error;
      } finally {
        clearInterval(progress);
        await Promise.allSettled(sellers);
        report("finished");
      }
    };
    const crosses = (sale: TimedSale) =>
      sale.walBefore >= WAL_LIMIT_BYTES && sale.walAfter < WAL_LIMIT_BYTES;
    /** The supervisor measures the side file every TICK_MS from the moment it began streaming. */
    const checkAfter = (at: number) =>
      streamingSince + TICK_MS * Math.max(1, Math.ceil((at - streamingSince) / TICK_MS));

    clock.begin("baseline");
    // 5. Sales with the bucket answering set the bound: a sale that waited on the frozen bucket
    //    would hang with it, so the bound sits far below that and far above a healthy sale.
    const baseline = (
      await sellAtOnce(await fileBytes(walPath), (_, sold) => sold >= TIMED_SALES)
    ).flat();
    const bound = Math.max(SALE_BUDGET_MS, 5 * slowest(baseline));
    expect(
      await fileBytes(walPath),
      "the side file reached the limit before the bucket was frozen",
    ).toBeLessThan(WAL_LIMIT_BYTES);

    clock.begin("freeze-control");
    // 6. The bucket freezes, so every call to it goes unanswered while it is frozen.
    //    The control: a call that does wait on the bucket is still unanswered at the bound.
    await freeze.pause();
    expect(
      await Promise.race([
        store.list("").then(
          () => "answered",
          () => "refused",
        ),
        delay(bound).then(() => "unanswered"),
      ]),
    ).toBe("unanswered");

    clock.begin("restart-held");
    // 7. Litestream is killed, and the supervisor starts a new one against the frozen bucket. The
    //    new one takes its read transaction, then waits on the bucket in its start-up check
    //    (`init` in Litestream 0.5.17's `db.go`), so nothing can restart the side file; a running
    //    Litestream keeps checkpointing locally without the bucket, restarting the side file. Probe
    //    sales then wait until a reader is seen holding the side file, so the fill starts held.
    const logDir = join(stateDir, "logs");
    const pidPath = join(stateDir, "stream", "litestream.pid");
    const readPid = async () => {
      const pid = Number.parseInt(await readFile(pidPath, "utf8").catch(() => ""), 10);
      return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
    };
    const exits = async () =>
      (await streamEvents(logDir)).filter((line) => line.event === "stream.litestream_exited")
        .length;
    const firstLitestream = await readPid();
    expect(firstLitestream, "no Litestream PID recorded").toBeDefined();
    const exitsBefore = await exits();
    fixture.beforeRestart?.();
    process.kill(firstLitestream!, "SIGKILL");
    await waitFor("the supervisor to start a new Litestream", RESTART_WAIT_MS, async () => {
      const pid = await readPid();
      return pid !== undefined && pid !== firstLitestream && (await exits()) > exitsBefore
        ? pid
        : undefined;
    });
    const probes: CheckpointProbe[] = [];
    const probeDb = new DatabaseSync(join(venueDir, "venue.db"), { timeout: 5_000 });
    try {
      const holdDeadline = Date.now() + HOLD_WAIT_MS;
      for (;;) {
        signal?.throwIfAborted();
        await sell(await fileBytes(walPath));
        // Unlike during the fill, a checkpoint is allowed here: the fill's checks have not begun.
        probes.push(
          probeDb.prepare("pragma wal_checkpoint(passive)").get() as unknown as CheckpointProbe,
        );
        if (holdProven(probes.at(-2), probes.at(-1)!)) break;
        if (Date.now() >= holdDeadline) {
          throw new Error(
            `no reader held the side file within ${HOLD_WAIT_MS} ms of the new Litestream ` +
              `starting: each passive checkpoint after a sale reached ${JSON.stringify(probes)}`,
          );
        }
        await sleep(POLL_MS);
      }
    } finally {
      probeDb.close();
    }
    console.log("stream pause: a reader holds the side file", JSON.stringify({ probes }));

    clock.begin("fill");
    // 8. Sales grow the side file past the limit while the new Litestream holds its read
    //    transaction; a restart of the side file from the fill's first sale fails it at once. A
    //    supervisor measurement landing after the fill passed the limit but before step 9 would
    //    pause the stream early, so near one the sellers post nothing from `bound` plus LEAD_MS
    //    before it until LEAD_MS after it. That holds while each sale beats the bound, as step 10
    //    asserts, and the measurement is less than LEAD_MS late.
    const fillStarted = Date.now();
    const walAtFill = await fileBytes(walPath);
    expect(walAtFill, "the side file reached the limit before the fill").toBeLessThan(
      WAL_LIMIT_BYTES,
    );
    const atFill = readSideFile(walPath).header;
    expect(atFill, "the probe sales wrote frames, so the side file has a header").not.toBeNull();
    console.log("stream pause: the side file at the fill's start", JSON.stringify(atFill));
    let held: { checkpointSequence: number; salt: string } | undefined;
    let framesSeen = framesUnderHeader(walPath);
    const checkHeld = (): void => {
      const header = readSideFile(walPath).header;
      if (
        header?.checkpointSequence !== atFill!.checkpointSequence ||
        header.salt !== atFill!.salt
      ) {
        throw new Error(
          `the side file was restarted during the fill: something is still checkpointing ` +
            `(at the fill's start ${JSON.stringify(atFill)}, now ${JSON.stringify(header)}; ` +
            `${framesSeen} frames under the fill's header at the last check, ` +
            `${Date.now() - fillStarted} ms into the fill)`,
        );
      }
      const frames = (framesSeen = framesUnderHeader(walPath));
      if (held === undefined && frames !== null && frames >= HELD_FRAMES) {
        held = { checkpointSequence: header.checkpointSequence, salt: header.salt };
        console.log(
          "stream pause: the side file is held",
          JSON.stringify({ ...held, frames, elapsedMs: Date.now() - fillStarted }),
        );
      }
    };
    const filling = (
      await sellAtOnce(
        walAtFill,
        (sale) => {
          checkHeld();
          return sale.walAfter >= WAL_LIMIT_BYTES;
        },
        { at: fillStarted + FILL_WAIT_MS, what: "the side file to reach the limit" },
        async () => {
          const check = checkAfter(Date.now());
          if (check - Date.now() < bound + LEAD_MS) {
            await sleep(Math.max(0, check + LEAD_MS - Date.now()));
          }
        },
      )
    ).flat();
    const fillMs = Date.now() - fillStarted;
    expect(held, "the fill ended before the side file was seen held").toBeDefined();
    expect(stream().state).toBe("streaming");

    clock.begin("fold-back");
    // 9. The sellers start again just before the supervisor's next measurement and sell until one
    //    of them sees the file folded back: the only thing in the server's own code that shrinks
    //    it is the stream's fold-back (`checkpointTruncate`, from `stream-host.ts`). Each seller's
    //    sales tile the time it sold, so each has exactly one sale whose two measurements straddle
    //    the fold-back.
    const nextCheck = checkAfter(Date.now());
    await sleep(Math.max(0, nextCheck - LEAD_MS - Date.now()));
    const walAtLead = await fileBytes(walPath);
    expect(
      walAtLead,
      "the side file was folded back before the sellers resumed",
    ).toBeGreaterThanOrEqual(WAL_LIMIT_BYTES);
    const folding = await sellAtOnce(walAtLead, crosses, {
      at: nextCheck + FOLD_SLACK_MS,
      what: "the fold-back",
    });
    const foldSeenMs = Date.now() - nextCheck;
    const across = folding.map((seller) => seller.filter(crosses));
    expect(across.map((sales) => sales.length)).toEqual(Array<number>(SELLERS).fill(1));
    expect(stream()).toMatchObject({ state: "paused", reason: "side_file_limit", generation });

    clock.begin("paused-sales");
    // 10. Sales while paused: Litestream is stopped and the supervisor is waiting on its question
    //     to the frozen bucket, which holds the pause.
    const duringPause = (
      await sellAtOnce(await fileBytes(walPath), (_, sold) => sold >= TIMED_SALES)
    ).flat();
    expect(stream()).toMatchObject({ state: "paused", generation });

    const frozen = [...filling, ...folding.flat()];
    console.log(
      `stream pause timings (ms), ${SELLERS} sellers on one till session: slowest of ${baseline.length} with the bucket up ${slowest(baseline).toFixed(0)}; ` +
        `the fill ${filling.length} sales from ${walAtFill} to ${Math.max(...filling.map((sale) => sale.walAfter))} bytes in ${fillMs}; ` +
        `slowest of ${frozen.length} frozen before the pause ${slowest(frozen).toFixed(0)}; ` +
        `the sales across the fold-back ${across
          .flat()
          .map((sale) => `${sale.ms.toFixed(0)} (${sale.walBefore} -> ${sale.walAfter} bytes)`)
          .join(", ")}, the last answered ${foldSeenMs} after the expected measurement; ` +
        `slowest of ${duringPause.length} during the pause ${slowest(duringPause).toFixed(0)}; bound ${bound.toFixed(0)}`,
    );
    expect(slowest(frozen)).toBeLessThan(bound);
    expect(slowest(duringPause)).toBeLessThan(bound);
    const frozenSale = Math.max(
      ...duringPause.map((sale) => Number(sale.invoiceNumber.split("/")[1])),
    );

    clock.begin("while-paused");
    if (fixture.whilePaused === undefined) {
      clock.end("skipped");
    } else {
      await fixture.whilePaused({
        pauseListingPrefix: pauseListingPrefix(bucket, box.venueId, generation),
        streamEvents: () => streamEvents(logDir),
      });
    }

    clock.begin("resume");
    // 11. The bucket answers again: the pause ends, Litestream restarts into the same generation,
    //     and a sale made while the bucket was frozen and Litestream stopped reaches it.
    freeze.resume();
    const resumedAt = performance.now();
    await waitFor(
      "the stream to resume",
      fixture.resumeWaitMs ?? STREAM_PAUSE_RESUME_WAIT_MS,
      async () => (stream().state === "streaming" ? true : undefined),
    );
    console.log(
      `stream pause: streaming again ${(performance.now() - resumedAt).toFixed(0)} ms after the bucket was let run`,
    );
    expect(stream()).toMatchObject({ state: "streaming", reason: null, generation });
    expect((await readPointer(store, box.venueId))?.pointer.body.generation).toBe(generation);

    clock.begin("restore-sale");
    await waitFor(
      "the sale made while frozen to reach the generation",
      UPLOAD_WAIT_MS,
      async () => {
        const out = join(await mkdtemp(join(scratch, "probe-")), "venue.db");
        try {
          await restoreGeneration({
            litestreamBin,
            bucket,
            venueId: box.venueId,
            generation,
            outPath: out,
            ceilingMs: RESTORE_MS,
            onFailure: ({ exitCode, output, abandoned }) => {
              console.error(
                `stream pause restore probe: exitCode=${exitCode}, abandoned=${abandoned}, Litestream output:\n${output}`,
              );
            },
          });
        } catch (error) {
          console.error("stream pause restore probe failed:", error);
          throw error;
        }
        const db = new DatabaseSync(out);
        try {
          return db
            .prepare("select 1 as hit from sales where series_id = ? and invoice_number = ?")
            .get(box.seriesId, frozenSale) === undefined
            ? undefined
            : true;
        } finally {
          db.close();
        }
      },
    );

    // 12. One pause in the whole run, at this limit, and it ended; the only Litestream exit since
    //     step 7 is the kill's.
    const events = await streamEvents(logDir);
    const paused = events.filter((line) => line.event === "stream.paused");
    expect(paused).toEqual([expect.objectContaining({ generation, limitBytes: WAL_LIMIT_BYTES })]);
    expect(events.map((line) => line.event).slice(events.indexOf(paused[0]!))).toContain(
      "stream.resumed",
    );
    expect(await exits()).toBe(exitsBefore + 1);
    clock.end("ok");
  } catch (error) {
    clock.end("failed");
    failures.push(error);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Each runs even when an earlier one rejects.
    for (const cleanup of [
      async () => {
        freeze.resume();
      },
      async () => {
        if (abortClose !== undefined) await abortClose;
      },
      closeServer,
      async () => {
        if (dispatcher !== undefined) await dispatcher.close();
      },
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "stream pause failed");
}
