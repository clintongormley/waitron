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
import { incidents as incidentRows, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, persons, startManagementSession, type PersonRoleValue } from "@waitron/identity";
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
  type ClockStopView,
} from "./box-health.js";
import { readOpenClockIncidents } from "./box-alert-email.js";
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
import type { Logger } from "./logger.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let marta: Manager;
let mario: Manager;
let berta: Manager;
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
    mario = await seedPerson("admin", "Mario");
    berta = await seedPerson("admin", "Berta");
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
  options: { backend?: FiscalBackend; devMode?: boolean; boot?: BootReading } = {},
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

/** A device at its own address whose clock read `offsetMs` from the box's, noted at the box's
 * reading. */
function noteDevice(stop: Stop, offsetMs: number): void {
  stop.witnesses.noteDevice(
    randomUUID(),
    `192.168.10.${30 + deviceCount++}`,
    stop.behind + offsetMs,
    {
      wallMs: stop.behind,
      monoMs: 0,
    },
  );
}
let deviceCount = 0;

/** Runs `checks` checks of a clock watch on the stop's clock and witnesses, with no jump, on the
 * real fiscal seat except for AEAT's time, which `readAuthorityTime` answers. The steady clock
 * moves a minute before each check, so each may ask AEAT. */
async function watchChecks(
  stop: Stop,
  checks: number,
  readAuthorityTime: FiscalBackend["readAuthorityTime"] = async () => null,
): Promise<void> {
  let fire = (): void => {};
  let armed = 0;
  let steadyMs = 0;
  const watch = startClockWatch({
    backend: Object.create(venue.backend, {
      readAuthorityTime: { value: readAuthorityTime },
    }) as FiscalBackend,
    store: stop.witnesses,
    clock: stop.clock,
    wall: () => 0,
    monotonic: () => steadyMs,
    boot: { readBoot: () => BOOT, elapsed: () => steadyMs },
    nodeId: venue.cfg.nodeId,
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
    steadyMs += MINUTE;
    fire();
    await vi.waitFor(() => expect(armed).toBe(check + 1));
  }
  await watch.stop();
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

function confirmationRow(id: string) {
  const [row] = venue.db.all<{
    source: string;
    person_id: string | null;
    registro_id: string | null;
    check_id: string | null;
    proof: string;
  }>(
    sql`select source, person_id, registro_id, check_id, proof from clock_confirmations where id = ${id}`,
  );
  return { ...row!, proof: JSON.parse(row!.proof) as Record<string, unknown> };
}

const refusal = (reason: string) => ({ code: "clock.confirm_refused", params: { reason } });
const CHECK_EXPIRED = { code: "clock.check_expired", params: {} };

it("lets only an administrator with a management session ask and confirm", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();
  const body = { challengeId: randomUUID(), deviceAt: stop.behind };

  for (const person of [marta, sergio]) {
    const asked = await ask(stop, person.cookie);
    expect(asked.status).toBe(403);
    expect(asked.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "person.admin" },
    });
    const answered = await answerChallenge(stop, person.cookie, body);
    expect(answered.status).toBe(403);
    expect(answered.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "person.admin" },
    });
  }

  for (const cookie of [undefined, venue.cookie]) {
    for (const sent of [await ask(stop, cookie), await answerChallenge(stop, cookie, body)]) {
      expect(sent.status).toBe(401);
      expect(sent.json).toMatchObject({ code: "management_session.required" });
    }
  }
  expect(written()).toEqual(before);

  const control = await confirm(stop, mario.cookie);
  expect(control.status).toBe(200);
  expect(written()).toEqual({
    confirmations: before.confirmations + 1,
    checks: before.checks + 1,
    alerts: before.alerts + 1,
  });
});

it("refuses an administrator on the box itself, and payments stay stopped", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();

  stop.setFromBox(true);
  const asked = await ask(stop, mario.cookie);
  expect(asked.status).toBe(409);
  expect(asked.json).toEqual(refusal("same_machine"));

  stop.setFromBox(false);
  const offBox = await ask(stop, mario.cookie);
  expect(offBox.status).toBe(200);
  stop.setFromBox(true);
  const answered = await answerChallenge(stop, mario.cookie, {
    challengeId: offBox.json.challengeId,
    deviceAt: boxTime(stop),
  });
  expect(answered.status).toBe(409);
  expect(answered.json).toEqual(refusal("same_machine"));
  // Refused before the session is read and before the body is.
  for (const sent of [
    await ask(stop, undefined),
    await answerChallenge(stop, undefined, {
      challengeId: offBox.json.challengeId,
      deviceAt: boxTime(stop),
    }),
    await answerChallenge(stop, mario.cookie, { challengeId: 7 }),
  ]) {
    expect(sent.status).toBe(409);
    expect(sent.json).toEqual(refusal("same_machine"));
  }

  expect(written()).toEqual(before);
  const sale = await cashSale(venue.appAt(clockAt(stop.behind)));
  expect(sale.status).toBe(409);
  expect(sale.json).toMatchObject({ code: "clock.behind_chain" });

  stop.setFromBox(false);
  const control = await confirm(stop, mario.cookie);
  expect(control.status).toBe(200);
  expect(written()).toMatchObject({ confirmations: before.confirmations + 1 });
});

it("lets an administrator confirm on the box itself in development", async () => {
  const stop = await stoppedBox(10 * MINUTE, { devMode: true });
  stop.setFromBox(true);
  const before = written();

  const confirmed = await confirm(stop, mario.cookie);

  expect(confirmed.status).toBe(200);
  expect(written()).toMatchObject({ confirmations: before.confirmations + 1 });
});

it("refuses a challenge answered late, answered twice, someone else's or unknown", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();

  const late = await ask(stop, mario.cookie);
  stop.setSteady(5_001);
  const lateAnswer = await answerChallenge(stop, mario.cookie, {
    challengeId: late.json.challengeId,
    deviceAt: boxTime(stop),
  });
  expect(lateAnswer.status).toBe(400);
  expect(lateAnswer.json).toEqual(CHECK_EXPIRED);

  const unknown = await answerChallenge(stop, mario.cookie, {
    challengeId: randomUUID(),
    deviceAt: boxTime(stop),
  });
  expect(unknown.status).toBe(400);
  expect(unknown.json).toEqual(CHECK_EXPIRED);

  const bertas = await ask(stop, berta.cookie);
  const notMine = await answerChallenge(stop, mario.cookie, {
    challengeId: bertas.json.challengeId,
    deviceAt: boxTime(stop),
  });
  expect(notMine.status).toBe(400);
  expect(notMine.json).toEqual(CHECK_EXPIRED);
  expect(written()).toEqual(before);

  // Control: answered at exactly 5 000 ms.
  const inTime = await ask(stop, mario.cookie);
  stop.setSteady(10_001);
  const confirmed = await answerChallenge(stop, mario.cookie, {
    challengeId: inTime.json.challengeId,
    deviceAt: boxTime(stop),
  });
  expect(confirmed.status).toBe(200);
  expect(written()).toMatchObject({ confirmations: before.confirmations + 1 });

  const twice = await answerChallenge(stop, mario.cookie, {
    challengeId: inTime.json.challengeId,
    deviceAt: boxTime(stop),
  });
  expect(twice.status).toBe(400);
  expect(twice.json).toEqual(CHECK_EXPIRED);
  expect(written()).toMatchObject({ confirmations: before.confirmations + 1 });
});

it("refuses a device more than a minute off the box, counting half the challenge's round trip", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();

  const off = await confirm(stop, mario.cookie, 61_000);
  expect(off.status).toBe(409);
  expect(off.json).toEqual(refusal("differs"));

  // Asked at 0 and answered at 2 000 on the steady clock, the box's clock advancing with it: the
  // box's time is taken at the midpoint, a second after the challenge, give or take a second.
  const roundTrip = async (offsetMs: number) => {
    stop.setSteady(0);
    stop.setClock(stop.behind);
    const asked = await ask(stop, mario.cookie);
    stop.setSteady(2_000);
    stop.setClock(stop.behind + 2_000);
    return answerChallenge(stop, mario.cookie, {
      challengeId: asked.json.challengeId,
      deviceAt: stop.behind + 1_000 + offsetMs,
    });
  };
  const outside = await roundTrip(59_001);
  expect(outside.status).toBe(409);
  expect(outside.json).toEqual(refusal("differs"));
  expect(written()).toEqual(before);

  const within = await roundTrip(59_000);
  expect(within.status).toBe(200);
  const row = confirmationRow(within.json.confirmationId as string);
  expect(row.proof.admin).toEqual({
    boxAt: new Date(stop.behind + 1_000).toISOString(),
    witnessAt: new Date(stop.behind + 60_000).toISOString(),
    uncertaintyMs: 1_000,
  });
});

it("compares the device with the box's clock as it reads now, not as it read at the challenge", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();
  const deviceAt = boxTime(stop);

  // The box's clock steps back ten minutes between the challenge and the answer.
  stop.setSteady(0);
  const asked = await ask(stop, mario.cookie);
  stop.setSteady(1_000);
  stop.setClock(stop.behind - 10 * MINUTE);
  const stepped = await answerChallenge(stop, mario.cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: deviceAt + 1_000,
  });
  expect(stepped.status).toBe(409);
  expect(stepped.json).toEqual(refusal("differs"));
  expect(written()).toEqual(before);
  const sale = await cashSale(venue.appAt(stop.clock));
  expect(sale.status).toBe(409);
  expect(sale.json).toMatchObject({ code: "clock.behind_chain" });

  // Control: a clock that advances with the steady clock through the round trip.
  stop.setClock(stop.behind);
  stop.setSteady(0);
  const again = await ask(stop, mario.cookie);
  stop.setSteady(2_000);
  stop.setClock(stop.behind + 2_000);
  const confirmed = await answerChallenge(stop, mario.cookie, {
    challengeId: again.json.challengeId,
    deviceAt: stop.behind + 1_000,
  });
  expect(confirmed.status).toBe(200);
  expect(written()).toMatchObject({ confirmations: before.confirmations + 1 });
  expect(confirmationRow(confirmed.json.confirmationId as string).proof.admin).toEqual({
    boxAt: new Date(stop.behind + 1_000).toISOString(),
    witnessAt: new Date(stop.behind + 1_000).toISOString(),
    uncertaintyMs: 1_000,
  });
});

it("refuses a device that matched the box's clock before the box's clock stepped forward", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();
  const deviceAt = boxTime(stop);

  // Three minutes forward during a one-second round trip leaves the clock behind the last record.
  stop.setSteady(0);
  const asked = await ask(stop, mario.cookie);
  stop.setSteady(1_000);
  stop.setClock(stop.behind + 3 * MINUTE);
  const stepped = await answerChallenge(stop, mario.cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: deviceAt + 1_000,
  });
  expect(stepped.status).toBe(409);
  expect(stepped.json).toEqual(refusal("differs"));
  expect(written()).toEqual(before);
  const sale = await cashSale(venue.appAt(stop.clock));
  expect(sale.status).toBe(409);
  expect(sale.json).toMatchObject({ code: "clock.behind_chain" });
});

it("refuses a confirmation AEAT contradicts during the stop", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  stop.witnesses.noteAuthority({
    authorityMs: stop.behind - 30_000 + 10 * MINUTE,
    uncertaintyMs: 500,
    at: { wallMs: stop.behind - 30_000, monoMs: 0 },
  });
  const before = written();

  const contradicted = await confirm(stop, mario.cookie);

  expect(contradicted.status).toBe(409);
  expect(contradicted.json).toEqual(refusal("contrary_proof"));
  expect(written()).toEqual(before);
});

it("refuses a confirmation two devices contradict, and writes nothing", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 2 * HOUR);
  noteDevice(stop, 2 * HOUR);
  const before = written();

  const contradicted = await confirm(stop, mario.cookie);

  expect(contradicted.status).toBe(409);
  expect(contradicted.json).toEqual(refusal("contrary_proof"));
  expect(written()).toEqual(before);
});

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

it("answers a confirmation with its id, its source and when it was confirmed", async () => {
  const stop = await stoppedBox(10 * MINUTE);

  const asked = await ask(stop, mario.cookie);
  expect(asked.status).toBe(200);
  expect(asked.json).toEqual({
    challengeId: expect.any(String),
    boxAt: new Date(stop.behind).toISOString(),
  });
  const confirmed = await answerChallenge(stop, mario.cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxTime(stop),
  });

  expect(confirmed.status).toBe(200);
  expect(confirmed.json).toEqual({
    confirmationId: expect.any(String),
    source: "admin",
    confirmedAt: new Date(stop.behind).toISOString(),
  });
  const row = confirmationRow(confirmed.json.confirmationId as string);
  expect(row).toMatchObject({ source: "admin", person_id: mario.id, registro_id: stop.recordId });
});

it("empties the witness store after a confirmation, and not after a refusal", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  expect(stop.witnesses.witnesses()).toHaveLength(1);

  const before = count("clock_confirmations");
  const refused = await confirm(stop, mario.cookie, 61_000);
  expect(refused.json).toEqual(refusal("differs"));
  expect(count("clock_confirmations")).toBe(before);
  expect(stop.witnesses.witnesses()).toHaveLength(1);

  const confirmed = await confirm(stop, mario.cookie);
  expect(confirmed.status).toBe(200);
  expect(count("clock_confirmations")).toBe(before + 1);
  expect(stop.witnesses.witnesses()).toEqual([]);
});

it("refuses a second administrator once the first has confirmed", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();

  const first = await confirm(stop, mario.cookie);
  const second = await confirm(stop, berta.cookie);

  expect(first.status).toBe(200);
  expect(second.status).toBe(409);
  expect(second.json).toEqual(refusal("not_stopped"));
  expect(written()).toMatchObject({
    confirmations: before.confirmations + 1,
    alerts: before.alerts + 1,
  });
});

it("answers two simultaneous confirmations with one row, the other not stopped", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const before = written();
  const asked = [await ask(stop, mario.cookie), await ask(stop, berta.cookie)];

  const answers = await Promise.all(
    [mario, berta].map((person, index) =>
      answerChallenge(stop, person.cookie, {
        challengeId: asked[index]!.json.challengeId,
        deviceAt: boxTime(stop),
      }),
    ),
  );

  expect(answers.map((sent) => sent.status).sort()).toEqual([200, 409]);
  expect(answers.find((sent) => sent.status === 409)?.json).toEqual(refusal("not_stopped"));
  expect(written()).toMatchObject({
    confirmations: before.confirmations + 1,
    alerts: before.alerts + 1,
  });
});

it("stores the box's boot reading in the administrator's confirmation", async () => {
  const boot = { ms: 98_765_432, id: "boot-of-the-confirmation" };
  const stop = await stoppedBox(10 * MINUTE, { boot });

  const confirmed = await confirm(stop, mario.cookie);

  expect(confirmed.status).toBe(200);
  expect(confirmationRow(confirmed.json.confirmationId as string).proof.closing).toMatchObject({
    bootMs: boot.ms,
    bootId: boot.id,
  });
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

/** Opens the stop's check at its reading, then lets the box's clock and its boot-time clock run
 * on until the stop ends by itself, so the check waits. */
async function waitingCheck(stop: Stop): Promise<string> {
  const opened = await withTransaction(venue.db, (tx) =>
    venue.backend.openClockCheck!(tx, {
      reading: { instant: new Date(stop.behind), offsetMinutes: 60 },
      boot: BOOT,
      nodeId: venue.cfg.nodeId,
    }),
  );
  const endedAt = latest().at.getTime();
  stop.setClock(endedAt);
  stop.setBoot({ ms: BOOT.ms + (endedAt - stop.behind), id: BOOT.id });
  return opened!.id;
}

function waiting(stop: Stop) {
  return withTransaction(venue.db, (tx) =>
    venue.backend.waitingClockCheck!(tx, {
      instant: stop.clock.now().instant,
      offsetMinutes: 60,
    }),
  );
}

it("closes a check that waits on an administrator's agreeing device, naming no record", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const checkId = await waitingCheck(stop);
  expect((await waiting(stop))?.checkId).toBe(checkId);
  // An earlier case's open alert naming the same first sale would stand for this one.
  venue.db.run(
    sql`update incidents set acknowledged_at = ${new Date(stop.behind).toISOString()}
        where code = 'clock.records_misdated' and acknowledged_at is null`,
  );
  const before = written();

  const confirmed = await confirm(stop, mario.cookie);

  expect(confirmed.status).toBe(200);
  expect(confirmed.json).toMatchObject({ source: "admin" });
  const id = confirmed.json.confirmationId as string;
  expect(confirmationRow(id)).toMatchObject({
    source: "admin",
    person_id: mario.id,
    registro_id: null,
    check_id: checkId,
  });
  expect(await waiting(stop)).toBeNull();
  expect(await withTransaction(venue.db, (tx) => venue.backend.misdatedRecords!(tx, id))).toEqual({
    known: true,
    records: expect.arrayContaining([expect.objectContaining({ recordId: stop.recordId })]),
  });
  const [misdated] = venue.db.all<{ confirmation: string }>(
    sql`select json_extract(params, '$.confirmationId') as confirmation from incidents
        where code = 'clock.records_misdated' and acknowledged_at is null`,
  );
  expect(misdated?.confirmation).toBe(id);
  expect(written()).toEqual({ ...before, confirmations: before.confirmations + 1 });
});

it("closes a check that waits even though AEAT disagreed during its stop", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  stop.witnesses.noteAuthority({
    authorityMs: stop.behind - 30_000 + 10 * MINUTE,
    uncertaintyMs: 500,
    at: { wallMs: stop.behind - 30_000, monoMs: 0 },
  });
  await waitingCheck(stop);
  expect(stop.witnesses.witnesses().some((witness) => witness.kind === "authority")).toBe(true);
  const before = written();

  const confirmed = await confirm(stop, mario.cookie);

  expect(confirmed.status).toBe(200);
  expect(written()).toMatchObject({ confirmations: before.confirmations + 1 });
  expect(await waiting(stop)).toBeNull();
});

it("still refuses a confirmation AEAT contradicted after the clock read a date before 28-10-2024 for one watch check", async () => {
  const stop = await stoppedBox(14.5 * HOUR);
  stop.witnesses.noteAuthority({
    authorityMs: stop.behind - 30_000 + 14.5 * HOUR,
    uncertaintyMs: 500,
    at: { wallMs: stop.behind - 30_000, monoMs: 0 },
  });
  const contradicted = await confirm(stop, mario.cookie);
  expect(contradicted.json).toEqual(refusal("contrary_proof"));

  stop.setClock(Date.parse("2001-01-01T12:00:00.000Z"));
  await watchChecks(stop, 1);

  stop.setClock(stop.behind);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  const pressed = written();
  const refusedAgain = await confirm(stop, mario.cookie);

  expect(refusedAgain.status).toBe(409);
  expect(refusedAgain.json).toEqual(refusal("contrary_proof"));
  expect(written()).toEqual(pressed);
});

it("asks AEAT's time at every watch check while a confirmation is in force, until the clock reads within a minute of the last sale", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  expect((await confirm(stop, mario.cookie)).status).toBe(200);
  const readAuthorityTime = vi.fn(async () => null);

  await watchChecks(stop, 2, readAuthorityTime);
  expect(readAuthorityTime).toHaveBeenCalledTimes(2);

  stop.setClock(latest().at.getTime() - MINUTE);
  await watchChecks(stop, 1, readAuthorityTime);
  expect(readAuthorityTime).toHaveBeenCalledTimes(2);
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

it("shows devices with no row of their own with no label", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  // Devices with no row of their own are still shown, with no label.
  expect((await clockStopOf(stop))?.agreeing.devices.map((device) => device.label)).toEqual([
    null,
    null,
  ]);
});

it("leaves payments running when a manager marks the confirmation's alert handled", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  expect(await alertCodes(stop)).toContain("clock.behind_chain");

  const answer = await confirm(stop, mario.cookie);
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

it("stops payments again under a stop with no proof and no confirmation when the clock reads 30 minutes behind a sale made after the restart", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  expect((await confirm(stop, mario.cookie)).status).toBe(200);
  const sold = await cashSale(venue.appAt(clockAt(stop.behind)));
  expect(sold.status).toBe(200);
  expect((await clockStopOf(stop))?.proof).toBe("confirmed");

  const back = stop.behind - 30 * MINUTE;
  stop.setClock(back);
  const refused = await cashSale(venue.appAt(clockAt(back)));

  expect(refused.status).toBe(409);
  expect(refused.json).toMatchObject({ code: "clock.behind_chain" });
  expect(await clockStopOf(stop)).toMatchObject({ proof: "none", confirmation: null });
});

it("drops the till's clock notice once payments are restarted", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  noteDevice(stop, 0);
  noteDevice(stop, 0);
  expect(await noticeCodes(stop)).toContain("clock.behind_chain");

  expect((await confirm(stop, mario.cookie)).status).toBe(200);

  expect(await noticeCodes(stop)).not.toContain("clock.behind_chain");
});

it("shows no proof, then the two tills that proved the clock, then who restarted payments", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const record = latest();

  const none = await clockStopOf(stop);
  expect(none).toMatchObject({
    proof: "none",
    recordId: stop.recordId,
    clockAt: new Date(stop.behind).toISOString(),
    lastRecordAt: record.at.toISOString(),
    gapMs: 10 * MINUTE,
    confirmation: null,
    agreeing: { authority: null, devices: [] },
    contrary: { authority: null, devices: [] },
  });

  for (const cookie of [venue.cookie, venue.cookie2])
    expect((await equipmentRead(stop, cookie, stop.behind)).status).toBe(200);
  const offered = await clockStopOf(stop);
  expect(offered?.proof).toBe("ready");
  expect(offered?.confirmation).toBeNull();
  expect(
    offered?.agreeing.devices
      .map(({ id, label }) => ({ id, label }))
      .sort((a, b) => a.label!.localeCompare(b.label!)),
  ).toEqual([
    { id: venue.deviceId, label: "Barra" },
    { id: venue.device2Id, label: "Terraza" },
  ]);
  expect(offered?.agreeing.devices[0]).toMatchObject({ kind: "device" });

  const confirmed = await confirm(stop, mario.cookie);
  expect(confirmed.status).toBe(200);
  const restarted = await clockStopOf(stop);
  expect(restarted?.proof).toBe("confirmed");
  expect(restarted?.confirmation).toEqual({
    id: confirmed.json.confirmationId,
    source: "admin",
    personName: "Mario",
    confirmedAt: new Date(stop.behind).toISOString(),
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

    expect(health.clockStop).toMatchObject({ proof: "ready", recordId: stop.recordId });
    expect(health.clockStop?.agreeing.devices.map((device) => device.label).sort()).toEqual([
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

/** The record's invoice series code and number, read from its sale rather than its number. */
function invoiceOf(recordId: string): {
  series: string;
  number: number;
  at: string;
  offset: number;
} {
  const [row] = venue.db.all<{ series: string; number: number; at: string; offset: number }>(sql`
    select s.code as series, sa.invoice_number as number,
      r.fecha_hora_huso_gen_registro as at, r.offset_minutos as offset
    from registros_facturacion r
    join sales sa on sa.id = r.sale_id
    join invoice_series s on s.id = sa.series_id
    where r.id = ${recordId}
  `);
  return row!;
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

it("says a check waits from its opening reading once its stop ends by itself, until an administrator closes it", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  handOpenMisdated(stop.behind);
  const before = await healthOf(stop);
  expect(before.clockStop).toMatchObject({ proof: "none", recordId: stop.recordId });
  expect(before.clockCheckWaiting).toBeNull();

  await waitingCheck(stop);
  const waitingNow = await healthOf(stop);
  expect(waitingNow.clockStop).toBeNull();
  expect(waitingNow.clockCheckWaiting).toEqual({ since: new Date(stop.behind).toISOString() });

  expect((await confirm(stop, mario.cookie)).status).toBe(200);
  expect((await healthOf(stop)).clockCheckWaiting).toBeNull();
});

it("lists the sales a closing found dated wrongly, by series, number and time, on the stored values alone, until its alert is handled, and keeps it, marked handled, on the handled route after its alert is handled", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  handOpenMisdated(stop.behind);
  await waitingCheck(stop);
  const confirmed = await confirm(stop, mario.cookie);
  expect(confirmed.status).toBe(200);
  const confirmationId = confirmed.json.confirmationId as string;
  const record = invoiceOf(stop.recordId);

  const listed = (await misdatedOf(stop.app)).lists.find(
    (list) => list.confirmationId === confirmationId,
  );
  // Earlier records stamped after the stop's start are listed too; this stop's sale is the latest.
  expect(listed?.records.at(-1)).toEqual({
    recordId: stop.recordId,
    series: record.series,
    number: record.number,
    at: new Date(record.at).toISOString(),
    offsetMinutes: record.offset,
  });
  expect(
    (await misdatedOf(stop.app)).lists.filter((list) => list.confirmationId === confirmationId),
  ).toHaveLength(1);

  const open = (await healthOf(stop)).misdatedOpen.find(
    (entry) => entry.confirmationId === confirmationId,
  );
  expect(open).toMatchObject({
    confirmationId,
    count: listed!.records.length,
    from: listed!.records[0]!.at,
    to: new Date(record.at).toISOString(),
    partial: false,
    unconfirmed: false,
  });

  const refused = await send(stop.app, sergio.cookie, "GET", "/api/box/clock-misdated");
  expect(refused.status).toBe(403);
  expect(refused.json).toMatchObject({
    code: "authorization.not_permitted",
    params: { permission: "system.manage" },
  });

  // The boot-time clock an hour on and two sales since: the list is what the closing stored.
  stop.setBoot({ ms: BOOT.ms + 2 * HOUR, id: BOOT.id });
  for (let sale = 0; sale < 2; sale += 1)
    expect((await cashSale(venue.appAt(clockAt(nowMs() + 1000)))).status).toBe(200);
  expect(
    (await misdatedOf(stop.app)).lists.find((list) => list.confirmationId === confirmationId),
  ).toEqual(listed);

  const handledBefore = (await healthOf(stop)).misdatedHandledCount;
  const handledAt = new Date(boxTime(stop)).toISOString();
  const handled = await send(
    stop.app,
    marta.cookie,
    "POST",
    `/management-api/alerts/incidents/${misdatedIncident(confirmationId)}/handled`,
  );
  expect(handled.status).toBe(204);
  expect(
    (await misdatedOf(stop.app)).lists.some((list) => list.confirmationId === confirmationId),
  ).toBe(false);
  expect(
    (await healthOf(stop)).misdatedOpen.some((entry) => entry.confirmationId === confirmationId),
  ).toBe(false);

  const episode = (await misdatedHandledOf(stop.app)).episodes.find(
    (entry) => entry.confirmationId === confirmationId,
  );
  const { records, ...summary } = episode!;
  expect(records).toEqual(listed!.records);
  expect(summary).toEqual({
    ...open!,
    incidentId: misdatedIncident(confirmationId),
    handledAt,
    handledBy: { kind: "person", name: "Marta" },
  });
  expect((await healthOf(stop)).misdatedHandledCount).toBe(handledBefore + 1);
});

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

it("reads a waiting check and the wrongly dated sales on a full disk with a change waiting, and leaves the change waiting", async () => {
  const closedFirst = await stoppedBox(10 * MINUTE);
  handOpenMisdated(closedFirst.behind);
  await waitingCheck(closedFirst);
  const confirmed = await confirm(closedFirst, mario.cookie);
  expect(confirmed.status).toBe(200);
  const confirmationId = confirmed.json.confirmationId as string;
  // A second stop's check, left waiting while the first's alert stays open.
  const waitingStop = await stoppedBox(10 * MINUTE);
  await waitingCheck(waitingStop);
  const handledAt = new Date(waitingStop.behind).toISOString();
  const [ownHandled] = await venue.db
    .insert(incidentRows)
    .values({
      source: jobOrigin("dashboard").source,
      code: "clock.records_misdated",
      params: {
        confirmationId: randomUUID(),
        count: 0,
        from: handledAt,
        fromOffsetMinutes: 60,
        partial: false,
        unconfirmed: true,
      },
      severity: "error",
      detectedAt: handledAt,
      acknowledgedAt: handledAt,
    })
    .returning({ id: incidentRows.id });

  venue.db.run(
    sql`insert into change_log (id, payload) values ('clock-check-1', '{"resource":"zz","id":"1"}')`,
  );
  const changeWaits = () =>
    venue.db.all<{ id: string }>(sql`select id from change_log where id = 'clock-check-1'`).length;
  try {
    const db = writeRefusingDb(venue.db);
    await expect(withTransaction(db, async () => {})).rejects.toMatchObject({
      code: "storage.disk_full",
    });

    const health = await waitingStop.health(db);
    expect(health.clockCheckWaiting).toEqual({ since: new Date(waitingStop.behind).toISOString() });
    expect(health.misdatedOpen.map((entry) => entry.confirmationId)).toContain(confirmationId);
    const lists = await misdatedOf(boxApp(waitingStop, db));
    expect(lists.lists.map((list) => list.confirmationId)).toContain(confirmationId);
    const handled = await misdatedHandledOf(boxApp(waitingStop, db));
    const handledIds = venue.db
      .all<{ id: string }>(
        sql`select id from incidents where code = 'clock.records_misdated'
            and acknowledged_at is not null order by detected_at desc, id desc`,
      )
      .map((row) => row.id);
    expect(handledIds).toContain(ownHandled!.id);
    expect(handled.episodes.map((episode) => episode["incidentId"])).toEqual(handledIds);
    expect(changeWaits()).toBe(1);
  } finally {
    venue.db.run(sql`delete from change_log where id = 'clock-check-1'`);
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

it("lists a later closing's wrongly dated sales beside an open alert that cannot tell, whatever sale each names", async () => {
  // Just over a minute behind, so the stop's own sale is the only one its list can name.
  const stop = await stoppedBox(MINUTE + 1);
  // A check opens on this stop, whose latest record is the stop's own sale, and closes by itself
  // with AEAT disagreeing, so the box cannot tell.
  await withTransaction(venue.db, (tx) =>
    venue.backend.openClockCheck!(tx, {
      reading: stop.clock.now(),
      boot: BOOT,
      nodeId: venue.cfg.nodeId,
    }),
  );
  // After the opening, which may close an earlier case's check that cannot tell.
  handOpenMisdated(stop.behind);
  const endedAt = nowMs() + MINUTE;
  const cannotTell = await withTransaction(venue.db, (tx) =>
    venue.backend.closeClockCheckByItself!(tx, {
      reading: { instant: new Date(endedAt), offsetMinutes: 60 },
      boot: BOOT,
      nodeId: venue.cfg.nodeId,
      witnesses: [
        {
          kind: "authority",
          id: "authority",
          boxAt: new Date(endedAt).toISOString(),
          witnessAt: new Date(endedAt + 20 * MINUTE).toISOString(),
          uncertaintyMs: 0,
        },
      ],
    }),
  );
  expect(cannotTell.confirmation?.source).toBe("elapsed");

  // An administrator then confirms the stop, whose list's first sale is that same latest record.
  const confirmed = await confirm(stop, mario.cookie);
  expect(confirmed.status).toBe(200);
  const confirmationId = confirmed.json.confirmationId as string;
  const answer = await withTransaction(venue.db, (tx) =>
    venue.backend.misdatedRecords!(tx, confirmationId),
  );
  expect(answer).toEqual({
    known: true,
    records: [expect.objectContaining({ recordId: stop.recordId })],
  });

  const open = (await healthOf(stop)).misdatedOpen.map((entry) => [
    entry.confirmationId,
    entry.unconfirmed,
  ]);
  // Dated by the readings that wrote them, which here run backwards.
  expect(open).toEqual([
    [confirmationId, false],
    [cannotTell.confirmation!.id, true],
  ]);
  expect((await misdatedOf(stop.app)).lists).toEqual([
    { confirmationId, records: [expect.objectContaining({ recordId: stop.recordId })] },
  ]);
  // The managers' email duty reads the same open alerts.
  expect(
    (await readOpenClockIncidents(venue.db))
      .filter((incident) => incident.code === "clock.records_misdated")
      .map((incident) => incident.params["confirmationId"]),
  ).toEqual([confirmationId, cannotTell.confirmation!.id]);
});

it("keeps an alert that cannot tell, handled by the box when an earlier start replaces it, on the handled route with no list", async () => {
  const stop = await stoppedBox(10 * MINUTE);
  const closeByItself = (atMs: number) =>
    withTransaction(venue.db, (tx) =>
      venue.backend.closeClockCheckByItself!(tx, {
        reading: { instant: new Date(atMs), offsetMinutes: 60 },
        boot: BOOT,
        nodeId: venue.cfg.nodeId,
        witnesses: [
          {
            kind: "authority",
            id: "authority",
            boxAt: new Date(atMs).toISOString(),
            witnessAt: new Date(atMs + 20 * MINUTE).toISOString(),
            uncertaintyMs: 0,
          },
        ],
      }),
    );
  const openAt = (ms: number) =>
    withTransaction(venue.db, (tx) =>
      venue.backend.openClockCheck!(tx, {
        reading: { instant: new Date(ms), offsetMinutes: 60 },
        boot: BOOT,
        nodeId: venue.cfg.nodeId,
      }),
    );
  await openAt(stop.behind);
  // After the opening, which may close an earlier case's check that cannot tell.
  handOpenMisdated(stop.behind);
  const endedAt = nowMs() + MINUTE;
  const first = await closeByItself(endedAt);
  expect(first.confirmation?.source).toBe("elapsed");
  const replacedId = first.confirmation!.id;
  // The clock steps back further than the first stop's start, and that stop ends the same way.
  await openAt(stop.behind - HOUR);
  const replacedAt = endedAt + 2 * MINUTE;
  const second = await closeByItself(replacedAt);
  expect(second.confirmation?.source).toBe("elapsed");
  try {
    const episode = (await misdatedHandledOf(stop.app)).episodes.find(
      (entry) => entry.confirmationId === replacedId,
    );
    expect(episode).toEqual({
      incidentId: misdatedIncident(replacedId),
      confirmationId: replacedId,
      count: 0,
      from: new Date(stop.behind).toISOString(),
      fromOffsetMinutes: 60,
      partial: false,
      unconfirmed: true,
      handledAt: new Date(replacedAt).toISOString(),
      handledBy: { kind: "box" },
      records: null,
    });

    const refused = await send(stop.app, sergio.cookie, "GET", "/api/box/clock-misdated/handled");
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "system.manage" },
    });
  } finally {
    handOpenMisdated(replacedAt);
  }
});
