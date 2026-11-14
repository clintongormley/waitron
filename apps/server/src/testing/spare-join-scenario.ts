// A main box M and a spare S, both started in this process: M is provisioned as the stream loop
// provisions its box, and S starts from an empty state folder, so it boots in setup mode.
// `spare-join.e2e.test.ts` runs it against versitygw.
import { randomUUID, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Socket } from "node:net";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect } from "vitest";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import {
  invoiceSeries,
  nodes,
  openVenueDatabase,
  readNodeMembership,
  withTransaction,
  type VenueDatabase,
} from "@waitron/db";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { loginWithPin } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { readPairLink } from "@waitron/node-db";
import { nodeId as brandNodeId, PERSON_HEADER } from "@waitron/shared";
import type { VenueRequest } from "@waitron/provisioning";
import { createS3ObjectStore, readPointer, type BucketConfig } from "@waitron/stream";
import { BOX_HOSTNAME, boxHostnameFor, ownContactUrl } from "../box-name.js";
import { loadBoxEnv } from "../box-env.js";
import { startServer, type StartServerSeams, type StartedServer } from "../boot.js";
import { DEVICE_COOKIE } from "../device-session.js";
import { PENDING_ADOPTION_FILE } from "../finish-adoption.js";
import type { BoxLookup } from "../mirror-bundle-fetch.js";
import { ALL_MODULES } from "../modules.js";
import { SESSION_COOKIE } from "../till-session.js";
import type { TradingContext } from "../trading-context.js";
import {
  POLL_INTERVAL_MS,
  POLL_TRIES,
  fetchHealthOk,
  httpsVia,
  withCapturedStdout,
  type LogLine,
} from "./boot-harness.js";
import { enrolDeviceForTest } from "./enrol.js";
import { freePorts } from "./free-ports.js";
import { fixturePasswordHash, fixturePinHash } from "./known-secret-hashes.js";
import { settleWithin } from "./settle-within.js";
import { stageClock, waitUntil, type StageEvent } from "./scenario-stages.js";
import { BASIC_ACTIONS } from "./session-device.js";
import {
  bootEnv,
  boxDirs,
  copyMigrations,
  provisionStreamBox,
  type BoxDirs,
} from "./stream-box.js";
import { synchronisedBoxHost } from "./synchronised-box-host.js";
import { offerProducts } from "./zone-offers.js";

const RECOVERY_KEY = "spare-join-e2e-recovery-key";
const MODULES_M = { modules: { "fiscal-verifactu": false } };
const LOCALE_M = "en-GB";
const ADMIN = { email: "owner@example.test", password: "dashPass123" };
/** A taxpayer whose territory selects `fiscal-none`, the one fiscal module `MODULES_M` leaves on. */
const VENUE_M: VenueRequest = {
  country: "GB",
  taxId: "GB100000001",
  legalName: "Spare Join Ltd",
  name: "Main room",
  fiscalTerritory: "GB-vat",
  invoiceLocales: [LOCALE_M],
  operationDescription: "Sale on premises",
  addressLine1: "1 High Street",
  addressLine2: null,
  postalCode: "EC1A 1AA",
  city: "London",
  province: "London",
  timeZone: "Europe/London",
  dayCutover: "05:00",
  seriesCode: "A",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Administrator",
    firstNames: "Test",
    lastNames: "Operator",
    pinHash: fixturePinHash("1234"),
    passwordHash: fixturePasswordHash(ADMIN.password),
    email: ADMIN.email,
  },
};
const STAFF_PIN = "5555";
/** Adopting restarts S once, into the start that takes the first copy. */
const SPARE_RESTARTS_AT_ADOPT = 1;
/**
 * Then S restarts twice: once the first copy is ready, into the start that places it and finishes
 * joining, and once joining has finished, into the mirror's start.
 */
const SPARE_RESTARTS_AFTER_FIRST_COPY = 2;

// A caller's timeout adds this sum (CLAUDE.md §4). BOOT_MS is per start; UNTIMED_MS, for
// migrations, provisioning and closes, is a budget nothing here enforces; the health wait is
// `fetchHealthOk`'s poll budget. S starts four times: setup, the latch start that takes the copy,
// the start that places it and finishes joining, and the mirror's; M starts three times: first, in
// the middle of S's join, and for the start check.
const BOOT_MS = 30_000;
const HEALTH_MS = POLL_TRIES * POLL_INTERVAL_MS;
const UNTIMED_MS = 60_000;
const POINTER_WAIT_MS = 30_000;
// The main box asks the spare's store and the spare its own store every 5 seconds.
const LINK_WAIT_MS = 60_000;
const COPY_WAIT_MS = 120_000;
const MIRROR_WAIT_MS = 60_000;
const WAIT_POLL_MS = 250;
export const SPARE_JOIN_SCENARIO_MS =
  7 * BOOT_MS +
  3 * HEALTH_MS +
  POINTER_WAIT_MS +
  LINK_WAIT_MS +
  COPY_WAIT_MS +
  MIRROR_WAIT_MS +
  UNTIMED_MS;

export const SPARE_JOIN_PHASES = [
  "probe",
  "spare-refused",
  "bucket-stopped",
  "spare-join",
  "main-restart-mid-join",
  "spare-copy",
  "start-check",
  "loopback-only",
] as const;
export type SpareJoinPhase = (typeof SPARE_JOIN_PHASES)[number];
export type SpareJoinEvent = StageEvent<SpareJoinPhase>;

export interface SpareJoinFixture {
  bucket: BucketConfig;
  /** An existing folder the scenario may fill; the caller removes it. */
  scratch: string;
  litestreamBin: string;
  versitygwBin: string;
  /** Aborting it closes both servers at once and ends the scenario at its next phase. */
  signal?: AbortSignal;
  record?(event: SpareJoinEvent): void;
}

/** Every `.local` name is this process's loopback: both boxes listen on 127.0.0.1. */
const loopbackLookup: BoxLookup = async (hostname) => {
  if (!hostname.endsWith(".local")) throw new Error(`no test address for ${hostname}`);
  return { addresses: ["127.0.0.1"], remembered: false };
};

function isLoopback(address: string): boolean {
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

/**
 * What TCP `net.Socket` connects on this thread were asked to reach, until `stop`: a host given as
 * an address, a name other than `localhost` (so an outside name counts whether or not it resolves),
 * the address a lookup answered, and each connected address and port. UDP, worker threads and
 * child processes are outside it.
 */
function watchConnections(): {
  addresses: Set<string>;
  connected: { address: string; port: number }[];
  stop(): void;
} {
  const original = Socket.prototype.connect;
  const addresses = new Set<string>();
  const connected: { address: string; port: number }[] = [];
  Socket.prototype.connect = function (this: Socket, ...args: unknown[]) {
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const host =
      typeof first === "object" && first !== null ? (first as { host?: unknown }).host : args[1];
    if (typeof host === "string" && host !== "localhost") addresses.add(host);
    this.once("lookup", (error: Error | null, address: string) => {
      if (error === null && typeof address === "string") addresses.add(address);
    });
    this.once("connect", () => {
      if (this.remoteAddress === undefined) return;
      addresses.add(this.remoteAddress);
      if (this.remotePort !== undefined)
        connected.push({ address: this.remoteAddress, port: this.remotePort });
    });
    return (original as (...a: unknown[]) => Socket).apply(this, args);
  } as typeof original;
  return {
    addresses,
    connected,
    stop: () => {
      Socket.prototype.connect = original;
    },
  };
}

class ClosedWhileStarting extends Error {}

/** Settles as `starting` does, or throws once it has run `BOOT_MS` unsettled. */
async function boundedStart(starting: Promise<void>, what: string): Promise<void> {
  if (!(await settleWithin(starting, BOOT_MS)))
    throw new Error(`${what} did not finish within ${BOOT_MS} ms`);
  await starting;
}

/**
 * One box's server, started again in place whenever it asks to restart: the `restart` seam closes
 * it and starts it on the same folders and environment.
 */
export class TestBox {
  server: StartedServer | undefined;
  /** How many restarts the box asked for, or the test asked of it. */
  restarts = 0;
  /** Every name this box's servers asked the injected lookup for, in order. */
  readonly lookups: string[] = [];
  private starting: Promise<void> | undefined;
  private restarting: Promise<void> | undefined;
  private restartFailure: unknown;
  private lateCloseFailure: unknown;
  private closed = false;

  constructor(
    readonly dirs: BoxDirs,
    readonly port: number,
    private readonly env: NodeJS.ProcessEnv,
    private readonly seams: StartServerSeams,
  ) {}

  get origin(): string {
    return `https://${BOX_HOSTNAME}:${this.port}`;
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(this.closedWhileStarting());
    const starting = this.boot();
    this.starting = starting.catch(() => {});
    return starting;
  }

  private async boot(): Promise<void> {
    const server = await startServer(
      await loadBoxEnv(this.env, this.dirs.state),
      {},
      {
        ...this.seams,
        boxLookup: (hostname, ask) => {
          this.lookups.push(hostname);
          return loopbackLookup(hostname, ask);
        },
        restart: () => void this.restart(),
      },
    );
    if (this.closed) {
      // `close` may already have finished, so nothing else would close this server.
      try {
        await server.close();
      } catch (error) {
        this.lateCloseFailure = error;
      }
      throw this.closedWhileStarting();
    }
    this.server = server;
  }

  private closedWhileStarting(): ClosedWhileStarting {
    return new ClosedWhileStarting(`the box on port ${this.port} was closed while it started`);
  }

  /** Settles once this restart, and every one asked for before it, has finished. */
  restart(): Promise<void> {
    // As production's restart does nothing once shutdown is under way.
    if (this.closed) return Promise.resolve();
    this.restarts += 1;
    const previous = this.restarting ?? Promise.resolve();
    this.restarting = previous.then(async () => {
      const server = this.server;
      this.server = undefined;
      try {
        await server?.close();
        if (this.closed) return;
        await this.start();
      } catch (error) {
        if (!(error instanceof ClosedWhileStarting)) this.restartFailure ??= error;
      }
    });
    return this.restarting;
  }

  /**
   * Restarts the box as its own restart seam would, and throws what the restart failed with, or
   * that it did not finish within `BOOT_MS`.
   */
  async restartNow(): Promise<void> {
    await boundedStart(this.restart(), `the box on port ${this.port}'s restart`);
    const failure = this.restartFailure;
    this.restartFailure = undefined;
    if (failure !== undefined) throw failure;
    if (this.server === undefined) throw new Error(`the box on port ${this.port} did not start`);
  }

  /**
   * Settles a pending restart and a pending start, then closes the server; returns what failed, the
   * restart's failure first. It waits for a start however long it runs.
   */
  async close(): Promise<unknown[]> {
    this.closed = true;
    const failures: unknown[] = [];
    await this.restarting;
    await this.starting;
    if (this.restartFailure !== undefined) failures.push(this.restartFailure);
    if (this.lateCloseFailure !== undefined) failures.push(this.lateCloseFailure);
    const server = this.server;
    this.server = undefined;
    try {
      await server?.close();
    } catch (error) {
      failures.push(error);
    }
    return failures;
  }
}

/** Closes every box at once, emptying `boxes`; returns every box's failures. */
export async function closeBoxes(boxes: TestBox[]): Promise<unknown[]> {
  const closing = await Promise.allSettled(boxes.splice(0).map((box) => box.close()));
  return closing.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [result.reason],
  );
}

/** What a till on M needs to ring a counter sale through M's own routes. */
interface CounterTill {
  personId: string;
  cookie: string;
  menuItemId: string;
  zoneId: string;
}

/**
 * One product offered at a counter, one staff member and one enrolled till signed in by PIN, written
 * into M's database before M starts.
 */
async function seedCounterTill(
  venueDir: string,
  box: { nodeId: string; locationId: string },
): Promise<CounterTill> {
  const store = await openVenueDatabase(venueDir);
  try {
    const db = store.venue;
    const cfg = {
      nodeId: brandNodeId(box.nodeId),
      locationId: box.locationId,
      locale: LOCALE_M,
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
    } as unknown as TradingContext;
    const seeded = await withTransaction(db, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Counter menu" });
      const category = await createCategory(tx, { name: "Drinks" });
      const product = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: "Coffee",
        customerName: { [LOCALE_M]: "Flat white" },
        kitchenName: "FLATW",
        pricingUnit: "each",
        unitPrice: "3.00",
        vatClass: "general",
      });
      await assignCatalogueToVenue(tx, catalogue.id);
      const offers = await offerProducts(tx, cfg, { zone: "counter" });
      const [person] = await seedPersons(tx, {
        displayName: "Sam",
        pinHash: fixturePinHash(STAFF_PIN),
        role: "staff",
      });
      const [profile] = await seedDeviceProfiles(tx, {
        name: "Counter till",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
      });
      return {
        personId: person!.id,
        profileId: profile!.id,
        menuItemId: offers.offerFor(product.id),
        zoneId: offers.zoneId,
      };
    });
    const device = await enrolDeviceForTest(db, cfg, {
      name: "Counter",
      profileId: seeded.profileId,
    });
    const session = await withTransaction(db, (tx) =>
      loginWithPin(tx, { deviceId: device.deviceId, personId: seeded.personId, pin: STAFF_PIN }),
    );
    return {
      personId: seeded.personId,
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
      menuItemId: seeded.menuItemId,
      zoneId: seeded.zoneId,
    };
  } finally {
    await store.close();
  }
}

/** `read` over the box's databases in `venueDir`, opened without the venue lock its server holds. */
async function readOutside<T>(
  venueDir: string,
  read: (store: VenueDatabase) => Promise<T>,
): Promise<T> {
  const store = await openVenueDatabase(venueDir, { exclusive: false });
  try {
    return await read(store);
  } finally {
    await store.close();
  }
}

/** What a refused join must leave alone on M: its chart, its `nodes` and series rows, its link. */
function joinState(venueDir: string, nodeId: string): Promise<unknown> {
  return readOutside(venueDir, async (store) => {
    const chart = await readNodeMembership(store.venue);
    return {
      chart: chart === null ? null : chart.body,
      nodes: await store.venue.select({ id: nodes.id }).from(nodes).orderBy(nodes.id),
      series: await store.venue
        .select({ id: invoiceSeries.id, nodeId: invoiceSeries.nodeId })
        .from(invoiceSeries)
        .orderBy(invoiceSeries.id),
      link: await readPairLink(store.node, nodeId),
    };
  });
}

/** The first row `sql` answers in `venueDir`'s `venue.db`, opened read-only. */
function firstRowIn(venueDir: string, sql: string, ...params: SQLInputValue[]) {
  const db = new DatabaseSync(join(venueDir, "venue.db"), { readOnly: true });
  try {
    return db.prepare(sql).get(...params);
  } finally {
    db.close();
  }
}

/** The public key `venue.db`'s `nodes` row holds for `nodeId`. */
function nodeKeyIn(venueDir: string, nodeId: string) {
  return firstRowIn(venueDir, "select public_key from nodes where id = ?", nodeId)?.public_key;
}

/** Whether `venue.db` holds the sale of `workingOrderId`, its idempotency key. */
function saleOf(venueDir: string, workingOrderId: string): boolean {
  return (
    firstRowIn(venueDir, "select 1 from sales where working_order_id = ?", workingOrderId) !==
    undefined
  );
}

/** The logger's JSON lines among `lines`. */
function logLines(lines: readonly string[]): LogLine[] {
  return lines.flatMap((text) => {
    try {
      const parsed = JSON.parse(text) as unknown;
      return typeof parsed === "object" && parsed !== null ? [parsed as LogLine] : [];
    } catch {
      return [];
    }
  });
}

function describeError(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
  const detail = cause === undefined ? "" : ` (${String(cause.code ?? cause.message)})`;
  return `${String(error)}${detail}`;
}

export function runSpareJoinScenario(fixture: SpareJoinFixture): Promise<void> {
  return withCapturedStdout((log) => runCaptured(fixture, log));
}

/** The scenario, with `log` holding every line this process writes to stdout as it arrives. */
async function runCaptured(fixture: SpareJoinFixture, log: readonly string[]): Promise<void> {
  const { bucket, scratch, signal } = fixture;
  const clock = stageClock(fixture.record, signal);
  const sockets = watchConnections();
  let releaseCopy = (): void => {};
  const copyHold = new Promise<void>((resolve) => {
    releaseCopy = resolve;
  });
  const boxes: TestBox[] = [];
  let closeViaM: (() => Promise<void>) | undefined;
  let closeViaS: (() => Promise<void>) | undefined;
  const closeAll = (): Promise<unknown[]> => closeBoxes(boxes);
  let abortClose: Promise<unknown[]> | undefined;
  const onAbort = (): void => {
    abortClose = closeAll();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const failures: unknown[] = [];
  const wait = <T>(what: string, ms: number, probe: () => Promise<T | undefined>) =>
    waitUntil(what, ms, probe, signal, WAIT_POLL_MS);
  const parsed: LogLine[] = [];
  let parsedUpTo = 0;
  /** The logger's lines so far, each parsed once. */
  const logSoFar = (): LogLine[] => {
    parsed.push(...logLines(log.slice(parsedUpTo)));
    parsedUpTo = log.length;
    return parsed;
  };
  /** The log's lines from `from` on, so a line written before a phase cannot satisfy it. */
  const linesSince = (from: number): LogLine[] => logSoFar().slice(from);
  try {
    clock.begin("probe");
    const migrationsRoot = await copyMigrations(scratch);
    // One draw: M's and S's HTTPS ports, then S's store and its versitygw's loopback port.
    const [portM, portS, storeS, storeLoopbackS] = (await freePorts(4)) as [
      number,
      number,
      number,
      number,
    ];
    const boxEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      ...bootEnv(dirs, port, migrationsRoot, fixture.litestreamBin),
      WAITRON_VERSITYGW_BIN: fixture.versitygwBin,
      // The advertised origin: each box puts its own name in place of `waitron.local`.
      WAITRON_MANAGEMENT_ORIGIN: `https://${BOX_HOSTNAME}:${port}`,
      WAITRON_MANAGEMENT_RP_ID: BOX_HOSTNAME,
    });

    const dirsM = await boxDirs(scratch, "box-m");
    const m = await provisionStreamBox({
      dirs: dirsM,
      advertisedOrigin: `https://${BOX_HOSTNAME}:${portM}`,
      bucket,
      recoveryKey: RECOVERY_KEY,
      modulesJson: MODULES_M,
      venue: {
        request: VENUE_M,
        modules: enabledModules(ALL_MODULES, parseModuleConfig(MODULES_M, ALL_MODULES)),
      },
    });
    const till = await seedCounterTill(dirsM.venue, m);
    // The host's time service is synchronised, so M's start is not held for its time.
    const boxM = new TestBox(dirsM, portM, boxEnv(dirsM, portM), {
      boxHost: synchronisedBoxHost(),
    });
    boxes.push(boxM);
    const dirsS = await boxDirs(scratch, "box-s");
    const boxS = new TestBox(
      dirsS,
      portS,
      {
        ...boxEnv(dirsS, portS),
        WAITRON_ENV: "preproduction",
        WAITRON_SPARE_STORE_PORT: String(storeS),
        WAITRON_SPARE_STORE_LOOPBACK_PORT: String(storeLoopbackS),
      },
      // S's copy attempts wait until M has restarted in the middle of S's join.
      { spareCopy: { hold: copyHold } },
    );
    boxes.push(boxS);

    const urlM = `https://127.0.0.1:${portM}`;
    const workingOrderId = randomUUID();
    const sellingOnM = (async () => {
      await boundedStart(boxM.start(), "M's first start");
      const caM = await readFile(join(dirsM.state, "tls", "ca.crt"), "utf8");
      const { via: viaM, close } = httpsVia(caM);
      closeViaM = close;
      const health = await fetchHealthOk(`${urlM}/health`, viaM);
      const healthBody = (await health.json()) as { tradingAvailable?: unknown };
      expect(healthBody.tradingAvailable, JSON.stringify(healthBody)).not.toBe(false);

      const sold = await fetch(`${urlM}/api/sales`, {
        ...viaM,
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: till.cookie,
          [PERSON_HEADER]: till.personId,
        },
        body: JSON.stringify({
          lines: [{ menuItemId: till.menuItemId, quantity: "1" }],
          tender: { method: "cash", amount: "5.00" },
          workingOrderId,
          zoneId: till.zoneId,
        }),
      });
      expect(sold.status, await sold.text()).toBe(200);
      expect(saleOf(dirsM.venue, workingOrderId)).toBe(true);
      return { caM, viaM };
    })();
    // S's setup start reads nothing of M's, so it runs while M starts and sells. Both settle before
    // either failure is thrown, so cleanup never runs while M's branch can still open a client.
    const [selling, settingUp] = await Promise.allSettled([
      sellingOnM,
      boundedStart(boxS.start(), "S's setup start"),
    ]);
    if (selling.status === "rejected") throw selling.reason;
    if (settingUp.status === "rejected") throw settingUp.reason;
    const { caM, viaM } = selling.value;
    const urlS = `https://127.0.0.1:${portS}`;
    const caS = await readFile(join(dirsS.state, "tls", "ca.crt"), "utf8");
    // In setup S answers under its own authority; once it adopts, under the venue's, M's.
    const { via: viaS, close } = httpsVia(caS);
    closeViaS = close;

    // M's address is the one its chart gives it, at its own name; S reaches it through the lookup.
    const addressM = ownContactUrl(boxM.origin, m.nodeId);
    expect(new URL(addressM).hostname).not.toBe(BOX_HOSTNAME);
    const read = await fetch(`${urlS}/setup-api/primary-certificate`, {
      ...viaS,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ primaryUrl: addressM }),
    });
    const answer = (await read.json()) as unknown;
    expect(read.status, JSON.stringify(answer)).toBe(200);
    expect(answer).toMatchObject({
      fingerprint256: new X509Certificate(caM).fingerprint256,
    });

    const adopt = async (): Promise<{ status: number; body: unknown }> => {
      const adopted = await fetch(`${urlS}/setup-api/adopt`, {
        ...viaS,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryUrl: addressM,
          credential: { email: ADMIN.email, password: ADMIN.password },
          confirmedCaPem: caM,
        }),
      });
      return { status: adopted.status, body: (await adopted.json()) as unknown };
    };

    clock.begin("spare-refused");
    const bucketStore = createS3ObjectStore(bucket);
    const pointer = await wait(
      "M's pointer in the bucket",
      POINTER_WAIT_MS,
      async () => (await readPointer(bucketStore, m.locationId)) ?? undefined,
    );
    expect(pointer.pointer.body.generation).toEqual(expect.any(String));
    const before = await joinState(dirsM.venue, m.nodeId);
    const refused = await adopt();
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toEqual({ error: { code: "mirror.bucket_stream_active", params: {} } });
    expect(await joinState(dirsM.venue, m.nodeId)).toEqual(before);

    clock.begin("bucket-stopped");
    const signIn = await fetch(`${urlM}/management-api/session`, {
      ...viaM,
      method: "POST",
      headers: { "content-type": "application/json", origin: boxM.origin },
      body: JSON.stringify(ADMIN),
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    await signIn.arrayBuffer();
    const managing = {
      "content-type": "application/json",
      origin: boxM.origin,
      cookie: signIn.headers.get("set-cookie")!.split(";")[0]!,
    };
    const proof = await fetch(`${urlM}/management-api/session/me/fresh-sign-in`, {
      ...viaM,
      method: "POST",
      headers: managing,
      body: JSON.stringify({ method: "password", password: ADMIN.password }),
    });
    expect(proof.status, await proof.clone().text()).toBe(204);
    await proof.arrayBuffer();
    const stopped = await fetch(`${urlM}/api/backup/stream`, {
      ...viaM,
      method: "DELETE",
      headers: managing,
    });
    const stoppedView = (await stopped.json()) as { configured?: unknown };
    expect(stopped.status, JSON.stringify(stoppedView)).toBe(200);
    expect(stoppedView.configured).toBe(false);

    clock.begin("spare-join");
    const restartsBeforeJoin = boxS.restarts;
    const logAtJoin = logSoFar().length;
    const joined = await adopt();
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ adopted: true, restarting: true });
    const link = await readOutside(dirsM.venue, (reader) =>
      wait("M's pair link to reach streaming", LINK_WAIT_MS, async () => {
        const current = await readPairLink(reader.node, m.nodeId);
        return current?.state === "streaming" ? current : undefined;
      }),
    );
    expect(link.role).toBe("streams");
    const nodeIdS = link.peerNodeId;

    clock.begin("main-restart-mid-join");
    expect(boxS.restarts - restartsBeforeJoin).toBe(SPARE_RESTARTS_AT_ADOPT);
    const serverBeforeRestart = boxM.server;
    const restartsM = boxM.restarts;
    await boxM.restartNow();
    expect(boxM.restarts - restartsM).toBe(1);
    expect(boxM.server).not.toBe(serverBeforeRestart);
    await fetchHealthOk(`${urlM}/health`, viaM);
    expect(linesSince(logAtJoin).filter((line) => line.event === "spare.first_copy_ready")).toEqual(
      [],
    );
    releaseCopy();

    clock.begin("spare-copy");
    const restartsBeforeCopy = boxS.restarts;
    const logAtCopy = logSoFar().length;
    const ready = await wait("S's spare.first_copy_ready", COPY_WAIT_MS, async () =>
      linesSince(logAtCopy).find((line) => line.event === "spare.first_copy_ready"),
    );
    console.log(`spare join: first copy ${String(ready.bytes)} bytes, ${String(ready.ms)} ms`);
    let lastFetchError: unknown;
    await wait("S to start as a mirror", MIRROR_WAIT_MS, async () => {
      if (existsSync(join(dirsS.state, PENDING_ADOPTION_FILE))) return undefined;
      try {
        const page = await fetch(`${urlS}/`, viaM);
        const text = await page.text();
        lastFetchError = undefined;
        return text.includes("Restaurant screens are closed here") ? true : undefined;
      } catch (error) {
        // S is between starts, or answers under an authority M's does not verify.
        lastFetchError = error;
        return undefined;
      }
    }).catch((error: unknown) => {
      if (lastFetchError === undefined) throw error;
      throw new Error(
        `${String(error)}; S's last fetch failed with ${describeError(lastFetchError)}`,
        {
          cause: error,
        },
      );
    });
    const node = await fetch(`${urlS}/api/node`, viaM);
    expect(await node.json()).toMatchObject({ acceptingSales: false });
    for (const event of ["spare.first_copy_placed", "adoption.established"])
      expect(linesSince(logAtCopy).map((line) => line.event)).toContain(event);
    expect(boxS.restarts - restartsBeforeCopy).toBe(SPARE_RESTARTS_AFTER_FIRST_COPY);
    expect(saleOf(dirsS.venue, workingOrderId)).toBe(true);
    expect(nodeKeyIn(dirsS.venue, nodeIdS)).toBe(link.peerPublicKey);
    expect(nodeKeyIn(dirsM.venue, nodeIdS)).toBe(link.peerPublicKey);

    clock.begin("start-check");
    const logAtCheck = logSoFar().length;
    const lookupsAtCheck = boxM.lookups.length;
    const connectedAtCheck = sockets.connected.length;
    await boxM.restartNow();
    // The start check runs before M's restart finishes; the test asks only M in this phase, and
    // M's pair stream goes to S's store port.
    const duringRestart = sockets.connected.slice(connectedAtCheck);
    expect(duringRestart, JSON.stringify(duringRestart)).toContainEqual({
      address: "127.0.0.1",
      port: portS,
    });
    await fetchHealthOk(`${urlM}/health`, viaM);
    const chartM = (await readOutside(dirsM.venue, (store) => readNodeMembership(store.venue)))
      ?.body;
    const entryS = chartM?.nodes.find((entry) => entry.nodeId === nodeIdS);
    expect(entryS === undefined ? undefined : new URL(entryS.contactUrl).hostname).toBe(
      boxHostnameFor(nodeIdS),
    );
    const checks = linesSince(logAtCheck).filter((line) => line.event === "handover.start_check");
    expect(checks.map(({ result, peers }) => ({ result, peers }))).toEqual([
      { result: "proceed", peers: [{ nodeId: nodeIdS, answer: "=", counted: true }] },
    ]);
    expect(boxM.lookups.slice(lookupsAtCheck)).toContain(boxHostnameFor(nodeIdS));

    clock.begin("loopback-only");
    sockets.stop();
    console.log(`spare join: addresses reached ${JSON.stringify([...sockets.addresses])}`);
    expect([...sockets.addresses].filter((address) => !isLoopback(address))).toEqual([]);
    expect(sockets.addresses.size).toBeGreaterThan(0);
    clock.end("ok");
  } catch (error) {
    clock.end("failed");
    failures.push(error);
  } finally {
    sockets.stop();
    releaseCopy();
    signal?.removeEventListener("abort", onAbort);
    if (abortClose !== undefined) failures.push(...(await abortClose));
    failures.push(...(await closeAll()));
    await closeViaM?.().catch(() => {});
    await closeViaS?.().catch(() => {});
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "spare join failed");
}
