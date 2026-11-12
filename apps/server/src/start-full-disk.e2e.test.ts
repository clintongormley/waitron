import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
// Needs a filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_ROOT/start names, or on macOS a disk
// image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case is reported
// SKIPPED; with CI=true or WAITRON_REQUIRE_TEST_TOOLS=1 it FAILS instead (testing-guide.md, "The
// full-disk start tests run on a small filesystem").
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { get as httpsGet, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  devices,
  enqueueMail,
  outgoingMail,
  drawerOpens,
  invoiceSeries,
  openVenueDatabase,
  printAgents,
  sales,
  withTransaction,
  type Database,
} from "@waitron/db";
import { seedDevice, seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import {
  hashPin,
  hashDeviceToken,
  hashSessionToken,
  startManagementSession,
  withPassiveManagementRead,
  type PersonRoleValue,
} from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { authenticateAgent } from "@waitron/printing";
import {
  START_AGAIN_CHOICES_DIR,
  START_AGAIN_GUESSES_FILE,
  START_AGAIN_MARKER_FILE,
  START_AGAIN_SET_ASIDE_DIR,
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
} from "@waitron/provisioning";
import {
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
} from "@waitron/provisioning/testing/start-again-attempt";
import { PERSON_HEADER, jobOrigin, nodeId as brandNodeId } from "@waitron/shared";
import { openVenueStore } from "@waitron/store";
import { WorkforceBackend } from "@waitron/workforce";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { loadKeyRing } from "@waitron/credentials";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
import { dumpFileName } from "./backup-keys.js";
import { createStagingTurn } from "./backup-staging-turn.js";
import {
  boxEmailMessage,
  readBoxEmailContext,
  readOpenEmailedIncidents,
  startBoxEmailDuty,
} from "./box-alert-email.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import { collectBoxHealth, type BoxHealth } from "./box-health.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { loadBoxEnv } from "./box-env.js";
import { deviceNoticeSources } from "./box-staff-notices.js";
import { mountDeviceApi } from "./device-api.js";
import { createDiskFullState, watchForDiskFull, type DiskFullState } from "./disk-full-state.js";
import { mountDiskStopApi } from "./disk-stop-api.js";
import { resolveEmailDelivery } from "./email-delivery.js";
import { readDiskUsage } from "./disk-usage.js";
import { freeBytes } from "./free-bytes.js";
import { createSpaceFreer, surveyLeftovers, type FreedSpace } from "./free-space-now.js";
import { createFreeSpaceState } from "./free-space-watch.js";
import { ALL_ALERT_CLAIMS, ALL_MODULES, enabledAlertSources } from "./modules.js";
import { runEntry, serveRecovery, type RecoveryServeOptions } from "./node-entry.js";
import { FRESH, readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { createPairingMode } from "./pairing-mode.js";
import { actionsPersonalData } from "./personal-data-actions.js";
import { mountPrintApi } from "./print-api.js";
import { mountPersonalDataExportApi } from "./personal-data-export-api.js";
import { timeRecordPersonalData } from "./personal-data-time-record.js";
import { mountInvoiceCustomerDataApi } from "./invoice-customer-data-api.js";
import { START_AGAIN_PAGE_TEXT } from "./recovery-start-again.js";
import { escapeHtml } from "./html-page.js";
import {
  createStaffNoticeLog,
  readStaffNoticesInTurns,
  type OwnedStaffNoticeSource,
} from "./staff-notices.js";
import { provisionBillVenue } from "./testing/bill-venue.js";
import { freePorts } from "./testing/free-ports.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";
import { systemClock } from "./till-backend.js";
import { SESSION_COOKIE } from "./till-session.js";

const MiB = 1024 * 1024;
const FLOOR = 8 * MiB;
const TITLE = escapeHtml("The box's disk is full, so Waitron cannot save anything.");
const DELETED = escapeHtml(
  "The box has deleted the temporary copies, old logs and crash reports it can make again, and the disk is still full.",
);

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;

beforeAll(() => {
  opened = openSmallDisk("start", 32);
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK) console.warn(`start-full-disk tests SKIPPED: ${opened.reason}`);
});
afterEach(() => disk?.unfill());
afterAll(() => disk?.close());

/** The small disk, or the case is skipped (or fails where the disk is required). */
function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

type StartServer = (env: NodeJS.ProcessEnv) => Promise<{ close(): Promise<void> }>;

function entryDeps(stateDir: string, over: Partial<Parameters<typeof runEntry>[0]> = {}) {
  const venueDir = over.venueDir ?? join(stateDir, "venue");
  return {
    args: [] as readonly string[],
    baseEnv: { WAITRON_HTTP_LANDING_PORT: "0" } as NodeJS.ProcessEnv,
    stateDir,
    venueDir,
    assertNotAhead: (dir: string) => openVenueDatabase(dir).then((store) => store.close()),
    loadBoxEnv,
    readRecoveryState,
    writeRecoveryState,
    // Proof the database is usable: a table created and a row written.
    startServer: vi.fn<StartServer>(async (env) => {
      const store = await openVenueDatabase(env.WAITRON_VENUE_DIR ?? venueDir);
      try {
        store.venue.run(sql`create table if not exists start_probe (id integer primary key)`);
        store.venue.run(sql`insert into start_probe default values`);
      } finally {
        await store.close();
      }
      return { close: () => Promise.resolve() };
    }),
    serveRecovery: vi.fn<(app: Hono, opts: RecoveryServeOptions) => Promise<unknown>>(() =>
      Promise.resolve(),
    ),
    installShutdownHandlers: vi.fn(),
    scheduleStayedUp: vi.fn(),
    log: vi.fn(),
    exit: vi.fn(),
    freeSpaceFloor: FLOOR,
    spareBytes: 1024 * 1024,
    ...over,
  };
}

/** A state folder on the small disk that one earlier start with room has used. */
async function startedBefore(
  small: SmallDisk,
  name: string,
  over: Partial<Parameters<typeof runEntry>[0]> = {},
): Promise<string> {
  const stateDir = realpathSync(small.folder(name));
  mkdirSync(join(stateDir, "venue"));
  await writeRecoveryState(stateDir, FRESH);
  const setup = entryDeps(stateDir, over);
  await runEntry(setup);
  expect(setup.startServer).toHaveBeenCalledTimes(1);
  return stateDir;
}

/** Each layer of an error's cause chain that carries a `code` or an `errcode`. */
function causeCodes(error: unknown): { code?: unknown; errcode?: unknown }[] {
  const layers: { code?: unknown; errcode?: unknown }[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 10 && typeof current === "object" && current !== null; depth += 1) {
    const layer = current as { code?: unknown; errcode?: unknown; cause?: unknown };
    layers.push({ code: layer.code, errcode: layer.errcode });
    current = layer.cause;
  }
  return layers;
}

const inodeOf = (path: string) => statSync(path).ino;

function postFormOver(
  port: number,
  ca: Buffer,
  path: string,
  form: Record<string, string>,
): Promise<{ status?: number; body: string }> {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        ca,
        servername: "localhost",
        headers: {
          "Accept-Language": "en-GB",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: text }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function pageOver(port: number, ca: Buffer): Promise<{ status?: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpsGet({ host: "127.0.0.1", port, path: "/", ca, servername: "localhost" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

describe("the Box status read and free-space deletion on a real full disk", () => {
  const MIB = 1024 * 1024;
  let root: string | undefined;
  let store: Awaited<ReturnType<typeof openVenueDatabase>> | undefined;
  let app: Hono;
  let db: Database;
  let diskState: DiskFullState;
  let logDir: string;
  let manager: { personId: string; token: string; cookie: string };
  let supervisor: { personId: string; token: string; cookie: string };
  let admin: { personId: string; token: string; cookie: string };
  let cashier: { personId: string; token: string; cookie: string };
  let nodeId: string;

  async function seedPerson(role: PersonRoleValue, name: string) {
    return withTransaction(db, async (tx) => {
      const [p] = await seedPersons(tx, { displayName: name, pinHash: hashPin("1234"), role });
      const session = await startManagementSession(tx, { personId: p!.id });
      await setFreshManagementSignIn(tx, session.token);
      return {
        personId: p!.id,
        token: session.token,
        cookie: `${MANAGEMENT_COOKIE}=${session.token}`,
      };
    });
  }

  beforeAll(async () => {
    if (disk === undefined) return;
    root = realpathSync(disk.folder("box-status"));
    const venueDir = join(root, "venue");
    logDir = join(root, "logs");
    mkdirSync(venueDir);
    mkdirSync(logDir);
    writeFileSync(join(logDir, "waitron.log.3"), Buffer.alloc(MIB, 65));
    await applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));
    store = await openVenueDatabase(venueDir);
    db = store.venue;
    await seedVenue(db, { name: "Main", invoiceLocales: ["en-GB"], operationDescription: "Sale" });
    manager = await seedPerson("manager", "Marta");
    supervisor = await seedPerson("supervisor", "Sergio");
    admin = await seedPerson("admin", "Ana");
    cashier = await seedPerson("staff", "Paula");
    nodeId = await seedNode(db);
    // Here, not in the case: a clock-in's `withTransaction` drain would deliver the change the
    // case leaves waiting.
    await withTransaction(db, (tx) =>
      new WorkforceBackend().clockIn(tx, {
        nodeId,
        personId: manager.personId,
        offsetMinutes: 60,
        origin: jobOrigin("dashboard"),
        at: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );
    // Paula's sale and its drawer opening, so her download looks a sale number up on the full disk.
    const { deviceId } = await seedDevice(db);
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "FD", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 317,
        issuedAt: "2026-10-20T08:00:00.000Z",
        issuedOffsetMinutes: 120,
        total: 1234,
        vatBreakdown: [],
        locale: "en",
        invoiceLocales: ["en"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning({ id: sales.id });
    await db.insert(sales).values({
      source: "device",
      deviceId,
      nodeId,
      seriesId: series!.id,
      invoiceNumber: 318,
      issuedAt: "2026-10-20T09:00:00.000Z",
      issuedOffsetMinutes: 120,
      total: 5000,
      vatBreakdown: [],
      locale: "en",
      invoiceLocales: ["en"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
      workingOrderId: null,
      counterpartyTaxId: "12345678Z",
      counterpartyLegalName: "Jordi Customer Ltd",
      counterpartyCountryCode: "ES",
      counterpartyAddress: "8 Customer Street, Madrid",
    });
    await FakeFiscalBackend.install(db);
    await db.insert(drawerOpens).values({
      reason: "cash_sale",
      personId: cashier.personId,
      deviceId,
      saleId: sale!.id,
      openedAt: new Date("2026-10-20T08:00:05.000Z"),
    });

    const now = () => new Date();
    diskState = createDiskFullState({ dir: venueDir, now, log: () => {} });
    const space = createFreeSpaceState({ log: () => {} });
    const leftoverDeps = {
      logDir,
      stateDir: root,
      now,
      staging: createStagingTurn(),
      log: () => {},
      backupDirs: () => [],
    };
    app = new Hono();
    app.use("*", async (c, next) => {
      if (c.req.method === "GET" && c.req.header("x-waitron-live") === "1") {
        await withPassiveManagementRead(next);
      } else await next();
    });
    mountBoxHealthApi(
      app,
      {
        db,
        readHealth: () =>
          collectBoxHealth(db, {
            now,
            notices: {
              sources: deviceNoticeSources({ disk: diskState, space }, ALL_MODULES),
              clock: {
                now: () => ({ instant: new Date(), offsetMinutes: 0, confident: true }) as never,
              },
              filing: () => true,
              log: createStaffNoticeLog(() => {}),
            },
            stream: () => ({ state: "off" }),
            authorityClock: () => ({
              state: "ok",
              driftSeconds: 0,
              measuredAt: now().toISOString(),
            }),
            timeHealth: async () => ({ synced: true, source: "timedatectl", warn: false }),
            outbox: { read: FISCAL_SLOT.outbox!.read, awaitingCertificate: () => false },
            disk: diskState,
            space,
            usage: () => readDiskUsage({ venueDir, logDir, backupDirs: [] }),
            free: () => freeBytes(venueDir),
            leftovers: () => surveyLeftovers(leftoverDeps),
            paymentsEnabled: true,
            canFree: () => true,
          }),
        freeSpace: createSpaceFreer({ ...leftoverDeps, venueDir, space, disk: diskState }),
        restart: () => {},
        venue: { language: "en" },
        clockConfirm: {
          backend: new FakeFiscalBackend(db),
          witnesses: () => [],
          clearWitnesses: () => {},
          clock: systemClock(),
          nodeId: "node-1",
          steady: () => 0,
          readBoot: () => ({ ms: 0, id: null }),
          devMode: false,
        },
      },
      () => {},
    );
    mountAlertsApi(
      app,
      {
        db,
        registry: createAlertRegistry({
          claims: ALL_ALERT_CLAIMS,
          sources: enabledAlertSources(ALL_MODULES),
        }),
        now,
      },
      () => {},
    );
    mountDiskStopApi(
      app,
      {
        db,
        disk: diskState,
        registry: createAlertRegistry({ claims: ALL_ALERT_CLAIMS, sources: [] }),
        now,
      },
      () => {},
    );
    mountPersonalDataExportApi(
      app,
      {
        db,
        modules: ALL_MODULES,
        serverParts: [...timeRecordPersonalData(ALL_MODULES), ...actionsPersonalData(db)],
        venueLocale: "en-GB",
      },
      () => {},
    );
    mountInvoiceCustomerDataApi(
      app,
      {
        db,
        backend: new FakeFiscalBackend(db),
        tradingContext: {
          nodeId: brandNodeId(nodeId),
          locale: "en-GB",
          tipsEnabled: false,
          simplifiedInvoiceLimit: null,
        },
        venueLocale: "en-GB",
        onMirror: () => false,
      },
      () => {},
    );
  });

  afterAll(async () => {
    disk?.unfill();
    try {
      await store?.close();
    } finally {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  const health = (cookie: string, passive = false) =>
    app.request("/api/box/health", {
      headers: { cookie, ...(passive ? { "x-waitron-live": "1" } : {}) },
    });
  const freeSpace = (cookie: string) =>
    app.request("/api/box/free-space", { method: "POST", headers: { cookie } });
  const lastSeen = () =>
    db.all<{ at: string }>(
      sql`select last_seen_at as at from management_sessions where token_hash = ${hashSessionToken(manager.token)}`,
    )[0]!.at;
  /** Not through `withTransaction`, whose drain would deliver a change left waiting. */
  const seenAMinuteAgo = () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    db.run(
      sql`update management_sessions set last_seen_at = ${at} where token_hash = ${hashSessionToken(manager.token)}`,
    );
    return at;
  };

  it("the box health read answers on a full disk with a change waiting, passive and not", async (ctx) => {
    const small = needDisk(ctx);
    let before = seenAMinuteAgo();
    expect((await health(manager.cookie, true)).status).toBe(200);
    expect(lastSeen()).toBe(before);
    expect((await health(manager.cookie)).status).toBe(200);
    expect(lastSeen()).not.toBe(before);

    before = seenAMinuteAgo();
    db.run(sql`insert into change_log (id, payload) values ('bs1', '{"resource":"zz","id":"1"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);
    diskState.noteRefused();

    for (const passive of [true, false]) {
      const res = await health(manager.cookie, passive);
      expect(res.status).toBe(200);
      const body = (await res.json()) as BoxHealth;
      expect(body.notices.map(({ owner, key }) => `${owner}:${key}`)).toContain(
        "box:storage.disk_full",
      );
      expect(body.noticesUnavailable).toEqual([]);
      expect(body.outbox).toEqual({ lastAcceptedAt: null, waiting: 0, awaitingCertificate: false });
      expect(body.disk.stoppedSince).not.toBeNull();
    }
    expect(lastSeen()).toBe(before);
    expect(db.all<{ id: string }>(sql`select id from change_log where id = 'bs1'`)).toEqual([
      { id: "bs1" },
    ]);
  });

  it("the disk-stop read answers on a full disk with a change waiting, for a cashier and a manager", async (ctx) => {
    const small = needDisk(ctx);
    const before = seenAMinuteAgo();
    const cashierBefore = new Date(Date.now() - 60_000).toISOString();
    db.run(
      sql`update management_sessions set last_seen_at = ${cashierBefore} where token_hash = ${hashSessionToken(cashier.token)}`,
    );
    db.run(sql`insert into change_log (id, payload) values ('bs7', '{"resource":"zz","id":"7"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);
    diskState.noteRefused();

    for (const cookie of [cashier.cookie, manager.cookie]) {
      const res = await app.request("/management-api/disk-stop", { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ stopped: true, deleted: null });
    }
    expect(lastSeen()).toBe(before);
    expect(lastSeenOf(cashier.token)).toBe(cashierBefore);
    expect(db.all<{ id: string }>(sql`select id from change_log where id = 'bs7'`)).toEqual([
      { id: "bs7" },
    ]);
  });

  it("a manager's ordinary alert read answers on a full disk with a change waiting", async (ctx) => {
    const small = needDisk(ctx);
    const before = seenAMinuteAgo();
    db.run(sql`insert into change_log (id, payload) values ('bs2', '{"resource":"zz","id":"2"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);

    const res = await app.request("/management-api/alerts", {
      headers: { cookie: manager.cookie },
    });
    expect(res.status).toBe(200);
    expect(lastSeen()).toBe(before);
  });

  it("a person's own personal-data download answers on a full disk with a change waiting", async (ctx) => {
    const small = needDisk(ctx);
    const before = seenAMinuteAgo();
    db.run(sql`insert into change_log (id, payload) values ('bs3', '{"resource":"zz","id":"3"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);

    const res = await app.request("/management-api/me/personal-data/export", {
      headers: { cookie: manager.cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(
      Object.hasOwn(unzipSync(new Uint8Array(await res.arrayBuffer())), "time-record.csv"),
    ).toBe(true);
    expect(lastSeen()).toBe(before);
    expect(db.all<{ id: string }>(sql`select id from change_log where id = 'bs3'`)).toEqual([
      { id: "bs3" },
    ]);
  });

  const lastSeenOf = (token: string) =>
    db.all<{ at: string }>(
      sql`select last_seen_at as at from management_sessions where token_hash = ${hashSessionToken(token)}`,
    )[0]!.at;
  const adminDownload = (personId: string) =>
    app.request(`/management-api/staff/${personId}/personal-data/export`, {
      headers: { cookie: admin.cookie },
    });

  it("an already-proved admin's personal-data download of another person answers on a full disk with a change waiting, and writes nothing", async (ctx) => {
    const small = needDisk(ctx);
    const at = new Date(Date.now() - 60_000).toISOString();
    db.run(
      sql`update management_sessions set last_seen_at = ${at} where token_hash = ${hashSessionToken(admin.token)}`,
    );
    // With room on the disk a touch of the session would succeed, so only this check sees one.
    const roomy = await adminDownload(manager.personId);
    expect(roomy.status).toBe(200);
    await roomy.arrayBuffer();
    expect(lastSeenOf(admin.token)).toBe(at);
    db.run(sql`insert into change_log (id, payload) values ('bs4', '{"resource":"zz","id":"4"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);

    const res = await adminDownload(manager.personId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(
      Object.hasOwn(unzipSync(new Uint8Array(await res.arrayBuffer())), "time-record.csv"),
    ).toBe(true);
    expect(lastSeenOf(admin.token)).toBe(at);
    expect(db.all<{ id: string }>(sql`select id from change_log where id = 'bs4'`)).toEqual([
      { id: "bs4" },
    ]);
  });

  it("an admin's invoice-customer search and download answer on a full disk with a change waiting, and write nothing", async (ctx) => {
    const small = needDisk(ctx);
    const at = new Date(Date.now() - 60_000).toISOString();
    db.run(
      sql`update management_sessions set last_seen_at = ${at} where token_hash = ${hashSessionToken(admin.token)}`,
    );
    db.run(sql`insert into change_log (id, payload) values ('bs6', '{"resource":"zz","id":"6"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);

    const search = await app.request(
      "/management-api/invoice-customers/personal-data?taxId=12345678Z",
      { headers: { cookie: admin.cookie } },
    );
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual({
      taxId: "12345678Z",
      invoices: [
        {
          invoice: "FD/318",
          issuedAt: "2026-10-20T09:00:00.000Z",
          name: "Jordi Customer Ltd",
          total: "50.00",
        },
      ],
    });
    const res = await app.request(
      "/management-api/invoice-customers/personal-data/export?taxId=12345678Z",
      { headers: { cookie: admin.cookie } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([
      "README.txt",
      "invoices.json",
      "invoices/FD-318.pdf",
    ]);
    expect(new TextDecoder().decode(files["invoices/FD-318.pdf"]!.subarray(0, 5))).toBe("%PDF-");
    expect(lastSeenOf(admin.token)).toBe(at);
    expect(db.all<{ id: string }>(sql`select id from change_log where id = 'bs6'`)).toEqual([
      { id: "bs6" },
    ]);
  });

  it("an admin's personal-data download of a person with a drawer opening looks its sale number up on a full disk", async (ctx) => {
    const small = needDisk(ctx);
    db.run(sql`insert into change_log (id, payload) values ('bs5', '{"resource":"zz","id":"5"}')`);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);

    const res = await adminDownload(cashier.personId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(new TextDecoder().decode(files["actions.json"]))).toEqual({
      counts: { voids: 0, refunds: 0, drawerOpenings: 1 },
      voids: [],
      refunds: [],
      drawerOpenings: [
        {
          reason: "cash_sale",
          sale: "FD/317",
          at: "2026-10-20T08:00:05.000Z",
          viaOverride: false,
          yourPart: ["opened"],
        },
      ],
    });
    expect(db.all<{ id: string }>(sql`select id from change_log where id = 'bs5'`)).toEqual([
      { id: "bs5" },
    ]);
  });

  it("free-space deletion frees a rotated log on a full disk, and the stop lifts", async (ctx) => {
    const small = needDisk(ctx);
    const free = small.free();
    expect(
      free >= 22 * MIB,
      `the small disk has ${free} bytes free, ${22 * MIB - free} short of the 22 MiB this case needs`,
    ).toBe(true);
    const log4 = join(logDir, "waitron.log.4");
    writeFileSync(log4, Buffer.alloc(17 * MIB, 66));
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);
    diskState.noteRefused();

    const res = await freeSpace(manager.cookie);
    expect(res.status).toBe(200);
    const freed = (await res.json()) as FreedSpace;
    expect(freed.freedBytes).toBeGreaterThanOrEqual(17 * MIB);
    expect(() => statSync(log4)).toThrow();
    expect(diskState.noted()).toBe(false);
    const after = await health(manager.cookie);
    expect(after.status).toBe(200);
    expect(((await after.json()) as BoxHealth).disk.stoppedSince).toBeNull();
  });

  it("a supervisor is refused on a full disk", async (ctx) => {
    const small = needDisk(ctx);
    db.all(sql`pragma wal_checkpoint(truncate)`);
    small.fill(0);
    expect((await health(supervisor.cookie)).status).toBe(403);
    expect((await freeSpace(supervisor.cookie)).status).toBe(403);
  });
});

describe("a start on a real full disk", () => {
  it("a start whose leftovers free enough counts itself and boots", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "leftovers");
    const logs = join(stateDir, "logs");
    for (let i = 1; i <= 5; i += 1)
      writeFileSync(join(logs, `waitron.log.${i}`), Buffer.alloc(512 * 1024, 65));
    mkdirSync(join(logs, "crash-reports"));
    const crash = join(logs, "crash-reports", "holder-frozen-old.json");
    writeFileSync(crash, "{}");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(crash, eightDaysAgo, eightDaysAgo);
    mkdirSync(join(stateDir, "scratch/backup"), { recursive: true });
    const dump = join(stateDir, "scratch/backup", dumpFileName(new Date("2026-10-20T00:00:00Z")));
    writeFileSync(dump, Buffer.alloc(2 * 1024 * 1024, 66));
    const recoveryLock = join(stateDir, "recovery.lock");
    const venueLock = join(stateDir, "venue", "venue.lock");
    const inodes = [inodeOf(recoveryLock), inodeOf(venueLock)];

    small.fill();
    expect(small.free()).toBeLessThan(65_536);

    const d = entryDeps(stateDir);
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(d.serveRecovery).not.toHaveBeenCalled();
    for (let i = 2; i <= 5; i += 1)
      expect(() => statSync(join(logs, `waitron.log.${i}`))).toThrow();
    expect(() => statSync(crash)).toThrow();
    expect(() => statSync(dump)).toThrow();
    expect(statSync(join(logs, "waitron.log.1")).size).toBe(512 * 1024);
    // The setup start counted one, and its stayed-up clear is a stub that never fires.
    expect((await readRecoveryState(stateDir)).failures).toBe(2);
    expect([inodeOf(recoveryLock), inodeOf(venueLock)]).toEqual(inodes);
  });

  it("a start with room writes the box's spare file; a full disk with nothing else to free deletes it, writes the marker and boots", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "spare-kept");
    const spare = join(stateDir, SPARE_SPACE_FILE);
    expect(statSync(spare).size).toBe(1024 * 1024);
    small.fill();
    expect(small.free()).toBeLessThan(65_536);

    const d = entryDeps(stateDir);
    await runEntry(d);
    const events = vi.mocked(d.log).mock.calls.map(([, event]) => event);
    expect(events).toContain("storage.spare_released");
    expect(events).not.toContain("recovery.serving_disk_full");
    expect(() => statSync(spare)).toThrow();
    expect(statSync(join(stateDir, SPARE_SPACE_RELEASED_FILE)).isFile()).toBe(true);
    expect(d.startServer).toHaveBeenCalledTimes(1);
  });

  it("a start with 12 MiB free keeps the box's spare file, and one with 6 MiB free deletes it, writes the marker and boots", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "spare-12-6");
    const spare = join(stateDir, SPARE_SPACE_FILE);
    small.fill(12 * MiB);
    await runEntry(entryDeps(stateDir));
    expect(statSync(spare).size).toBe(1024 * 1024);
    small.unfill();

    small.fill(6 * MiB);
    const d = entryDeps(stateDir);
    await runEntry(d);
    expect(() => statSync(spare)).toThrow();
    expect(statSync(join(stateDir, SPARE_SPACE_RELEASED_FILE)).isFile()).toBe(true);
    expect(d.startServer).toHaveBeenCalledTimes(1);
  });

  it("a start with 12 MiB free after a start that failed for a full disk deletes the spare", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "spare-12-failed");
    const spare = join(stateDir, SPARE_SPACE_FILE);
    await writeRecoveryState(stateDir, {
      ...FRESH,
      failures: 1,
      lastErrorCode: "storage.disk_full",
      lastFailureAt: new Date().toISOString(),
    });
    small.fill(12 * MiB);
    const d = entryDeps(stateDir);
    await runEntry(d);
    expect(() => statSync(spare)).toThrow();
    expect(statSync(join(stateDir, SPARE_SPACE_RELEASED_FILE)).isFile()).toBe(true);
    expect(d.startServer).toHaveBeenCalledTimes(1);
  });

  it("a start whose staged recovery copies fill the disk frees them and boots", async (ctx) => {
    const small = needDisk(ctx);
    const stateDir = await startedBefore(small, "staged");
    const restoreStaging = join(stateDir, "scratch/restore");
    const staged = join(restoreStaging, "staged-recovery");
    mkdirSync(join(staged, "upload-1"), { recursive: true });
    writeFileSync(join(staged, "upload-1", "venue.db"), Buffer.alloc(4 * 1024 * 1024, 67));
    writeFileSync(join(staged, "upload-1", "manifest.json"), "{}");
    const download = join(restoreStaging, "archive-download-x");
    mkdirSync(download);
    writeFileSync(join(download, "part"), "x");

    small.fill();
    expect(small.free()).toBeLessThan(65_536);

    const d = entryDeps(stateDir);
    await runEntry(d);
    expect(d.serveRecovery).not.toHaveBeenCalled();
    expect(d.startServer).toHaveBeenCalledTimes(1);
    expect(() => statSync(staged)).toThrow();
    expect(statSync(join(stateDir, "scratch")).isDirectory()).toBe(true);
    expect(() => statSync(download)).toThrow();
  });

  let nothingDir: string | undefined;

  it("a start with nothing to delete and no spare file serves the recovery page at once", async (ctx) => {
    const small = needDisk(ctx);
    // No spare: this case is the full-disk page, which a spare's release would otherwise avoid.
    const stateDir = await startedBefore(small, "nothing", { spareBytes: 0 });
    nothingDir = stateDir;
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    const ca = readFileSync(join(stateDir, "tls", "ca.crt"));
    const recoveryLock = join(stateDir, "recovery.lock");
    const venueLock = join(stateDir, "venue", "venue.lock");
    const inodes = [inodeOf(recoveryLock), inodeOf(venueLock)];
    small.fill();
    expect(small.free()).toBeLessThan(65_536);
    const stateBytes = readFileSync(join(stateDir, "recovery.json"));

    const [port] = await freePorts(1);
    let served: Awaited<ReturnType<typeof serveRecovery>> | undefined;
    const d = entryDeps(stateDir, {
      spareBytes: 0,
      baseEnv: { WAITRON_HTTP_LANDING_PORT: "0", WAITRON_HTTP_PORT: String(port) },
      serveRecovery: vi.fn(async (app: Hono, opts: RecoveryServeOptions) => {
        served = await serveRecovery(app, opts);
        return served;
      }),
    });
    try {
      await runEntry(d);
      expect(d.startServer).not.toHaveBeenCalled();
      expect(served).toBeDefined();
      const page = await pageOver(port!, ca);
      expect(page.status).toBe(200);
      expect(page.body).toContain(TITLE);
      expect(page.body).toContain(DELETED);
      expect(page.body).toContain("Free space on the box&#39;s disk: 0 MB.");
      expect(readFileSync(join(stateDir, "recovery.json"))).toEqual(stateBytes);
      expect([inodeOf(recoveryLock), inodeOf(venueLock)]).toEqual(inodes);
    } finally {
      const server = served;
      if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("…and the same folder boots once there is room", async (ctx) => {
    const small = needDisk(ctx);
    expect(nothingDir).toBeDefined();
    small.unfill();
    const d = entryDeps(nothingDir!, { spareBytes: 0 });
    await runEntry(d);
    expect(d.startServer).toHaveBeenCalledTimes(1);
  });

  it("a box whose first setup finished gets the full-disk page, not first-setup resolution", async (ctx) => {
    const small = needDisk(ctx);
    const f = await firstFiscalFixture(realpathSync(small.folder("finished")));
    try {
      let state = (await f.store.read())!;
      for (const change of [
        { kind: "activation-started" },
        { kind: "committed", result: {} },
        { kind: "publication" },
        { kind: "complete" },
      ] as const)
        state = await f.store.update(state.frozen.attemptId, state.revision, change);
      const db = new DatabaseSync(join(f.venueDir, "venue.db"));
      try {
        db.exec("pragma journal_mode = wal");
        db.exec("create table tenants (country text, tax_id text)");
        db.exec("create table locations (id text)");
        db.exec("insert into tenants values ('ES', 'B00000000')");
        db.exec("insert into locations values ('loc-1')");
        db.exec("create table settings (module text primary key)");
        db.exec("insert into settings values ('venue')");
      } finally {
        db.close();
      }

      small.fill();
      const full = entryDeps(f.stateDir, { venueDir: f.venueDir });
      await runEntry(full);
      expect(full.startServer).not.toHaveBeenCalled();
      expect(full.serveRecovery).toHaveBeenCalledTimes(1);
      const app = vi.mocked(full.serveRecovery).mock.calls[0]![0];
      expect(await (await app.request("/")).text()).toContain(TITLE);
      expect((await app.request("/setup-api/status")).status).toBe(404);

      small.unfill();
      const room = entryDeps(f.stateDir, { venueDir: f.venueDir });
      await runEntry(room);
      expect(room.startServer).toHaveBeenCalledTimes(1);
    } finally {
      await f.dispose();
    }
  });

  it.for([8192, 16384])(
    "a database refused on a nearly full disk is recorded as a full disk (%i bytes left)",
    async (leave, ctx) => {
      const small = needDisk(ctx);
      const venueDir = realpathSync(small.folder(`refused-${leave}`));
      const store = await openVenueDatabase(venueDir);
      await store.close();
      const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "wt-full-disk-state-")));
      try {
        const logDir = join(stateDir, "logs");
        small.fill(leave);
        const full = entryDeps(stateDir, { venueDir, logDir });
        const error = await runEntry(full).then(
          () => expect.unreachable("the start resolved"),
          (rejection: unknown) => rejection,
        );
        expect((await readRecoveryState(stateDir)).lastErrorCode).toBe("storage.disk_full");
        const layers = causeCodes(error);
        const errcodes = layers.flatMap((l) => (typeof l.errcode === "number" ? [l.errcode] : []));
        expect(errcodes).not.toContain(13);
        expect(
          layers.some((l) => l.code === "ENOSPC") ||
            errcodes.some((code) => [10, 14].includes(code & 0xff)),
          JSON.stringify(layers),
        ).toBe(true);

        small.unfill();
        const room = entryDeps(stateDir, { venueDir, logDir });
        await runEntry(room);
        expect(room.startServer).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    },
  );

  it("a commit on a real full disk is refused whole, and the next one is served once there is room", async (ctx) => {
    const small = needDisk(ctx);
    const store = await openVenueStore({
      directory: realpathSync(small.folder("commit")),
      venueSchema: {},
      nodeSchema: {},
    });
    try {
      const db = store.venue;
      db.run(sql`create table sale (id integer primary key, body text, pad blob)`);
      await store.withWriteLock(async () => {
        db.run(sql`insert into sale (body) values ('committed before')`);
      });
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(16384);

      let statementRan = false;
      await expect(
        store.withWriteLock(async () => {
          db.run(sql`insert into sale (body, pad) values ('in transaction', zeroblob(65536))`);
          statementRan = true;
        }),
      ).rejects.toMatchObject({ code: "storage.disk_full" });
      expect(statementRan).toBe(true);
      const bodies = () =>
        db.all<{ body: string }>(sql`select body from sale order by id`).map((row) => row.body);
      expect(bodies()).toEqual(["committed before"]);

      small.unfill();
      await store.withWriteLock(async () => {
        db.run(sql`insert into sale (body) values ('after freeing')`);
      });
      expect(bodies()).toEqual(["committed before", "after freeing"]);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  it("the full-disk email goes out directly while the queue refuses its row; with room, the low-space email is queued", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("email-queue"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    const now = new Date("2026-11-10T00:00:00.000Z");
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    let full = true;
    const send = vi.fn(async () => "sent" as const);
    const armed: (() => void)[] = [];
    let handle: ReturnType<typeof startBoxEmailDuty> | undefined;
    try {
      await seedVenue(db, {
        name: "Corner Bistro",
        invoiceLocales: ["en-GB"],
        operationDescription: "Sale",
      });
      const [admin] = await seedPersons(db, {
        displayName: "Admin",
        role: "admin",
        email: "admin@example.test",
      });
      await withTransaction(db, () => {});
      expect(db.all(sql`select count(*) as n from change_log`)).toEqual([{ n: 0 }]);
      db.all(sql`pragma wal_checkpoint(truncate)`);
      handle = startBoxEmailDuty({
        db,
        now: () => now,
        disk: { since: () => (full ? now : null) },
        space: { current: () => ({ freeBytes: 1, readAt: now, lowSince: now }) },
        moduleNotices: async () => ({ notices: [], unavailable: [] }),
        emailedIncidents: () => readOpenEmailedIncidents(db),
        backupStopped: () => undefined,
        context: () => readBoxEmailContext(db, { ring, practiceMode: true, venueLanguage: "en" }),
        send,
        isPrimary: () => true,
        intervalMs: 60000,
        log: () => {},
        timer: (_ms, fn) => {
          armed.push(fn);
          return { cancel: () => {} };
        },
      });
      small.fill(0);
      armed.at(-1)!();
      await vi.waitFor(() => expect(armed).toHaveLength(2));
      expect(send).toHaveBeenCalledExactlyOnceWith({
        smtp: { url: "smtp://127.0.0.1:1025", from: "Waitron <no-reply@waitron.test>" },
        recipient: "admin@example.test",
        ...boxEmailMessage("storage.disk_full", "en", "Corner Bistro"),
      });
      await expect(
        withTransaction(db, (tx) =>
          enqueueMail(tx, {
            kind: "box_alert",
            dedupeKey: `alert:probe:${admin!.id}`,
            personId: admin!.id,
            params: { code: "storage.space_low", wording: null },
            now,
            notAfter: new Date(now.getTime() + 86400000),
          }),
        ),
      ).rejects.toMatchObject({ code: "storage.disk_full" });
      expect(await db.select().from(outgoingMail)).toEqual([]);
      small.unfill();
      full = false;
      // The full-disk email reached the administrator, so only the new manager needs this one.
      const [added] = await withTransaction(db, (tx) =>
        seedPersons(tx, {
          displayName: "New manager",
          role: "manager",
          email: "new@example.test",
        }),
      );
      armed.at(-1)!();
      await vi.waitFor(() => expect(armed).toHaveLength(3));
      expect(send).toHaveBeenCalledTimes(1);
      expect(await db.select().from(outgoingMail)).toEqual([
        expect.objectContaining({
          kind: "box_alert",
          status: "pending",
          personId: added!.id,
          params: { code: "storage.space_low", wording: "null" },
        }),
      ]);
    } finally {
      small.unfill();
      await handle?.stop();
      await store.close();
      // Leave room on the shared small filesystem for the remaining cases.
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the equipment read answers on a full disk with a stamp due", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("equipment"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    try {
      await seedVenue(db, {
        name: "Main",
        invoiceLocales: ["en-GB"],
        operationDescription: "Sale",
      });
      const { deviceId } = await seedDevice(db, { label: "Till 1" });
      const token = "equipment-token";
      await db
        .update(devices)
        .set({ tokenHash: hashDeviceToken(token) })
        .where(eq(devices.id, deviceId));
      const app = new Hono();
      mountDeviceApi(
        app,
        { db, cfg: {} as never, secureCookies: false, pairingMode: createPairingMode() },
        () => {},
      );
      const status = async () =>
        (
          await app.request("/api/device/equipment", {
            headers: { cookie: `waitron_device=${deviceId}.${token}` },
          })
        ).status;
      const lastSeen = async () => {
        const [row] = await db
          .select({ lastSeenAt: devices.lastSeenAt })
          .from(devices)
          .where(eq(devices.id, deviceId));
        return row!.lastSeenAt;
      };
      const seenWhileFull = async (lastSeenAt: string) => {
        small.unfill();
        await db.update(devices).set({ lastSeenAt }).where(eq(devices.id, deviceId));
        db.all(sql`pragma wal_checkpoint(truncate)`);
        small.fill(0);
      };

      expect(await status()).toBe(200);

      await seenWhileFull(new Date().toISOString());
      expect(await status()).toBe(200);

      const longAgo = "2020-01-01T00:00:00.000Z";
      await seenWhileFull(longAgo);
      expect(await status()).toBe(200);
      expect(await status()).toBe(200);
      expect(await lastSeen()).toBe(longAgo);

      small.unfill();
      expect(await status()).toBe(200);
      expect(await lastSeen()).not.toBe(longAgo);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  describe("a print agent with a stamp due", () => {
    const longAgo = "2020-01-01T00:00:00.000Z";

    async function agentVenue(small: SmallDisk, folder: string) {
      const dir = realpathSync(small.folder(folder));
      await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
      const store = await openVenueDatabase(dir);
      const db = store.venue;
      const secret = randomBytes(32).toString("base64url");
      let agentId: string;
      try {
        await seedVenue(db, {
          name: "Main",
          invoiceLocales: ["en-GB"],
          operationDescription: "Sale",
        });
        const [row] = await db
          .insert(printAgents)
          .values({
            name: "Agent",
            tokenHash: hashDeviceToken(secret),
            active: true,
          })
          .returning({ id: printAgents.id });
        agentId = row!.id;
      } catch (error) {
        await store.close();
        throw error;
      }
      const lastSeen = async () => {
        const [found] = await db
          .select({ lastSeenAt: printAgents.lastSeenAt })
          .from(printAgents)
          .where(eq(printAgents.id, agentId));
        return found!.lastSeenAt;
      };
      const changedWhileFull = async (change: Partial<typeof printAgents.$inferInsert>) => {
        small.unfill();
        await db.update(printAgents).set(change).where(eq(printAgents.id, agentId));
        db.all(sql`pragma wal_checkpoint(truncate)`);
        small.fill(0);
      };
      return { store, db, agentId, token: `${agentId}.${secret}`, lastSeen, changedWhileFull };
    }

    const codeOf = (attempt: Promise<unknown>) =>
      attempt.then(
        () => undefined,
        (error: { code?: string }) => error.code,
      );

    it("is accepted unstamped, refused once revoked or given a new key, and stamped once there is room", async (ctx) => {
      const small = needDisk(ctx);
      const { store, db, agentId, token, lastSeen, changedWhileFull } = await agentVenue(
        small,
        "agent-auth",
      );
      try {
        await changedWhileFull({ lastSeenAt: longAgo });
        expect(await authenticateAgent(db, token)).toEqual({ agentId });
        expect(await authenticateAgent(db, token)).toEqual({ agentId });
        expect(await lastSeen()).toBe(longAgo);

        await changedWhileFull({ active: false });
        expect(await codeOf(authenticateAgent(db, token))).toBe("agent.unauthorized");

        const newSecret = randomBytes(32).toString("base64url");
        await changedWhileFull({ active: true, tokenHash: hashDeviceToken(newSecret) });
        expect(await codeOf(authenticateAgent(db, token))).toBe("agent.unauthorized");
        const newToken = `${agentId}.${newSecret}`;
        expect(await authenticateAgent(db, newToken)).toEqual({ agentId });
        expect(await lastSeen()).toBe(longAgo);

        small.unfill();
        expect(await authenticateAgent(db, newToken)).toEqual({ agentId });
        expect(await lastSeen()).not.toBe(longAgo);
      } finally {
        small.unfill();
        await store.close();
      }
    });

    it("is answered with no jobs when it polls with nothing waiting and its host name unchanged, and saves no stamp", async (ctx) => {
      const small = needDisk(ctx);
      const { store, db, token, lastSeen, changedWhileFull } = await agentVenue(
        small,
        "agent-poll",
      );
      try {
        const app = new Hono();
        mountPrintApi(
          app,
          {
            db,
            cfg: { nodeId: brandNodeId(randomUUID()), locale: "en-GB" } as never,
            pairingMode: createPairingMode(),
            readMembership: () => Promise.resolve(null),
            readInvoiceDocument: () => Promise.reject(new Error("No invoice is read here")),
            layOutSaleReceipt: () => Promise.reject(new Error("No receipt is laid out here")),
            venueLocale: "en-GB",
          },
          () => {},
        );
        await changedWhileFull({ lastSeenAt: longAgo, host: "agent-host" });

        const res = await app.request("/print-api/agent/jobs", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ host: "agent-host" }),
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ jobs: [] });
        expect(await lastSeen()).toBe(longAgo);
      } finally {
        small.unfill();
        await store.close();
      }
    });
  });

  it("the till's reads answer on a full disk with a stamp due, PIN sign-in still refuses, and a sign-out ends only what it can write", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("till-session"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    try {
      const venue = await provisionBillVenue(db);
      const deviceCookie = venue.cookie
        .split("; ")
        .find((part) => part.startsWith("waitron_device"))!;
      const request = (
        path: string,
        cookie: string,
        init: { method?: string; body?: unknown } = {},
      ) =>
        venue.app.request(path, {
          method: init.method ?? "GET",
          headers: { cookie, "content-type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
      const lastSeen = () =>
        db.all<{ lastSeenAt: string | null }>(
          sql`select last_seen_at as lastSeenAt from devices where id = ${venue.deviceId}`,
        )[0]!.lastSeenAt;
      const sessionCount = () =>
        db.all<{ n: number }>(sql`select count(*) as n from sessions`)[0]!.n;

      const longAgo = "2020-01-01T00:00:00.000Z";
      small.unfill();
      db.run(sql`update devices set last_seen_at = ${longAgo} where id = ${venue.deviceId}`);
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      expect((await request("/api/till", deviceCookie)).status).toBe(200);
      expect((await request("/api/working-orders", venue.cookie)).status).toBe(200);
      expect(lastSeen()).toBe(longAgo);
      const before = sessionCount();
      const signIn = await request("/api/session", deviceCookie, {
        method: "POST",
        body: { personId: venue.operatorId, pin: "5555" },
      });
      expect(signIn.status).toBe(507);
      expect(await signIn.json()).toMatchObject({ error: { code: "storage.disk_full" } });
      expect(sessionCount()).toBe(before);

      const openSessions = () =>
        db.all<{ n: number }>(sql`select count(*) as n from sessions where ended_at is null`)[0]!.n;
      const signOut = (cookie: string) =>
        venue.app.request("/api/session", {
          method: "DELETE",
          headers: { cookie, [PERSON_HEADER]: venue.operatorId },
        });
      const open = openSessions();
      const unknown = await signOut(`${SESSION_COOKIE}=${randomUUID()}; ${deviceCookie}`);
      expect(unknown.status).toBe(200);
      const own = await signOut(venue.cookie);
      expect(own.status).toBe(507);
      expect(await own.json()).toMatchObject({ error: { code: "storage.disk_full" } });
      expect(openSessions()).toBe(open);

      small.unfill();
      expect((await request("/api/working-orders", venue.cookie)).status).toBe(200);
      expect(lastSeen()).not.toBe(longAgo);
    } finally {
      small.unfill();
      await store.close();
    }
  });
  it("the notice reader answers on a full disk with a change waiting, and a source that writes fails alone", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("notices"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    try {
      db.run(sql`create table zz (id integer primary key, pad blob)`);
      const sources: OwnedStaffNoticeSource[] = [
        {
          owner: "box",
          source: {
            read: () =>
              Promise.resolve([
                {
                  key: "storage.disk_full",
                  code: "storage.disk_full",
                  severity: "error",
                  params: {},
                },
              ]),
          },
        },
        {
          owner: "writer",
          source: {
            read: ({ tx }) => {
              tx.run(sql`insert into zz (pad) values (zeroblob(16))`);
              return Promise.resolve([{ key: "w", code: "w.w", severity: "error", params: {} }]);
            },
          },
        },
        {
          owner: "count",
          source: {
            read: ({ tx }) => {
              const [row] = tx.all<{ n: number }>(
                sql`select count(*) as n from envios where estado in ('pendiente', 'enviando', 'detenido', 'retenido')`,
              );
              return Promise.resolve([
                { key: "unsent", code: "x.unsent", severity: "notice", params: { count: row!.n } },
              ]);
            },
          },
        },
      ];
      db.run(
        sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
      );
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      const read = () =>
        readStaffNoticesInTurns(db, sources, {
          reading: { instant: new Date(), offsetMinutes: 0 },
          log: () => {},
        });
      for (let i = 0; i < 2; i += 1) {
        const result = await read();
        expect(result.notices.map((x) => `${x.owner}:${x.key}`)).toEqual([
          "box:storage.disk_full",
          "count:unsent",
        ]);
        expect(result.unavailable).toEqual(["writer"]);
      }

      small.unfill();
      expect(db.all<{ n: number }>(sql`select count(*) as n from zz`)).toEqual([{ n: 0 }]);
      expect(db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  it("the managers' email reads its context on a full disk with a change waiting", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("email-context"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    try {
      await seedVenue(db, {
        name: "Corner Bistro",
        invoiceLocales: ["en-GB"],
        operationDescription: "Sale",
      });
      const [admin] = await seedPersons(db, {
        displayName: "Admin",
        role: "admin",
        email: "admin@example.test",
      });
      db.run(
        sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
      );
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      for (let i = 0; i < 2; i += 1) {
        const context = await readBoxEmailContext(db, {
          ring,
          practiceMode: true,
          venueLanguage: "en",
        });
        expect(context.venue).toBe("Corner Bistro");
        expect(context.recipients).toEqual([
          { personId: admin!.id, email: "admin@example.test", language: "en" },
        ]);
        expect(context.delivery.mode).toBe("local_capture");
      }
      await expect(resolveEmailDelivery(db, ring, true)).rejects.toEqual(
        expect.objectContaining({ code: "storage.disk_full" }),
      );

      small.unfill();
      expect(db.all<{ id: string }>(sql`select id from change_log`)).toEqual([{ id: "zz1" }]);
    } finally {
      small.unfill();
      await store.close();
    }
  });

  it("the equipment read answers with the red notice on a full disk with a change waiting", async (ctx) => {
    const small = needDisk(ctx);
    const dir = realpathSync(small.folder("equipment-notices"));
    await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
    const store = await openVenueDatabase(dir);
    const db = store.venue;
    const disk = createDiskFullState({ dir, now: () => new Date(), log: () => {} });
    const unwatch = watchForDiskFull(disk, [store.venue, store.node]);
    try {
      await seedVenue(db, {
        name: "Main",
        invoiceLocales: ["en-GB"],
        operationDescription: "Sale",
      });
      const { deviceId } = await seedDevice(db, { label: "Till 1" });
      const token = "equipment-notices-token";
      await db
        .update(devices)
        .set({ tokenHash: hashDeviceToken(token), lastSeenAt: "2020-01-01T00:00:00.000Z" })
        .where(eq(devices.id, deviceId));
      db.run(sql`create table zz (id integer primary key, pad blob)`);
      // The full disk refuses this insert too, so this case shows the writer failing alone, not
      // why; the changed-row rule is checked by `readStaffNoticesInTurns`' own cases.
      const writer: OwnedStaffNoticeSource = {
        owner: "writer",
        source: {
          read: ({ tx }) => {
            tx.run(sql`insert into zz (pad) values (zeroblob(16))`);
            return Promise.resolve([]);
          },
        },
      };
      const app = new Hono();
      mountDeviceApi(
        app,
        {
          db,
          cfg: {} as never,
          secureCookies: false,
          pairingMode: createPairingMode(),
          notices: {
            sources: [
              ...deviceNoticeSources({ disk, space: createFreeSpaceState({ log: () => {} }) }, []),
              writer,
            ],
            clock: {
              now: () => ({ instant: new Date(), offsetMinutes: 0, confident: true }) as never,
            },
            filing: () => ({ enabled: false }),
          },
        },
        () => {},
      );
      db.run(
        sql`insert into change_log (id, payload) values ('zz1', '{"resource":"zz","id":"1"}')`,
      );
      db.all(sql`pragma wal_checkpoint(truncate)`);
      small.fill(0);

      for (let i = 0; i < 2; i += 1) {
        const res = await app.request("/api/device/equipment", {
          headers: { cookie: `waitron_device=${deviceId}.${token}` },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          roles: unknown;
          notices: { key: string; owner: string }[];
          noticesUnavailable: string[];
        };
        expect(Array.isArray(body.roles)).toBe(true);
        expect(body.notices.map(({ key, owner }) => ({ key, owner }))).toEqual([
          { key: "storage.disk_full", owner: "box" },
        ]);
        expect(body.noticesUnavailable).toEqual(["writer"]);
      }
    } finally {
      unwatch();
      small.unfill();
      await store.close();
    }
  });
});

describe("a Start again choice on a real full disk", () => {
  it("a Move on a full disk: a wrong password is answered as a full disk, nothing is recorded or moved, and the page says the disk is full with its next step", async (ctx) => {
    const small = needDisk(ctx);
    const attempt = await startAgainAttempt(realpathSync(small.folder("start-again-move")));
    const { stateDir, venueDir } = attempt.roots;
    const found = join(venueDir, "venue.db");
    writeFileSync(found, "found database");
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
    });
    const ca = readFileSync(join(stateDir, "tls", "ca.crt"));

    const [port] = await freePorts(1);
    let served: Awaited<ReturnType<typeof serveRecovery>> | undefined;
    const d = entryDeps(stateDir, {
      venueDir,
      baseEnv: { WAITRON_HTTP_LANDING_PORT: "0", WAITRON_HTTP_PORT: String(port) },
      serveRecovery: vi.fn(async (app: Hono, opts: RecoveryServeOptions) => {
        served = await serveRecovery(app, opts);
        return served;
      }),
    });
    try {
      await runEntry(d);
      expect(d.startServer).not.toHaveBeenCalled();
      const page = await pageOver(port!, ca);
      expect(page.body).toContain("<li>venue/venue.db</li>");
      const listed = /name="listed" value="([0-9a-f]{64})"/.exec(page.body)?.[1];
      expect(listed).toBeDefined();

      const marker = readFileSync(join(venueDir, START_AGAIN_MARKER_FILE));
      const setup = readFileSync(join(stateDir, "first-setup.json"));
      const foundInode = inodeOf(found);
      small.fill();
      expect(small.free()).toBeLessThan(65_536);

      const diskFull = escapeHtml(START_AGAIN_PAGE_TEXT["en-GB"].diskFull);
      // A wrong password is answered diskFull, not wrongPassword.
      for (const password of ["not-the-password", START_AGAIN_ADMIN_PASSWORD]) {
        const answer = await postFormOver(port!, ca, "/recovery-api/start-again", {
          password,
          choice: "move",
          listed: listed!,
        });
        expect(answer.status).toBe(409);
        expect(answer.body).toContain(`<p id="start-again-message">${diskFull}</p>`);
        expect(answer.body).not.toContain(escapeHtml(START_AGAIN_PAGE_TEXT["en-GB"].wrongPassword));
        expect(answer.body).toContain('value="move" required checked');
      }

      for (const name of [START_AGAIN_CHOICES_DIR, START_AGAIN_SET_ASIDE_DIR])
        expect(() => statSync(join(stateDir, name))).toThrow(
          expect.objectContaining({ code: "ENOENT" }),
        );
      expect(() => statSync(join(venueDir, START_AGAIN_SET_ASIDE_DIR))).toThrow(
        expect.objectContaining({ code: "ENOENT" }),
      );
      expect(() => statSync(join(stateDir, START_AGAIN_GUESSES_FILE))).toThrow(
        expect.objectContaining({ code: "ENOENT" }),
      );
      expect(readFileSync(found, "utf8")).toBe("found database");
      expect(inodeOf(found)).toBe(foundInode);
      expect(readFileSync(join(venueDir, START_AGAIN_MARKER_FILE))).toEqual(marker);
      expect(readFileSync(join(stateDir, "first-setup.json"))).toEqual(setup);
      expect(d.exit).not.toHaveBeenCalled();
    } finally {
      const server = served;
      if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
