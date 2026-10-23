import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, persons, startManagementSession, type PersonRoleValue } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountAlertsApi } from "./alerts-api.js";
import { createAlertRegistry } from "./alerts.js";
import {
  clockStopReader,
  collectBoxHealth,
  type BoxHealth,
  type BoxHealthReaders,
  type ClockStopView,
} from "./box-health.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import { CLOCK_WATCH_MS, startClockWatch } from "./clock-watch.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_CLOCK_HEADER } from "./device-session.js";
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
import { writeRefusingDb } from "./testing/write-refusing-db.js";
import "./errors.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let marta: Manager;
let mario: Manager;
let sergio: Manager;

interface Manager {
  id: string;
  cookie: string;
}

async function seedPerson(role: PersonRoleValue, name: string): Promise<Manager> {
  return withTransaction(venue.db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: name, pinHash: hashPin("1234"), role })
      .returning({ id: persons.id });
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
      await assignCatalogueToLocation(tx, venue.cfg.locationId, catalogue.id);
      counter = await offerProducts(tx, venue.cfg, { productIds: [dishId] });
    });
    const first = await cashSale(venue.app);
    if (first.status !== 200) throw new Error(`setup sale answered ${first.status}`);
    marta = await seedPerson("manager", "Marta");
    mario = await seedPerson("manager", "Mario");
    sergio = await seedPerson("supervisor", "Sergio");
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
  /** Box status, the restart, the equipment read and the managers' alerts, on the box's clock. */
  app: Hono;
  /** Moves the box's clock, which every route on `app` reads. */
  setClock(ms: number): void;
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
  };
}

/** A new latest record a second after NOW (records keep whole seconds, so a sale at NOW itself
 * could tie with the record it should follow), then a box whose clock reads `gapMs` behind it,
 * with an empty witness store that judges freshness at that reading. */
async function stoppedBox(gapMs: number, backend: FiscalBackend = venue.backend): Promise<Stop> {
  const sale = await cashSale(venue.appAt(clockAt(nowMs() + 1000)));
  if (sale.status !== 200) throw new Error(`sale answered ${sale.status}`);
  const record = latest();
  const behind = record.at.getTime() - gapMs;
  const witnesses = createClockWitnessStore({ wall: () => behind, monotonic: () => 0 });
  let boxMs = behind;
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
      clockRestart: {
        backend,
        witnesses: () => witnesses.witnesses(),
        clock,
        nodeId: venue.cfg.nodeId,
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
    clock,
    health,
  };
}

/** A device whose clock read `offsetMs` from the box's, noted at the box's reading. */
function noteDevice(stop: Stop, offsetMs: number): void {
  stop.witnesses.noteDevice(randomUUID(), stop.behind + offsetMs, {
    wallMs: stop.behind,
    monoMs: 0,
  });
}

/** Runs `checks` checks of a clock watch on the stop's clock and witnesses, with no jump, on the
 * real fiscal seat except for AEAT's time, which `readAuthorityTime` answers. */
async function watchChecks(
  stop: Stop,
  checks: number,
  readAuthorityTime: FiscalBackend["readAuthorityTime"] = async () => null,
): Promise<void> {
  let fire = (): void => {};
  let armed = 0;
  const watch = startClockWatch({
    backend: Object.create(venue.backend, {
      readAuthorityTime: { value: readAuthorityTime },
    }) as FiscalBackend,
    store: stop.witnesses,
    clock: stop.clock,
    wall: () => 0,
    monotonic: () => 0,
    read: (fn) => venue.db.withWriteLock(() => fn(venue.db)),
    transaction: (fn) => withTransaction(venue.db, fn),
    filesRecords: () => true,
    isPrimary: () => true,
    intervalMs: CLOCK_WATCH_MS,
    log: () => {},
    timer: (_ms, fn) => {
      fire = fn;
      armed += 1;
      return { cancel: () => {} };
    },
  });
  for (let check = 1; check <= checks; check += 1) {
    fire();
    await vi.waitFor(() => expect(armed).toBe(check + 1));
  }
  await watch.stop();
}

function press(app: Hono, cookie: string | undefined, body: unknown) {
  return send(app, cookie ?? "", "POST", "/api/box/clock-restart", body);
}

function restarts(): number {
  const [row] = venue.db.all<{ n: number }>(sql`select count(*) as n from clock_stop_restarts`);
  return row!.n;
}

function restartedAlerts(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from incidents where code = 'clock.behind_chain_restarted'`,
  );
  return row!.n;
}

function written() {
  return { restarts: restarts(), alerts: restartedAlerts() };
}

it("refuses a restart with no proof, and payments stay stopped", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();

  const answer = await press(stop.app, marta.cookie, { recordId: stop.recordId });

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({ code: "clock.restart_refused", params: { reason: "no_proof" } });
  expect(written()).toEqual(before);
  const sale = await cashSale(venue.appAt(clockAt(stop.behind)));
  expect(sale.status).toBe(409);
  expect(sale.json).toMatchObject({ code: "clock.behind_chain" });
});

it("refuses a restart two devices contradict, and writes nothing", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 2 * HOUR);
  noteDevice(stop, 2 * HOUR);
  const before = written();

  const answer = await press(stop.app, marta.cookie, { recordId: stop.recordId });

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({
    code: "clock.restart_refused",
    params: { reason: "contrary_proof" },
  });
  expect(written()).toEqual(before);
});

it("refuses a restart 25 hours behind even with two agreeing devices, and allows 24 hours", async () => {
  const stop = await stoppedBox(25 * HOUR);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const before = written();

  const answer = await press(stop.app, marta.cookie, { recordId: stop.recordId });

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({ code: "clock.restart_refused", params: { reason: "too_far" } });
  expect(written()).toEqual(before);

  const day = await stoppedBox(24 * HOUR);
  noteDevice(day, 0);
  noteDevice(day, 0);
  const control = await press(day.app, marta.cookie, { recordId: day.recordId });
  expect(control.status).toBe(200);
  expect(control.json).toMatchObject({ replayed: false });
  expect(written()).toEqual({ restarts: before.restarts + 1, alerts: before.alerts + 1 });
});

it("refuses a person without system.manage, no session, a till's session and a bad body", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const before = written();
  const body = { recordId: stop.recordId };

  const supervisor = await press(stop.app, sergio.cookie, body);
  expect(supervisor.status).toBe(403);
  expect(supervisor.json).toMatchObject({ code: "authorization.not_permitted" });

  const none = await press(stop.app, undefined, body);
  expect(none.status).toBe(401);
  expect(none.json).toMatchObject({ code: "management_session.required" });

  const till = await press(stop.app, venue.cookie, body);
  expect(till.status).toBe(401);
  expect(till.json).toMatchObject({ code: "management_session.required" });

  for (const bad of [{}, { recordId: 7 }, { recordId: "" }, null, [stop.recordId]]) {
    const answer = await press(stop.app, marta.cookie, bad);
    expect(answer.status, JSON.stringify(bad)).toBe(400);
    expect(answer.json).toEqual({
      code: "management.request_invalid",
      params: { field: "recordId" },
    });
  }
  const unparsed = await stop.app.request("/api/box/clock-restart", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: marta.cookie },
    body: `{ recordId: ${stop.recordId}`,
  });
  expect(unparsed.status).toBe(400);
  expect(await unparsed.json()).toEqual({
    error: { code: "management.request_invalid", params: { field: "recordId" } },
  });
  expect(written()).toEqual(before);

  const control = await press(stop.app, marta.cookie, body);
  expect(control.status).toBe(200);
  expect(written()).toEqual({ restarts: before.restarts + 1, alerts: before.alerts + 1 });
});

it("still refuses a restart AEAT contradicted after the clock read a date before 28-10-2024 for one watch check", async () => {
  const stop = await stoppedBox(14.5 * HOUR);
  stop.witnesses.noteAuthority({
    authorityMs: stop.behind - 30_000 + 14.5 * HOUR,
    uncertaintyMs: 500,
    at: { wallMs: stop.behind - 30_000, monoMs: 0 },
  });
  const contradicted = await press(stop.app, marta.cookie, { recordId: stop.recordId });
  expect(contradicted.json).toEqual({
    code: "clock.restart_refused",
    params: { reason: "contrary_proof" },
  });

  stop.setClock(Date.parse("2001-01-01T12:00:00.000Z"));
  await watchChecks(stop, 1);

  stop.setClock(stop.behind);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const pressed = written();
  const answer = await press(stop.app, marta.cookie, { recordId: stop.recordId });

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({
    code: "clock.restart_refused",
    params: { reason: "contrary_proof" },
  });
  expect(written()).toEqual(pressed);
});

it("asks AEAT's time at every watch check while a restart is in force, until the clock reads within a minute of the last sale", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  expect((await press(stop.app, marta.cookie, { recordId: stop.recordId })).status).toBe(200);
  const readAuthorityTime = vi.fn(async () => null);

  await watchChecks(stop, 2, readAuthorityTime);
  expect(readAuthorityTime).toHaveBeenCalledTimes(2);

  stop.setClock(latest().at.getTime() - MINUTE);
  await watchChecks(stop, 1, readAuthorityTime);
  expect(readAuthorityTime).toHaveBeenCalledTimes(2);
});

it("answers a second restart of the same record with the first manager's", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const before = written();
  const record = latest();

  const first = await press(stop.app, marta.cookie, { recordId: stop.recordId });
  const second = await press(stop.app, mario.cookie, { recordId: stop.recordId });

  const restart = {
    personName: "Marta",
    restartedAt: new Date(stop.behind).toISOString(),
    clockAt: new Date(stop.behind).toISOString(),
    lastRecordAt: record.at.toISOString(),
  };
  expect(first.status).toBe(200);
  expect(first.json).toEqual({ restart, replayed: false });
  expect(second.status).toBe(200);
  expect(second.json).toEqual({ restart, replayed: true });
  expect(written()).toEqual({ restarts: before.restarts + 1, alerts: before.alerts + 1 });
});

it("answers two simultaneous presses with one restart and one replay", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const before = written();

  const answers = await Promise.all([
    press(stop.app, marta.cookie, { recordId: stop.recordId }),
    press(stop.app, mario.cookie, { recordId: stop.recordId }),
  ]);

  expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
  expect(answers.map((answer) => answer.json.replayed).sort()).toEqual([false, true]);
  expect(written()).toEqual({ restarts: before.restarts + 1, alerts: before.alerts + 1 });
});

it("has no restart to offer when the fiscal seat cannot restart", async () => {
  const backend = Object.create(venue.backend, {
    restartAfterClockStop: { value: undefined },
  }) as FiscalBackend;
  const stop = await stoppedBox(10 * MINUTE, backend);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const before = written();

  const answer = await press(stop.app, marta.cookie, { recordId: stop.recordId });

  expect(answer.status).toBe(404);
  expect(written()).toEqual(before);
});

/** The equipment read of the till `cookie` names, its clock header reading `deviceMs`. */
function equipmentRead(stop: Stop, cookie: string, deviceMs?: number) {
  return stop.app.request("/api/device/equipment", {
    headers: {
      cookie,
      ...(deviceMs === undefined ? {} : { [DEVICE_CLOCK_HEADER]: String(deviceMs) }),
    },
  });
}

async function noticeCodes(stop: Stop): Promise<string[]> {
  const response = await equipmentRead(stop, venue.cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { notices: { code: string }[] };
  return body.notices.map((notice) => notice.code);
}

async function alertCodes(stop: Stop): Promise<string[]> {
  const answer = await send(stop.app, marta.cookie, "GET", "/management-api/alerts");
  expect(answer.status).toBe(200);
  return (answer.json.alerts as { code: string }[]).map((alert) => alert.code);
}

async function clockStopOf(stop: Stop): Promise<ClockStopView | null> {
  const answer = await send(stop.app, marta.cookie, "GET", "/api/box/health");
  expect(answer.status).toBe(200);
  return (answer.json as unknown as BoxHealth).clockStop;
}

/** The newest `clock.behind_chain_restarted` incident's id. */
function newestRestartedIncident(): string {
  const [row] = venue.db.all<{ id: string }>(
    sql`select id from incidents where code = 'clock.behind_chain_restarted' order by rowid desc limit 1`,
  );
  return row!.id;
}

it("leaves payments running when a manager marks the restart's alert handled", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  expect(await alertCodes(stop)).toContain("clock.behind_chain");
  // Devices with no row of their own are still shown, with no label.
  expect((await clockStopOf(stop))?.proof.devices.map((device) => device.label)).toEqual([
    null,
    null,
  ]);

  const answer = await press(stop.app, marta.cookie, { recordId: stop.recordId });
  expect(answer.status).toBe(200);
  const box = venue.appAt(clockAt(stop.behind));
  expect((await cashSale(box)).status).toBe(200);

  const handled = await send(
    stop.app,
    marta.cookie,
    "POST",
    `/management-api/alerts/incidents/${newestRestartedIncident()}/handled`,
  );
  expect(handled.status).toBe(204);

  expect((await cashSale(box)).status).toBe(200);
  expect(await alertCodes(stop)).not.toContain("clock.behind_chain");
});

it("stops payments again, and says the clock stepped back, when the clock reads 30 minutes behind a sale made after the restart", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  expect((await press(stop.app, marta.cookie, { recordId: stop.recordId })).status).toBe(200);
  const sold = await cashSale(venue.appAt(clockAt(stop.behind)));
  expect(sold.status).toBe(200);
  expect((await clockStopOf(stop))?.offer).toBe("restarted");

  const back = stop.behind - 30 * MINUTE;
  stop.setClock(back);
  const refused = await cashSale(venue.appAt(clockAt(back)));

  expect(refused.status).toBe(409);
  expect(refused.json).toMatchObject({ code: "clock.behind_chain" });
  expect((await clockStopOf(stop))?.offer).toBe("stepped_back");
});

it("drops the till's clock notice once payments are restarted", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  expect(await noticeCodes(stop)).toContain("clock.behind_chain");

  expect((await press(stop.app, marta.cookie, { recordId: stop.recordId })).status).toBe(200);

  expect(await noticeCodes(stop)).not.toContain("clock.behind_chain");
});

it("shows no proof, then the two tills that proved the clock, then who restarted payments", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const record = latest();

  const none = await clockStopOf(stop);
  expect(none).toMatchObject({
    offer: "no_proof",
    recordId: stop.recordId,
    clockAt: new Date(stop.behind).toISOString(),
    lastRecordAt: record.at.toISOString(),
    gapMs: 10 * MINUTE,
    restart: null,
    proof: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
  });

  for (const cookie of [venue.cookie, venue.cookie2])
    expect((await equipmentRead(stop, cookie, stop.behind)).status).toBe(200);
  const offered = await clockStopOf(stop);
  expect(offered?.offer).toBe("offered");
  expect(offered?.restart).toBeNull();
  expect(
    offered?.proof.devices
      .map(({ id, label }) => ({ id, label }))
      .sort((a, b) => a.label!.localeCompare(b.label!)),
  ).toEqual([
    { id: venue.deviceId, label: "Barra" },
    { id: venue.device2Id, label: "Terraza" },
  ]);
  expect(offered?.proof.devices[0]).toMatchObject({ kind: "device" });

  expect((await press(stop.app, mario.cookie, { recordId: stop.recordId })).status).toBe(200);
  const restarted = await clockStopOf(stop);
  expect(restarted?.offer).toBe("restarted");
  expect(restarted?.restart).toEqual({
    personName: "Mario",
    restartedAt: new Date(stop.behind).toISOString(),
    clockAt: new Date(stop.behind).toISOString(),
  });
});

it("reads the clock stop on a full disk with a change waiting, and leaves the change waiting", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  for (const cookie of [venue.cookie, venue.cookie2])
    expect((await equipmentRead(stop, cookie, stop.behind)).status).toBe(200);
  venue.db.run(
    sql`insert into change_log (id, payload) values ('clock-stop-1', '{"resource":"zz","id":"1"}')`,
  );
  const waiting = () =>
    venue.db.all<{ id: string }>(sql`select id from change_log where id = 'clock-stop-1'`).length;
  try {
    const db = writeRefusingDb(venue.db);
    await expect(withTransaction(db, async () => {})).rejects.toMatchObject({
      code: "storage.disk_full",
    });

    const health = await stop.health(db);

    expect(health.clockStop).toMatchObject({ offer: "offered", recordId: stop.recordId });
    expect(health.clockStop?.proof.devices.map((device) => device.label).sort()).toEqual([
      "Barra",
      "Terraza",
    ]);
    expect(waiting()).toBe(1);
  } finally {
    venue.db.run(sql`delete from change_log where id = 'clock-stop-1'`);
  }
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
    restart: {
      personId: randomUUID(),
      restartedAt: "2026-10-22T09:00:00.000Z",
      clockAt: "2026-10-22T09:00:00.000Z",
    },
    offer: "restarted" as const,
    proof: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
  };
  const read = clockStopReader({
    backend: { clockStopState: async () => state },
    witnesses: () => [],
    clock: systemClock(),
  });

  expect((await read(venue.db))?.restart).toEqual({
    personName: null,
    restartedAt: "2026-10-22T09:00:00.000Z",
    clockAt: "2026-10-22T09:00:00.000Z",
  });
});
