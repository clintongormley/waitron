// A main box M and a spare S, both started in this process: M is provisioned as the stream loop
// provisions its box, and S starts from an empty state folder, so it boots in setup mode.
// `spare-join.e2e.test.ts` runs it against versitygw.
import { randomUUID, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import { Agent } from "undici";
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
  persons,
  readNodeMembership,
  withTransaction,
} from "@waitron/db";
import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { loginWithPin } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { enabledModules, parseModuleConfig } from "@waitron/module";
import { readPairLink } from "@waitron/node-db";
import { nodeId as brandNodeId, PERSON_HEADER } from "@waitron/shared";
import { createS3ObjectStore, readPointer, type BucketConfig } from "@waitron/stream";
import { BOX_HOSTNAME, ownContactUrl } from "../box-name.js";
import { loadBoxEnv } from "../box-env.js";
import { startServer, type StartServerSeams, type StartedServer } from "../boot.js";
import { DEVICE_COOKIE } from "../device-session.js";
import { PENDING_ADOPTION_FILE } from "../finish-adoption.js";
import type { BoxLookup } from "../mirror-bundle-fetch.js";
import { ALL_MODULES } from "../modules.js";
import { SESSION_COOKIE } from "../till-session.js";
import type { TradingContext } from "../trading-context.js";
import { POLL_INTERVAL_MS, POLL_TRIES, fetchHealthOk } from "./boot-harness.js";
import { enrolDeviceForTest } from "./enrol.js";
import { freePorts } from "./free-ports.js";
import { fixturePinHash } from "./known-secret-hashes.js";
import { stageClock, waitUntil, type StageEvent } from "./scenario-stages.js";
import { BASIC_ACTIONS } from "./session-device.js";
import { boxDirs, copyMigrations, provisionStreamBox, type BoxDirs } from "./stream-box.js";
import { synchronisedBoxHost } from "./synchronised-box-host.js";
import { offerProducts } from "./zone-offers.js";

const RECOVERY_KEY = "spare-join-e2e-recovery-key";
const MODULES_M = { modules: { "fiscal-verifactu": false } };
const LOCALE_M = "en-GB";
/** A taxpayer whose territory selects `fiscal-none`, the one fiscal module `MODULES_M` leaves on. */
const VENUE_M = {
  country: "GB",
  taxId: "GB100000001",
  legalName: "Spare Join Ltd",
  fiscalTerritory: "GB-vat",
  invoiceLocales: [LOCALE_M],
  operationDescription: "Sale on premises",
  addressLine1: "1 High Street",
  postalCode: "EC1A 1AA",
  city: "London",
  province: "London",
  timeZone: "Europe/London",
};
/** `provisionStreamBox`'s administrator. */
const ADMIN = { email: "owner@example.test", password: "dashPass123" };
const STAFF_PIN = "5555";

// A caller's timeout adds this sum (CLAUDE.md §4). BOOT_MS, per start, and UNTIMED_MS, for
// migrations, provisioning and closes, are budgets nothing here enforces; the health wait is
// `fetchHealthOk`'s poll budget. S starts four times: setup, the latch start that takes the copy,
// the start that places it and finishes joining, and the mirror's.
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
  5 * BOOT_MS +
  HEALTH_MS +
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
  "spare-copy",
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

class ClosedWhileStarting extends Error {}

/**
 * One box's server, started again in place whenever it asks to restart: the `restart` seam closes
 * it and starts it on the same folders and environment.
 */
class TestBox {
  server: StartedServer | undefined;
  /** How many restarts the box asked for. */
  restarts = 0;
  private restarting: Promise<void> | undefined;
  private restartFailure: unknown;
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

  async start(): Promise<void> {
    const server = await startServer(
      await loadBoxEnv(this.env, this.dirs.state),
      {},
      {
        ...this.seams,
        boxLookup: loopbackLookup,
        restart: () => this.restart(),
      },
    );
    // A close that began while this start ran found no server to close.
    if (this.closed) {
      await server.close();
      throw new ClosedWhileStarting(`the box on port ${this.port} was closed while it started`);
    }
    this.server = server;
  }

  private restart(): void {
    // As production's restart does nothing once shutdown is under way.
    if (this.closed) return;
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
  }

  /** Settles a pending restart, then closes; returns what failed, the restart's failure first. */
  async close(): Promise<unknown[]> {
    this.closed = true;
    const failures: unknown[] = [];
    await this.restarting;
    if (this.restartFailure !== undefined) failures.push(this.restartFailure);
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

/** What a till on M needs to ring a counter sale through M's own routes. */
interface CounterTill {
  adminId: string;
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
      const [admin] = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.email, ADMIN.email));
      return {
        adminId: admin!.id,
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
      adminId: seeded.adminId,
      personId: seeded.personId,
      cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
      menuItemId: seeded.menuItemId,
      zoneId: seeded.zoneId,
    };
  } finally {
    await store.close();
  }
}

/** What a refused join must leave alone on M: its chart, its `nodes` and series rows, its link. */
async function joinState(venueDir: string, nodeId: string): Promise<unknown> {
  const store = await openVenueDatabase(venueDir, { exclusive: false });
  try {
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
  } finally {
    await store.close();
  }
}

/** Reads M's pair link, from outside M's server. */
async function pairLinkOf(venueDir: string, nodeId: string) {
  const store = await openVenueDatabase(venueDir, { exclusive: false });
  try {
    return await readPairLink(store.node, nodeId);
  } finally {
    await store.close();
  }
}

/** The public key `venue.db`'s `nodes` row holds for `nodeId`, read-only. */
function nodeKeyIn(venueFile: string, nodeId: string): string | null | undefined {
  const db = new DatabaseSync(venueFile, { readOnly: true });
  try {
    const row = db.prepare("select public_key from nodes where id = ?").get(nodeId) as
      { public_key: string | null } | undefined;
    return row === undefined ? undefined : row.public_key;
  } finally {
    db.close();
  }
}

/** Whether `venue.db` holds the sale of `workingOrderId`, its idempotency key. */
function saleOf(venueFile: string, workingOrderId: string): boolean {
  const db = new DatabaseSync(venueFile, { readOnly: true });
  try {
    return (
      db.prepare("select 1 from sales where working_order_id = ?").get(workingOrderId) !== undefined
    );
  } finally {
    db.close();
  }
}

interface LogLine {
  event?: string;
  [key: string]: unknown;
}

/** Every JSON line this process writes to stdout, kept as it arrives; `stop` restores stdout. */
function captureLog(): { lines: LogLine[]; stop(): void } {
  const original = process.stdout.write.bind(process.stdout);
  const lines: LogLine[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    for (const text of String(chunk).split("\n")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === "object" && parsed !== null) lines.push(parsed as LogLine);
      } catch {
        // Not one of the logger's lines.
      }
    }
    return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  return {
    lines,
    stop: () => {
      process.stdout.write = original;
    },
  };
}

export async function runSpareJoinScenario(fixture: SpareJoinFixture): Promise<void> {
  const { bucket, scratch, signal } = fixture;
  const clock = stageClock(fixture.record, signal);
  const log = captureLog();
  const boxes: TestBox[] = [];
  const agents: Agent[] = [];
  const closeAll = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    for (const box of boxes.splice(0)) failures.push(...(await box.close()));
    return failures;
  };
  let abortClose: Promise<unknown[]> | undefined;
  const onAbort = (): void => {
    abortClose = closeAll();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const failures: unknown[] = [];
  const wait = <T>(what: string, ms: number, probe: () => Promise<T | undefined>) =>
    waitUntil(what, ms, probe, signal, WAIT_POLL_MS);
  try {
    clock.begin("probe");
    const { migrationsRoot, fromSource } = await copyMigrations(scratch);
    // One draw: M's and S's HTTPS ports, then S's store and its versitygw's loopback port.
    const [portM, portS, storeS, storeLoopbackS] = (await freePorts(4)) as [
      number,
      number,
      number,
      number,
    ];
    const bootEnv = (dirs: BoxDirs, port: number): NodeJS.ProcessEnv => ({
      WAITRON_STATE_DIR: dirs.state,
      WAITRON_VENUE_DIR: dirs.venue,
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_LITESTREAM_BIN: fixture.litestreamBin,
      WAITRON_VERSITYGW_BIN: fixture.versitygwBin,
      // The advertised origin: each box puts its own name in place of `waitron.local`.
      WAITRON_MANAGEMENT_ORIGIN: `https://${BOX_HOSTNAME}:${port}`,
      WAITRON_MANAGEMENT_RP_ID: BOX_HOSTNAME,
    });

    const dirsM = await boxDirs(scratch, "box-m");
    const m = await provisionStreamBox({
      dirs: dirsM,
      migrations: fromSource,
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
    const boxM = new TestBox(dirsM, portM, bootEnv(dirsM, portM), {
      boxHost: synchronisedBoxHost(),
    });
    boxes.push(boxM);
    await boxM.start();
    const caM = await readFile(join(dirsM.state, "tls", "ca.crt"), "utf8");
    const urlM = `https://127.0.0.1:${portM}`;
    const viaM = new Agent({ connect: { ca: caM } });
    agents.push(viaM);
    const health = await fetchHealthOk(`${urlM}/health`, { dispatcher: viaM } as RequestInit);
    const healthBody = (await health.json()) as { tradingAvailable?: unknown };
    expect(healthBody.tradingAvailable, JSON.stringify(healthBody)).not.toBe(false);

    const workingOrderId = randomUUID();
    const sold = await fetch(`${urlM}/api/sales`, {
      dispatcher: viaM,
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
    } as RequestInit);
    expect(sold.status, await sold.text()).toBe(200);
    expect(saleOf(join(dirsM.venue, "venue.db"), workingOrderId)).toBe(true);

    const dirsS = await boxDirs(scratch, "box-s");
    const boxS = new TestBox(
      dirsS,
      portS,
      {
        ...bootEnv(dirsS, portS),
        WAITRON_ENV: "preproduction",
        WAITRON_SPARE_STORE_PORT: String(storeS),
        WAITRON_SPARE_STORE_LOOPBACK_PORT: String(storeLoopbackS),
      },
      {},
    );
    boxes.push(boxS);
    await boxS.start();
    const urlS = `https://127.0.0.1:${portS}`;
    const caS = await readFile(join(dirsS.state, "tls", "ca.crt"), "utf8");
    // In setup S answers under its own authority; once it adopts, under the venue's, M's.
    const viaS = new Agent({ connect: { ca: caS } });
    agents.push(viaS);

    // M's address is the one its chart gives it, at its own name; S reaches it through the lookup.
    const addressM = ownContactUrl(boxM.origin, m.nodeId);
    expect(new URL(addressM).hostname).not.toBe(BOX_HOSTNAME);
    const read = await fetch(`${urlS}/setup-api/primary-certificate`, {
      dispatcher: viaS,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ primaryUrl: addressM }),
    } as RequestInit);
    const answer = (await read.json()) as unknown;
    expect(read.status, JSON.stringify(answer)).toBe(200);
    expect(answer).toMatchObject({
      fingerprint256: new X509Certificate(caM).fingerprint256,
    });

    const adopt = async (): Promise<{ status: number; body: unknown }> => {
      const adopted = await fetch(`${urlS}/setup-api/adopt`, {
        dispatcher: viaS,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryUrl: addressM,
          credential: { personId: till.adminId, password: ADMIN.password },
          confirmedCaPem: caM,
        }),
      } as RequestInit);
      return { status: adopted.status, body: (await adopted.json()) as unknown };
    };

    clock.begin("spare-refused");
    const pointer = await wait(
      "M's pointer in the bucket",
      POINTER_WAIT_MS,
      async () => (await readPointer(createS3ObjectStore(bucket), m.locationId)) ?? undefined,
    );
    expect(pointer.pointer.body.generation).toEqual(expect.any(String));
    const before = await joinState(dirsM.venue, m.nodeId);
    const refused = await adopt();
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toEqual({ error: { code: "mirror.bucket_stream_active", params: {} } });
    expect(await joinState(dirsM.venue, m.nodeId)).toEqual(before);

    clock.begin("bucket-stopped");
    const signIn = await fetch(`${urlM}/management-api/session`, {
      dispatcher: viaM,
      method: "POST",
      headers: { "content-type": "application/json", origin: boxM.origin },
      body: JSON.stringify(ADMIN),
    } as RequestInit);
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    await signIn.arrayBuffer();
    const managing = {
      "content-type": "application/json",
      origin: boxM.origin,
      cookie: signIn.headers.get("set-cookie")!.split(";")[0]!,
    };
    const proof = await fetch(`${urlM}/management-api/session/me/fresh-sign-in`, {
      dispatcher: viaM,
      method: "POST",
      headers: managing,
      body: JSON.stringify({ method: "password", password: ADMIN.password }),
    } as RequestInit);
    expect(proof.status, await proof.clone().text()).toBe(204);
    await proof.arrayBuffer();
    const stopped = await fetch(`${urlM}/api/backup/stream`, {
      dispatcher: viaM,
      method: "DELETE",
      headers: managing,
    } as RequestInit);
    const stoppedView = (await stopped.json()) as { configured?: unknown };
    expect(stopped.status, JSON.stringify(stoppedView)).toBe(200);
    expect(stoppedView.configured).toBe(false);

    clock.begin("spare-join");
    const joined = await adopt();
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ adopted: true, restarting: true });
    const link = await wait("M's pair link to reach streaming", LINK_WAIT_MS, async () => {
      const current = await pairLinkOf(dirsM.venue, m.nodeId);
      return current?.state === "streaming" ? current : undefined;
    });
    expect(link.role).toBe("streams");
    const nodeIdS = link.peerNodeId;

    clock.begin("spare-copy");
    const ready = await wait("S's spare.first_copy_ready", COPY_WAIT_MS, async () =>
      log.lines.find((line) => line.event === "spare.first_copy_ready"),
    );
    console.log(`spare join: first copy ${String(ready.bytes)} bytes, ${String(ready.ms)} ms`);
    await wait("S to start as a mirror", MIRROR_WAIT_MS, async () => {
      if (existsSync(join(dirsS.state, PENDING_ADOPTION_FILE))) return undefined;
      try {
        const page = await fetch(`${urlS}/`, { dispatcher: viaM } as RequestInit);
        const text = await page.text();
        return text.includes("Restaurant screens are closed here") ? true : undefined;
      } catch {
        // S is between starts.
        return undefined;
      }
    });
    const node = await fetch(`${urlS}/api/node`, { dispatcher: viaM } as RequestInit);
    expect(await node.json()).toMatchObject({ acceptingSales: false });
    for (const event of ["spare.first_copy_placed", "adoption.established"])
      expect(log.lines.map((line) => line.event)).toContain(event);
    // Adopt's, the first copy's and finishing joining's.
    expect(boxS.restarts).toBe(3);
    const venueS = join(dirsS.venue, "venue.db");
    expect(saleOf(venueS, workingOrderId)).toBe(true);
    expect(nodeKeyIn(venueS, nodeIdS)).toBe(link.peerPublicKey);
    expect(nodeKeyIn(join(dirsM.venue, "venue.db"), nodeIdS)).toBe(link.peerPublicKey);
    clock.end("ok");
  } catch (error) {
    clock.end("failed");
    failures.push(error);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (abortClose !== undefined) failures.push(...(await abortClose));
    failures.push(...(await closeAll()));
    for (const agent of agents) await agent.close().catch(() => {});
    log.stop();
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "spare join failed");
}
