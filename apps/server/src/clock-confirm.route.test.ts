import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { incidents as incidentRows, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, startManagementSession, type BuiltInRoleKey } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { jobOrigin } from "@waitron/shared";
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
import {
  clockCheckWaitingReader,
  clockStopReader,
  collectBoxHealth,
  type BoxHealth,
  type BoxHealthReaders,
} from "./box-health.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { mountDeviceApi } from "./device-api.js";
import {
  ALL_ALERT_CLAIMS,
  ALL_MODULES,
  enabledAlertSources,
  enabledStaffNoticeSources,
} from "./modules.js";
import { createPairingMode } from "./pairing-mode.js";
import { createStaffNoticeLog } from "./staff-notices.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";
import type { Logger } from "./logger.js";

const MINUTE = 60_000;

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let marta: Manager;
let mario: Manager;

interface Manager {
  id: string;
  cookie: string;
}

async function seedPerson(role: BuiltInRoleKey, name: string): Promise<Manager> {
  return withTransaction(venue.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: name, pinHash: hashPin("1234"), role });
    const session = await startManagementSession(tx, { personId: person!.id });
    return { id: person!.id, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

// Every case reads NOW, the latest record's time, and builds each clock from it, because each sale
// moves NOW for the cases after it.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      const catalogue = await createCatalogue(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const dish = await createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      dishId = dish.id;
      await assignCatalogueToVenue(tx, catalogue.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [dishId] });
    });
    const first = await cashSale(venue.app);
    if (first.status !== 200) throw new Error(`setup sale answered ${first.status}`);
    marta = await seedPerson("manager", "Martha");
    mario = await seedPerson("admin", "Mario");
  },
});

function latest(): { id: string; at: Date } {
  const [row] = venue.db.all<{ id: string; at: string }>(sql`
    select id, fecha_hora_huso_gen_registro as at
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc, id desc
    limit 1
  `);
  return { id: row!.id, at: new Date(row!.at) };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

function cashSale(app: BillVenue["app"]) {
  return send(app, venue.cookie, "POST", "/api/sales", {
    workingOrderId: randomUUID(),
    zoneId: counter.zoneId,
    lines: [{ menuItemId: counter.offerFor(dishId), quantity: "1" }],
    tender: { method: "cash", amount: "10.00" },
  });
}

interface Stop {
  /** The box's reading, `gapMs` behind the latest record. */
  behind: number;
  recordId: string;
  witnesses: ClockWitnessStore;
  /** Box status, the confirmation routes, the equipment read and the managers' alerts, on the
   * box's clock. */
  app: Hono;
  /** Moves the box's clock, which every route on `app` reads. */
  setClock(ms: number): void;
  /** Moves the steady clock the challenges are timed on. */
  setSteady(ms: number): void;
  /** Moves the box's boot-time clock the confirmation reads. */
  setBoot(boot: BootReading): void;
  /** Whether the box's routes see a request as made on the box itself. */
  setFromBox(fromBox: boolean): void;
  /** The box's clock that `setClock` moves. */
  clock: TrustedClock;
  /** The Box status read over `db`, on the box's clock. */
  health(db?: Database): Promise<BoxHealth>;
}

function healthReaders(
  stop: Pick<Stop, "witnesses">,
  clock: TrustedClock,
  backend: FiscalBackend,
): BoxHealthReaders {
  return {
    now: () => clock.now().instant,
    notices: { sources: [], clock, filing: () => true, log: createStaffNoticeLog(() => {}) },
    stream: () => ({ state: "off" }),
    authorityClock: () => ({ state: "ok", driftSeconds: 0, measuredAt: "2026-10-22T09:00:00Z" }),
    timeHealth: async () => ({ synced: true, source: "timedatectl", warn: false }),
    disk: { since: () => null },
    space: { current: () => ({ freeBytes: null, readAt: null, lowSince: null }) },
    usage: async () => ({
      freeBytes: 1,
      totalBytes: 100,
      databaseBytes: 1,
      backupsBytes: 1,
      logBytes: 1,
      otherBytes: 1,
    }),
    free: async () => 1,
    leftovers: async () => ({ bytes: 0, backupRunning: false }),
    paymentsEnabled: true,
    canFree: () => true,
    clockStop: clockStopReader({ backend, witnesses: () => stop.witnesses.witnesses(), clock }),
    clockCheckWaiting: clockCheckWaitingReader({ backend, clock }),
  };
}

const BOOT: BootReading = { ms: 7_200_000, id: "boot-route-test" };

/** A new latest record a second after NOW (records keep whole seconds, so a sale at NOW itself
 * could tie with the record it should follow), then a box whose clock reads `gapMs` behind it,
 * with an empty witness store that judges freshness at that reading. Requests are off the box
 * unless `setFromBox(true)`. */
async function stoppedBox(
  gapMs: number,
  options: {
    backend?: FiscalBackend;
    devMode?: boolean;
    boot?: BootReading;
    language?: "en" | "es";
  } = {},
): Promise<Stop> {
  const backend = options.backend ?? venue.backend;
  const sale = await cashSale(venue.appAt(clockAt(nowMs() + 1000)));
  if (sale.status !== 200) throw new Error(`sale answered ${sale.status}`);
  const record = latest();
  const behind = record.at.getTime() - gapMs;
  const witnesses = createClockWitnessStore({ wall: () => behind, monotonic: () => 0 });
  let boxMs = behind;
  let steadyMs = 0;
  let fromBox = false;
  let boot = options.boot ?? BOOT;
  const base = systemClock();
  const clock: TrustedClock = {
    ...base,
    now: () => ({ ...base.now(), instant: new Date(boxMs), offsetMinutes: 60 }),
  };
  const app = new Hono();
  const health = (db: Database = venue.db) =>
    collectBoxHealth(db, healthReaders({ witnesses }, clock, backend));
  mountBoxHealthApi(
    app,
    {
      db: venue.db,
      readHealth: () => health(),
      freeSpace: () => Promise.reject(new Error("not freed here")),
      restart: () => {},
      venue: { language: options.language ?? "en" },
      clockConfirm: {
        backend,
        witnesses: () => witnesses.witnesses(),
        clearWitnesses: () => witnesses.clear(),
        clock,
        nodeId: venue.cfg.nodeId,
        steady: () => steadyMs,
        readBoot: () => boot,
        requestFromBox: () => fromBox,
        devMode: options.devMode ?? false,
      },
    },
    () => {},
  );
  mountDeviceApi(
    app,
    {
      db: venue.db,
      cfg: venue.cfg,
      secureCookies: false,
      pairingMode: createPairingMode(),
      notices: {
        sources: enabledStaffNoticeSources(ALL_MODULES),
        clock,
        filing: () => ({ enabled: true }),
      },
      clockWitnesses: witnesses,
      clock: { wall: () => boxMs, monotonic: () => 0 },
      requestFromBox: () => false,
    },
    () => {},
  );
  mountAlertsApi(
    app,
    {
      db: venue.db,
      registry: createAlertRegistry({
        claims: ALL_ALERT_CLAIMS,
        sources: enabledAlertSources(ALL_MODULES),
      }),
      now: () => new Date(boxMs),
    },
    () => {},
  );
  return {
    behind,
    recordId: record.id,
    witnesses,
    app,
    setClock: (ms) => {
      boxMs = ms;
    },
    setSteady: (ms) => {
      steadyMs = ms;
    },
    setBoot: (reading) => {
      boot = reading;
    },
    setFromBox: (value) => {
      fromBox = value;
    },
    clock,
    health,
  };
}

function ask(stop: Stop, cookie: string | undefined) {
  return send(stop.app, cookie ?? "", "POST", "/api/box/clock-challenge");
}

function answerChallenge(stop: Stop, cookie: string | undefined, body: unknown) {
  return send(stop.app, cookie ?? "", "POST", "/api/box/clock-confirm", body);
}

/** The box's time on the stop's clock. */
const boxTime = (stop: Stop) => stop.clock.now().instant.getTime();

/** A challenge, then the answer from a device whose clock reads `offsetMs` from the box's. */
async function confirm(stop: Stop, cookie: string | undefined, offsetMs = 0) {
  const asked = await ask(stop, cookie);
  if (asked.status !== 200) return asked;
  return answerChallenge(stop, cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxTime(stop) + offsetMs,
  });
}

function count(table: "clock_confirmations" | "clock_checks"): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)}`,
  );
  return row!.n;
}

function incidents(code: string): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from incidents where code = ${code}`,
  );
  return row!.n;
}

function written() {
  return {
    confirmations: count("clock_confirmations"),
    checks: count("clock_checks"),
    alerts: incidents("clock.behind_chain_restarted"),
  };
}

const refusal = (reason: string) => ({ code: "clock.confirm_refused", params: { reason } });

it("refuses a confirmation with no stop and no check waiting", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  stop.setClock(latest().at.getTime());
  const before = written();

  const notStopped = await confirm(stop, mario.cookie);

  expect(notStopped.status).toBe(409);
  expect(notStopped.json).toEqual(refusal("not_stopped"));
  expect(written()).toEqual(before);
});

it("refuses a body that is not a challenge id and a whole number of milliseconds", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();
  const challengeId = randomUUID();

  const bodies: [unknown, string][] = [
    [{}, "challengeId"],
    [null, "challengeId"],
    [[challengeId], "challengeId"],
    [{ challengeId: 7, deviceAt: stop.behind }, "challengeId"],
    [{ challengeId: "", deviceAt: stop.behind }, "challengeId"],
    [{ challengeId }, "deviceAt"],
    [{ challengeId, deviceAt: String(stop.behind) }, "deviceAt"],
    [{ challengeId, deviceAt: stop.behind + 0.5 }, "deviceAt"],
    [{ challengeId, deviceAt: 2 ** 53 }, "deviceAt"],
    [{ challengeId, deviceAt: 8.64e15 + 1 }, "deviceAt"],
  ];
  for (const [bad, field] of bodies) {
    const refusedBody = await answerChallenge(stop, mario.cookie, bad);
    expect(refusedBody.status, JSON.stringify(bad)).toBe(400);
    expect(refusedBody.json).toEqual({ code: "management.request_invalid", params: { field } });
  }
  const unparsed = await stop.app.request("/api/box/clock-confirm", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: mario.cookie },
    body: `{ challengeId: ${challengeId}`,
  });
  expect(unparsed.status).toBe(400);
  expect(await unparsed.json()).toEqual({
    error: { code: "management.request_invalid", params: { field: "challengeId" } },
  });
  expect(written()).toEqual(before);
});

it("has no confirmation routes when the fiscal seat cannot confirm", async () => {
  const backend = Object.create(venue.backend, {
    confirmClockStop: { value: undefined },
  }) as FiscalBackend;
  const stop = await stoppedBox(10 * MINUTE, { backend });
  const before = written();

  expect((await ask(stop, mario.cookie)).status).toBe(404);
  expect(
    (
      await answerChallenge(stop, mario.cookie, {
        challengeId: randomUUID(),
        deviceAt: stop.behind,
      })
    ).status,
  ).toBe(404);
  expect(written()).toEqual(before);
});

it("collects the clock witnesses before it takes the box's reading", async () => {
  const steps: string[] = [];
  const base = systemClock();
  const read = clockStopReader({
    backend: { clockStopState: async () => null },
    witnesses: () => {
      steps.push("witnesses");
      return [];
    },
    clock: {
      now: () => {
        steps.push("reading");
        return base.now();
      },
    },
  });

  expect(await read(venue.db)).toBeNull();
  expect(steps).toEqual(["witnesses", "reading"]);
});

it("shows a restart whose person has no row with no name", async () => {
  const state = {
    clockAt: "2026-10-22T09:00:00.000Z",
    offsetMinutes: 60,
    lastRecordAt: "2026-10-22T09:10:00.000Z",
    lastRecordOffsetMinutes: 60,
    recordId: "record-1",
    gapMs: 10 * MINUTE,
    proof: "confirmed" as const,
    agreeing: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
    confirmation: {
      id: "confirmation-1",
      source: "admin" as const,
      personId: randomUUID(),
      confirmedAt: "2026-10-22T09:00:00.000Z",
    },
  };
  const read = clockStopReader({
    backend: { clockStopState: async () => state },
    witnesses: () => [],
    clock: systemClock(),
  });

  expect((await read(venue.db))?.confirmation).toEqual({
    id: "confirmation-1",
    source: "admin",
    personName: null,
    confirmedAt: "2026-10-22T09:00:00.000Z",
  });
});

it("says whether the start-up window is open at the read, and closed with no window", async () => {
  const state = {
    clockAt: "2026-10-22T09:00:00.000Z",
    offsetMinutes: 60,
    lastRecordAt: "2026-10-22T09:10:00.000Z",
    lastRecordOffsetMinutes: 60,
    recordId: "record-1",
    gapMs: 10 * MINUTE,
    proof: "ready" as const,
    agreeing: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
    confirmation: null,
  };
  let open = true;
  const deps = {
    backend: { clockStopState: async () => state },
    witnesses: () => [],
    clock: systemClock(),
  };
  const read = clockStopReader({ ...deps, startUp: { open: () => open } });

  expect((await read(venue.db))?.startUp).toBe(true);
  open = false;
  expect((await read(venue.db))?.startUp).toBe(false);
  expect((await clockStopReader(deps)(venue.db))?.startUp).toBe(false);
});

async function healthOf(stop: Stop): Promise<BoxHealth> {
  const answer = await send(stop.app, marta.cookie, "GET", "/api/box/health");
  expect(answer.status).toBe(200);
  return answer.json as unknown as BoxHealth;
}

interface MisdatedLists {
  lists: {
    confirmationId: string;
    records: {
      recordId: string;
      series: string;
      number: number | null;
      at: string;
      offsetMinutes: number;
    }[];
  }[];
}

interface MisdatedHandledEpisodes {
  episodes: (Record<string, unknown> & {
    confirmationId: string;
    records: MisdatedLists["lists"][number]["records"] | null;
  })[];
}

async function misdatedHandledOf(app: Hono): Promise<MisdatedHandledEpisodes> {
  const answer = await send(app, marta.cookie, "GET", "/api/box/clock-misdated/handled");
  expect(answer.status).toBe(200);
  return answer.json as unknown as MisdatedHandledEpisodes;
}

async function misdatedOf(app: Hono, cookie = marta.cookie): Promise<MisdatedLists> {
  const answer = await send(app, cookie, "GET", "/api/box/clock-misdated");
  expect(answer.status).toBe(200);
  return answer.json as unknown as MisdatedLists;
}

function handOpenMisdated(at: number): void {
  // An earlier case's open alert naming the same first sale would stand for the next one.
  venue.db.run(
    sql`update incidents set acknowledged_at = ${new Date(at).toISOString()}
        where code = 'clock.records_misdated' and acknowledged_at is null`,
  );
}

function misdatedIncident(confirmationId: string): string {
  const [row] = venue.db.all<{ id: string }>(
    sql`select id from incidents where code = 'clock.records_misdated'
        and json_extract(params, '$.confirmationId') = ${confirmationId}`,
  );
  return row!.id;
}

/** A Box status app whose routes read and write `db`. */
function boxApp(stop: Stop, db: Database, log: Logger = () => {}): Hono {
  const app = new Hono();
  mountBoxHealthApi(
    app,
    {
      db,
      readHealth: () => stop.health(db),
      freeSpace: () => Promise.reject(new Error("not freed here")),
      restart: () => {},
      venue: { language: "en" },
      clockConfirm: {
        backend: venue.backend,
        witnesses: () => stop.witnesses.witnesses(),
        clearWitnesses: () => stop.witnesses.clear(),
        clock: stop.clock,
        nodeId: venue.cfg.nodeId,
        steady: () => 0,
        readBoot: () => BOOT,
        requestFromBox: () => false,
        devMode: false,
      },
    },
    log,
  );
  return app;
}

it("says an alert that cannot tell which sales are dated wrongly is unconfirmed, with no count, and lists none for it", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const [sale] = venue.db.all<{ id: string }>(
    sql`select sale_id as id from registros_facturacion where id = ${stop.recordId}`,
  );
  const confirmationId = randomUUID();
  const from = new Date(stop.behind).toISOString();
  await venue.db.insert(incidentRows).values({
    source: jobOrigin("dashboard").source,
    saleId: sale!.id,
    code: "clock.records_misdated",
    params: {
      confirmationId,
      count: 0,
      from,
      fromOffsetMinutes: 60,
      partial: true,
      unconfirmed: true,
    },
    severity: "error",
    detectedAt: from,
  });
  try {
    expect(
      (await healthOf(stop)).misdatedOpen.find((entry) => entry.confirmationId === confirmationId),
    ).toEqual({
      incidentId: misdatedIncident(confirmationId),
      confirmationId,
      count: 0,
      from,
      fromOffsetMinutes: 60,
      partial: true,
      unconfirmed: true,
    });
    expect(
      (await misdatedOf(stop.app)).lists.some((list) => list.confirmationId === confirmationId),
    ).toBe(false);
  } finally {
    handOpenMisdated(stop.behind);
  }
});

it("logs an open alert whose closing the seat does not know, and lists none for it", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const confirmationId = randomUUID();
  const from = new Date(stop.behind).toISOString();
  await venue.db.insert(incidentRows).values({
    source: jobOrigin("dashboard").source,
    code: "clock.records_misdated",
    params: { confirmationId, count: 1, from, fromOffsetMinutes: 60, partial: false },
    severity: "error",
    detectedAt: from,
  });
  const logged: Parameters<Logger>[] = [];
  try {
    const lists = await misdatedOf(boxApp(stop, venue.db, (...entry) => void logged.push(entry)));
    expect(lists.lists.some((list) => list.confirmationId === confirmationId)).toBe(false);
    expect(logged).toContainEqual([
      "warn",
      "box-clock-misdated.unknown_confirmation",
      { confirmationId },
    ]);

    handOpenMisdated(stop.behind);
    logged.length = 0;
    const handled = await misdatedHandledOf(
      boxApp(stop, venue.db, (...entry) => void logged.push(entry)),
    );
    expect(
      handled.episodes.find((episode) => episode.confirmationId === confirmationId)?.records,
    ).toBeNull();
    expect(logged).toContainEqual([
      "warn",
      "box-clock-misdated.unknown_confirmation",
      { confirmationId },
    ]);
  } finally {
    handOpenMisdated(stop.behind);
  }
});

it("names no person for a confirmation no administrator made", async () => {
  const state = {
    clockAt: "2026-10-22T09:00:00.000Z",
    offsetMinutes: 60,
    lastRecordAt: "2026-10-22T09:10:00.000Z",
    lastRecordOffsetMinutes: 60,
    recordId: "record-1",
    gapMs: 10 * MINUTE,
    proof: "confirmed" as const,
    agreeing: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
    confirmation: {
      id: "confirmation-1",
      source: "devices" as const,
      personId: null,
      confirmedAt: "2026-10-22T09:00:00.000Z",
    },
  };
  const read = clockStopReader({
    backend: { clockStopState: async () => state },
    witnesses: () => [],
    clock: systemClock(),
  });

  expect((await read(venue.db))?.confirmation).toEqual({
    id: "confirmation-1",
    source: "devices",
    personName: null,
    confirmedAt: "2026-10-22T09:00:00.000Z",
  });
});

it("says no check waits on a seat that keeps no checks", async () => {
  const read = clockCheckWaitingReader({ backend: {}, clock: systemClock() });
  expect(await read(venue.db)).toBeNull();
});

const downloadPath = (incidentId: string) => `/api/box/clock-misdated/${incidentId}/download`;

it("logs a list alert whose closing the seat does not know, and downloads nothing for it", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const confirmationId = randomUUID();
  const from = new Date(stop.behind).toISOString();
  const [row] = await venue.db
    .insert(incidentRows)
    .values({
      source: jobOrigin("dashboard").source,
      code: "clock.records_misdated",
      params: {
        confirmationId,
        count: 1,
        from,
        fromOffsetMinutes: 60,
        to: from,
        toOffsetMinutes: 60,
        partial: false,
        unconfirmed: false,
      },
      severity: "error",
      detectedAt: from,
    })
    .returning({ id: incidentRows.id });
  const logged: Parameters<Logger>[] = [];
  try {
    const app = boxApp(stop, venue.db, (...entry) => void logged.push(entry));
    const answer = await send(app, marta.cookie, "GET", downloadPath(row!.id));
    expect(answer.status).toBe(404);
    expect(answer.json).toEqual({ code: "alert.not_found", params: { id: row!.id } });
    expect(logged).toContainEqual([
      "warn",
      "box-clock-misdated.unknown_confirmation",
      { confirmationId },
    ]);
  } finally {
    handOpenMisdated(stop.behind);
  }
});
