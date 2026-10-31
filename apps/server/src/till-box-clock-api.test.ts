import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { deviceProfiles, devices, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  createPinThrottle,
  deviceProfileAdmissionPersons,
  endSession,
  hashPin,
  loginWithPin,
  persons,
  type PersonRoleValue,
  type PinThrottle,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ClockServiceStatus } from "./box-host-client.js";
import { clockCorrection } from "./clock-correction.js";
import { clockStartUp, type ClockStartUp } from "./clock-start-up.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { mountTillApi } from "./till-api.js";
import { systemClock } from "./till-backend.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 2001-06-01, a reading before 28-10-2024. */
const IN_2001 = Date.UTC(2001, 5, 1, 12);

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let profileId = "";
/** Ana, the provisioned staff member, PIN 5555. */
let staffCookie = "";
/** Ana again, on the second till. */
let otherTillCookie = "";
/** Marta, a manager, PIN 1234. */
let managerId = "";
/** The provisioned administrator, PIN 1234, signed in on a till of their own. */
let adminTillCookie = "";
let adminTillId = "";
/** Ana on a till whose profile has no selling action. */
let clockOnlyCookie = "";
let clockOnlyTillId = "";

async function signIn(
  device: { deviceId: string; token: string },
  personId: string,
  pin: string,
): Promise<string> {
  const session = await withTransaction(venue.db, (tx) =>
    loginWithPin(tx, { deviceId: device.deviceId, personId, pin }),
  );
  return `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
}

async function seedPerson(role: PersonRoleValue, name: string): Promise<string> {
  const [person] = await venue.db
    .insert(persons)
    .values({ displayName: name, pinHash: hashPin("1234"), role })
    .returning({ id: persons.id });
  return person!.id;
}

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
    staffCookie = venue.cookie;
    otherTillCookie = venue.cookie2;
    const [till] = await db
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, venue.deviceId));
    profileId = till!.profileId;
    managerId = await seedPerson("manager", "Marta");
    const adminTill = await enrolDeviceForTest(db, venue.cfg, { name: "Caja admin", profileId });
    adminTillId = adminTill.deviceId;
    adminTillCookie = await signIn(adminTill, venue.adminId, "1234");
    const [clockOnly] = await db
      .insert(deviceProfiles)
      .values({ name: "Fichaje", formFactor: "till", capabilities: ["clock-in"] })
      .returning({ id: deviceProfiles.id });
    const clockOnlyTill = await enrolDeviceForTest(db, venue.cfg, {
      name: "Fichador",
      profileId: clockOnly!.id,
    });
    clockOnlyTillId = clockOnlyTill.deviceId;
    clockOnlyCookie = await signIn(clockOnlyTill, venue.operatorId, "5555");
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

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

/** A sale a second after the latest record, or at the system's time before the first. */
async function cashSale(): Promise<void> {
  const [any] = venue.db.all<{ n: number }>(sql`select count(*) as n from registros_facturacion`);
  const at = any!.n === 0 ? Date.now() : latest().at.getTime() + 1000;
  const sale = await send(venue.appAt(clockAt(at)), venue.cookie, "POST", "/api/sales", {
    workingOrderId: randomUUID(),
    zoneId: counter.zoneId,
    lines: [{ menuItemId: counter.offerFor(dishId), quantity: "1" }],
    tender: { method: "cash", amount: "10.00" },
  });
  if (sale.status !== 200) throw new Error(`sale answered ${sale.status}`);
}

const UNSYNCHRONISED: ClockServiceStatus = {
  available: true,
  service: "on",
  unit: "chrony.service",
  synchronised: false,
  lastSyncAt: null,
};
const SYNCHRONISED: ClockServiceStatus = { ...UNSYNCHRONISED, synchronised: true };
const NO_HOST: ClockServiceStatus = { available: false, reason: "missing", detail: "ENOENT" };

const BOOT: BootReading = { ms: 7_200_000, id: "boot-till-check-test" };

interface FakeHost {
  status: ClockServiceStatus;
  /** How far each set lands from its target. */
  missByMs: number;
  sets: { targetMs: number; requester: Record<string, string | null> }[];
  statusAsks: number;
}

interface Box {
  behind: number;
  witnesses: ClockWitnessStore;
  /** The till API, with the check's routes, on the box's clock. */
  app: Hono;
  clock: TrustedClock;
  host: FakeHost;
  startUp: ClockStartUp;
  failures: { slot: string; personId: string }[];
  setClock(ms: number): void;
  setSteady(ms: number): void;
  setFromBox(fromBox: boolean): void;
  setFilesRecords(files: boolean): void;
  /** The route's next read of the step counter answers one fewer, as if a set landed after it. */
  stepAfterReading(): void;
  /** Holds the correction's one-at-a-time turn until the answer's `release`. */
  holdTurn(): { release: () => Promise<void> };
}

/** A new latest record, then a box whose clock reads `gapMs` behind it (or `at`), an empty witness
 * store, a correction over a fake host that moves the box's clock, an open start-up window in
 * which AEAT did not answer, and the till API over them. */
async function stoppedBox(
  gapMs: number,
  options: {
    at?: number;
    devMode?: boolean;
    authority?: "not_asked" | "answered";
    backend?: FiscalBackend;
  } = {},
): Promise<Box> {
  const backend = options.backend ?? venue.backend;
  await cashSale();
  const record = latest();
  const behind = options.at ?? record.at.getTime() - gapMs;
  let boxMs = behind;
  let steadyMs = 0;
  let fromBox = false;
  let filesRecords = true;
  let lag = 0;
  const witnesses = createClockWitnessStore({ wall: () => boxMs, monotonic: () => steadyMs });
  const base = systemClock();
  const clock: TrustedClock = {
    ...base,
    now: () => ({ ...base.now(), instant: new Date(boxMs), offsetMinutes: 60 }),
  };
  const host: FakeHost = { status: UNSYNCHRONISED, missByMs: 0, sets: [], statusAsks: 0 };
  const correction = clockCorrection({
    host: {
      clockStatus: async () => {
        host.statusAsks += 1;
        return host.status;
      },
      setClock: async (input) => {
        host.sets.push(input);
        const beforeMs = boxMs;
        boxMs = input.targetMs + host.missByMs;
        return { available: true, beforeMs, afterMs: boxMs };
      },
    },
    backend,
    store: witnesses,
    clock,
    wall: () => boxMs,
    monotonic: () => steadyMs,
    boot: { readBoot: () => BOOT },
    read: (fn) => venue.db.withWriteLock(() => fn(venue.db as unknown as Transaction)),
    transaction: (fn) => withTransaction(venue.db, fn),
    nodeId: venue.cfg.nodeId,
    log: () => {},
  });
  const startUp = clockStartUp({ primaryAtStart: true });
  if (options.authority === "answered") startUp.authorityAsked(true);
  else if (options.authority !== "not_asked") startUp.authorityAsked(false);
  const failures: Box["failures"] = [];
  const throttle = createPinThrottle();
  const pinThrottle: PinThrottle = {
    check: (slot, personId) => throttle.check(slot, personId),
    wouldRefuse: (slot, personId) => throttle.wouldRefuse(slot, personId),
    recordFailure: (slot, personId) => {
      failures.push({ slot, personId });
      throttle.recordFailure(slot, personId);
    },
    clear: (slot, personId) => throttle.clear(slot, personId),
  };
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: venue.db,
      backend,
      clock,
      cfg: venue.cfg,
      secureCookies: false,
      venueLocale: "es-ES",
      pool: venue.pool,
      pinThrottle,
      devMode: options.devMode ?? false,
      boxClock: {
        correction: {
          inTurn: correction.inTurn,
          set: correction.set,
          steps: () => {
            const steps = correction.steps() - lag;
            lag = 0;
            return steps;
          },
        },
        startUp,
        witnesses: () => witnesses.witnesses(),
        clearWitnesses: () => witnesses.clear(),
        readBoot: () => BOOT,
        steady: () => steadyMs,
        requestFromBox: () => fromBox,
        filesRecords: () => filesRecords,
      },
    },
    () => {},
  );
  return {
    behind,
    witnesses,
    app,
    clock,
    host,
    startUp,
    failures,
    setClock: (ms) => {
      boxMs = ms;
    },
    setSteady: (ms) => {
      steadyMs = ms;
    },
    setFromBox: (value) => {
      fromBox = value;
    },
    setFilesRecords: (value) => {
      filesRecords = value;
    },
    stepAfterReading: () => {
      lag = 1;
    },
    holdTurn: () => {
      let open = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const held = correction.inTurn(() => gate);
      return {
        release: async () => {
          open();
          await held;
        },
      };
    },
  };
}

const boxTime = (box: Box) => box.clock.now().instant.getTime();

function ask(box: Box, cookie: string, body: unknown = {}) {
  return send(box.app, cookie, "POST", "/api/box-clock/challenge", body);
}

function confirmWith(box: Box, cookie: string, body: unknown) {
  return send(box.app, cookie, "POST", "/api/box-clock/confirm", body);
}

/** A challenge, then the till's own time, `offsetMs` from the box's. */
async function check(
  box: Box,
  cookie: string,
  offsetMs: number,
  extra: Record<string, unknown> = {},
  between?: () => void | Promise<void>,
) {
  const asked = await ask(box, cookie, extra);
  if (asked.status !== 200) return asked;
  await between?.();
  return confirmWith(box, cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxTime(box) + offsetMs,
    ...extra,
  });
}

/** AEAT's reading, taken during the stop, putting the true time `aheadMs` after the box's. */
function noteAuthority(box: Box, aheadMs: number): void {
  box.witnesses.noteAuthority({
    authorityMs: boxTime(box) - 30_000 + aheadMs,
    uncertaintyMs: 500,
    // Thirty seconds ago on both clocks, so the store keeps an agreeing reading as fresh.
    at: { wallMs: boxTime(box) - 30_000, monoMs: -30_000 },
  });
}

function count(sqlText: ReturnType<typeof sql>): number {
  const [row] = venue.db.all<{ n: number }>(sqlText);
  return row!.n;
}

function written(box: Box) {
  return {
    rows: count(sql`select count(*) as n from clock_confirmations`),
    incidents: count(sql`select count(*) as n from incidents`),
    hostSets: box.host.sets.length,
  };
}

function confirmationRow(id: string) {
  const [row] = venue.db.all<{
    source: string;
    person_id: string | null;
    reason: string;
    step_ms: number;
    proof: string;
  }>(
    sql`select source, person_id, reason, step_ms, proof from clock_confirmations where id = ${id}`,
  );
  return { ...row!, proof: JSON.parse(row!.proof) as Record<string, unknown> };
}

function incidentParams(code: string, confirmationId: string): Record<string, unknown> | undefined {
  return venue.db
    .all<{ params: string }>(sql`select params from incidents where code = ${code}`)
    .map((row) => JSON.parse(row.params) as Record<string, unknown>)
    .find((params) => params.confirmationId === confirmationId);
}

async function stopNow(box: Box) {
  const reading = box.clock.now();
  return venue.db.withWriteLock(() =>
    venue.backend.clockStopState!(venue.db as unknown as Transaction, reading, []),
  );
}

/** Asserts a refusal: its answer, and nothing written, set or recorded. */
async function expectRefused(
  box: Box,
  sent: Promise<{ status: number; json: Record<string, unknown> }>,
  status: number,
  json: Record<string, unknown>,
): Promise<void> {
  const before = written(box);
  const answer = await sent;
  expect(answer.status).toBe(status);
  expect(answer.json).toEqual(json);
  expect(written(box)).toEqual(before);
}

const setRefused = (reason: string) => ({ code: "clock.set_refused", params: { reason } });

async function withdrawAdmission<T>(fn: () => Promise<T>): Promise<T> {
  await venue.db
    .insert(deviceProfileAdmissionPersons)
    .values({ deviceProfileId: profileId, personId: venue.operatorId, admitted: false });
  try {
    return await fn();
  } finally {
    await venue.db
      .delete(deviceProfileAdmissionPersons)
      .where(eq(deviceProfileAdmissionPersons.personId, venue.operatorId));
  }
}

it("sets the box's clock from a staff member's till during start-up, the control", async () => {
  const box = await stoppedBox(DAY);
  const before = written(box);
  const answer = await check(box, staffCookie, DAY);
  expect(answer.status).toBe(200);
  expect(box.host.sets).toHaveLength(1);
  expect(box.host.sets[0]!.requester).toEqual({
    source: "staff",
    person: venue.operatorId,
    device: venue.deviceId,
  });
  expect(written(box)).toMatchObject({ rows: before.rows + 1, hostSets: 1 });
  const id = answer.json.confirmationId as string;
  const row = confirmationRow(id);
  expect(row).toMatchObject({ source: "staff", person_id: venue.operatorId });
  expect(row.proof.staff).toMatchObject({ deviceId: venue.deviceId });
  expect(row.proof).not.toHaveProperty("admin");
  expect(incidentParams("clock.corrected", id)).toMatchObject({
    source: "staff",
    byStaff: true,
    person: "Ana",
    device: "Barra",
  });
  const stop = await stopNow(box);
  expect(stop === null || stop.proof === "confirmed").toBe(true);
});

it("confirms the box's own time from a staff member's till that agrees", async () => {
  const box = await stoppedBox(DAY);
  const before = written(box);
  const answer = await check(box, staffCookie, 20_000);
  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({ stepMs: 0 });
  expect(box.host.statusAsks).toBe(0);
  expect(written(box).rows).toBe(before.rows + 1);
  const id = answer.json.confirmationId as string;
  expect(confirmationRow(id)).toMatchObject({ source: "staff", person_id: venue.operatorId });
  expect(incidentParams("clock.behind_chain_restarted", id)).toMatchObject({
    confirmedBy: "staff",
    byStaff: true,
    person: "Ana",
    device: "Barra",
  });
  expect(await stopNow(box)).toMatchObject({ proof: "confirmed" });
});

it("refuses an agreeing till whose comparison a set made void", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(
    box,
    check(box, staffCookie, 20_000, {}, () => box.stepAfterReading()),
    409,
    setRefused("stale"),
  );
});

it("sets a clock that reads before 28-10-2024 from a staff member's till", async () => {
  const box = await stoppedBox(0, { at: IN_2001, authority: "not_asked" });
  const answer = await check(box, staffCookie, Date.now() + DAY - IN_2001);
  expect(answer.status).toBe(200);
  expect(box.host.sets).toHaveLength(1);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "staff",
    reason: "unusable",
  });
});

it("refuses a staff member once start-up is over, and serves an administrator's PIN there", async () => {
  const box = await stoppedBox(DAY);
  box.startUp.noStop();
  await expectRefused(box, check(box, staffCookie, DAY), 409, setRefused("not_start_up"));
  expect(box.host.statusAsks).toBe(0);

  const override = { personId: venue.adminId, pin: "1234" };
  const answer = await check(box, staffCookie, DAY, { override });
  expect(answer.status).toBe(200);
  expect(box.host.sets).toHaveLength(1);
  expect(box.host.sets[0]!.requester).toEqual({
    source: "admin",
    person: venue.adminId,
    device: venue.deviceId,
  });
  const row = confirmationRow(answer.json.confirmationId as string);
  expect(row).toMatchObject({ source: "admin", person_id: venue.adminId });
  expect(row.proof).toHaveProperty("admin");
  expect(row.proof.device).toMatchObject({ deviceId: venue.deviceId });
});

it("confirms an agreeing time with an administrator's PIN once start-up is over", async () => {
  const box = await stoppedBox(DAY);
  box.startUp.noStop();
  const override = { personId: venue.adminId, pin: "1234" };
  const answer = await check(box, staffCookie, 20_000, { override });
  expect(answer.status).toBe(200);
  expect(box.host.statusAsks).toBe(0);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    person_id: venue.adminId,
  });
});

it("counts a wrong override PIN against the till and writes nothing", async () => {
  const box = await stoppedBox(DAY);
  box.startUp.noStop();
  for (const offsetMs of [DAY, 20_000]) {
    box.failures.length = 0;
    await expectRefused(
      box,
      check(box, staffCookie, offsetMs, { override: { personId: venue.adminId, pin: "9999" } }),
      401,
      { code: "pin.invalid", params: {} },
    );
    expect(box.failures).toEqual([{ slot: `override:${venue.deviceId}`, personId: venue.adminId }]);
  }
  expect(box.host.statusAsks).toBe(0);
});

it("refuses an override naming someone who is not an administrator", async () => {
  const box = await stoppedBox(DAY);
  box.startUp.noStop();
  for (const offsetMs of [DAY, 20_000])
    await expectRefused(
      box,
      check(box, staffCookie, offsetMs, { override: { personId: managerId, pin: "1234" } }),
      403,
      { code: "authorization.not_permitted", params: { permission: "person.admin" } },
    );
  expect(box.host.statusAsks).toBe(0);
});

it("serves an administrator signed in on a till once start-up is over", async () => {
  const box = await stoppedBox(DAY);
  box.startUp.noStop();
  const answer = await check(box, adminTillCookie, DAY);
  expect(answer.status).toBe(200);
  expect(box.host.sets[0]!.requester).toEqual({
    source: "admin",
    person: venue.adminId,
    device: adminTillId,
  });
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    person_id: venue.adminId,
  });
});

it("refuses a request from the box itself on both routes, outside development", async () => {
  const box = await stoppedBox(DAY);
  box.setFromBox(true);
  await expectRefused(box, ask(box, staffCookie), 409, setRefused("same_machine"));
  await expectRefused(
    box,
    confirmWith(box, staffCookie, { challengeId: randomUUID(), deviceAt: boxTime(box) + DAY }),
    409,
    setRefused("same_machine"),
  );
  expect(box.host.statusAsks).toBe(0);

  const dev = await stoppedBox(DAY, { devMode: true });
  dev.setFromBox(true);
  expect((await check(dev, staffCookie, DAY)).status).toBe(200);
});

it("refuses both routes without a session", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(box, ask(box, ""), 401, { code: "session.required", params: {} });
  await expectRefused(
    box,
    confirmWith(box, "", { challengeId: randomUUID(), deviceAt: boxTime(box) + DAY }),
    401,
    { code: "session.required", params: {} },
  );
});

it("refuses a staff member the till's profile no longer admits, on both routes", async () => {
  const box = await stoppedBox(DAY);
  const notAdmitted = { code: "device_profile.not_admitted", params: {} };
  await withdrawAdmission(async () => {
    await expectRefused(box, ask(box, staffCookie), 403, notAdmitted);
    await expectRefused(
      box,
      confirmWith(box, staffCookie, { challengeId: randomUUID(), deviceAt: boxTime(box) + DAY }),
      403,
      notAdmitted,
    );
  });
});

it("refuses a confirm when admission is withdrawn between the challenge and its transaction", async () => {
  const box = await stoppedBox(DAY);
  for (const offsetMs of [DAY, 20_000]) {
    const asked = await ask(box, staffCookie);
    expect(asked.status).toBe(200);
    await withdrawAdmission(() =>
      expectRefused(
        box,
        confirmWith(box, staffCookie, {
          challengeId: asked.json.challengeId,
          deviceAt: boxTime(box) + offsetMs,
        }),
        403,
        { code: "device_profile.not_admitted", params: {} },
      ),
    );
  }
  expect(box.host.sets).toHaveLength(0);
});

/** Sends the confirm while the turn is held, runs `meanwhile` once it waits there, then lets it in. */
async function confirmWhileHeld(
  box: Box,
  offsetMs: number,
  meanwhile: () => Promise<void>,
  cookie = staffCookie,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const asked = await ask(box, cookie);
  expect(asked.status).toBe(200);
  const turn = box.holdTurn();
  const sent = confirmWith(box, cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxTime(box) + offsetMs,
  });
  await sleep(200);
  await meanwhile();
  await turn.release();
  return sent;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

it("refuses a confirm whose admission is withdrawn while it waits for its turn", async () => {
  const box = await stoppedBox(DAY);
  const exception = eq(deviceProfileAdmissionPersons.personId, venue.operatorId);
  for (const offsetMs of [DAY, 20_000]) {
    const before = written(box);
    await venue.db
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profileId, personId: venue.operatorId, admitted: true });
    try {
      const answer = await confirmWhileHeld(box, offsetMs, async () => {
        await venue.db
          .update(deviceProfileAdmissionPersons)
          .set({ admitted: false })
          .where(exception);
      });
      expect(answer.status).toBe(403);
      expect(answer.json).toEqual({ code: "device_profile.not_admitted", params: {} });
    } finally {
      await venue.db.delete(deviceProfileAdmissionPersons).where(exception);
    }
    expect(written(box)).toEqual(before);
  }
});

it("refuses a staff member's confirm when start-up ends while it waits for its turn", async () => {
  for (const offsetMs of [DAY, 20_000]) {
    const box = await stoppedBox(DAY);
    const before = written(box);
    const answer = await confirmWhileHeld(box, offsetMs, async () => {
      box.startUp.noStop();
    });
    expect(answer.status).toBe(409);
    expect(answer.json).toEqual(setRefused("not_start_up"));
    expect(written(box)).toEqual(before);
    expect(box.host.statusAsks).toBe(0);
  }
});

it("refuses with no stop, and closes the start-up window", async () => {
  const box = await stoppedBox(-MINUTE);
  await expectRefused(box, ask(box, staffCookie), 409, setRefused("not_stopped"));
  expect(box.startUp.open()).toBe(false);
});

it("refuses the confirm with no stop, on both branches, and closes the window", async () => {
  for (const offsetMs of [DAY, 20_000]) {
    const box = await stoppedBox(DAY);
    const asked = await ask(box, staffCookie);
    expect(asked.status).toBe(200);
    box.setClock(latest().at.getTime() + MINUTE);
    await expectRefused(
      box,
      confirmWith(box, staffCookie, {
        challengeId: asked.json.challengeId,
        deviceAt: boxTime(box) + offsetMs,
      }),
      409,
      setRefused("not_stopped"),
    );
    expect(box.startUp.open()).toBe(false);
  }
});

it("refuses a staff member while AEAT has not been asked and the box can ask it", async () => {
  const box = await stoppedBox(DAY, { authority: "not_asked" });
  await expectRefused(box, ask(box, staffCookie), 409, setRefused("authority_pending"));
  box.setFilesRecords(false);
  expect((await check(box, staffCookie, DAY)).status).toBe(200);
});

it("refuses a staff member's set once AEAT has spoken during the stop, disagreeing", async () => {
  const box = await stoppedBox(DAY, { authority: "answered" });
  noteAuthority(box, DAY);
  await expectRefused(box, check(box, staffCookie, DAY), 409, setRefused("witnessed"));
  expect(box.host.sets).toHaveLength(0);
});

it("refuses a till's set once AEAT has spoken during the stop, agreeing with the box", async () => {
  const box = await stoppedBox(DAY, { authority: "answered" });
  noteAuthority(box, 0);
  await expectRefused(box, check(box, staffCookie, DAY), 409, setRefused("witnessed"));
  box.startUp.noStop();
  await expectRefused(
    box,
    check(box, staffCookie, DAY, { override: { personId: venue.adminId, pin: "1234" } }),
    409,
    setRefused("witnessed"),
  );
  expect(box.host.sets).toHaveLength(0);
});

it("refuses a till's time outside the years the box accepts", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(
    box,
    check(box, staffCookie, IN_2001 - boxTime(box)),
    409,
    setRefused("target_invalid"),
  );
  const old = await stoppedBox(0, { at: IN_2001 });
  await expectRefused(old, check(old, staffCookie, 30_000), 409, setRefused("target_invalid"));
  expect(old.host.statusAsks).toBe(0);
});

it("refuses a differing till when the box's time service is synchronised, or missing", async () => {
  const box = await stoppedBox(DAY);
  box.host.status = SYNCHRONISED;
  await expectRefused(box, check(box, staffCookie, DAY), 409, setRefused("synchronised"));
  box.host.status = NO_HOST;
  await expectRefused(box, check(box, staffCookie, DAY), 409, setRefused("host_unavailable"));
});

it("refuses an agreeing till while AEAT disagrees during the stop", async () => {
  const box = await stoppedBox(DAY, { authority: "answered" });
  noteAuthority(box, DAY);
  await expectRefused(box, check(box, staffCookie, 20_000), 409, {
    code: "clock.confirm_refused",
    params: { reason: "contrary_proof" },
  });
});

it("refuses an old challenge, and one issued to another till's session", async () => {
  const box = await stoppedBox(DAY);
  const asked = await ask(box, staffCookie);
  box.setSteady(6_000);
  const expired = { code: "clock.check_expired", params: {} };
  await expectRefused(
    box,
    confirmWith(box, staffCookie, {
      challengeId: asked.json.challengeId,
      deviceAt: boxTime(box) + DAY,
    }),
    400,
    expired,
  );
  const other = await ask(box, otherTillCookie);
  await expectRefused(
    box,
    confirmWith(box, staffCookie, {
      challengeId: other.json.challengeId,
      deviceAt: boxTime(box) + DAY,
    }),
    400,
    expired,
  );
});

it("refuses a differing till's set that a step since the reading made void", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(
    box,
    check(box, staffCookie, DAY, {}, () => box.stepAfterReading()),
    409,
    setRefused("stale"),
  );
});

it("answers a set the box could not verify as failed", async () => {
  const box = await stoppedBox(DAY);
  box.host.missByMs = -3_000;
  const answer = await check(box, staffCookie, DAY);
  expect(answer.status).toBe(502);
  expect(answer.json).toEqual({ code: "clock.set_failed", params: { reason: "unverified" } });
});

it("refuses a body without a challenge id or a whole number of milliseconds", async () => {
  const box = await stoppedBox(DAY);
  const answer = await confirmWith(box, staffCookie, { challengeId: randomUUID(), deviceAt: 1.5 });
  expect(answer.status).toBe(400);
  expect(answer.json).toEqual({
    code: "management.request_invalid",
    params: { field: "deviceAt" },
  });
});

it("serves a staff member whose till's profile has no selling action", async () => {
  const box = await stoppedBox(DAY);
  const answer = await check(box, clockOnlyCookie, DAY);
  expect(answer.status).toBe(200);
  expect(box.host.sets[0]!.requester).toEqual({
    source: "staff",
    person: venue.operatorId,
    device: clockOnlyTillId,
  });
});

it("refuses an override that is not a person's id and a PIN", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(
    box,
    check(box, staffCookie, DAY, { override: { personId: "not-an-id", pin: "1234" } }),
    401,
    { code: "pin.invalid", params: {} },
  );
});

it("refuses a till whose session ends while its set waits for the turn", async () => {
  const box = await stoppedBox(DAY);
  const till = await enrolDeviceForTest(venue.db, venue.cfg, { name: "Caja breve", profileId });
  const cookie = await signIn(till, venue.operatorId, "5555");
  const before = written(box);
  const answer = await confirmWhileHeld(
    box,
    DAY,
    async () => {
      const token = cookie.split("; ")[0]!.slice(`${SESSION_COOKIE}=`.length);
      await withTransaction(venue.db, (tx) => endSession(tx, token));
    },
    cookie,
  );
  expect(answer.status).toBe(401);
  expect(answer.json).toEqual({ code: "session.required", params: {} });
  expect(written(box)).toEqual(before);
});

it("has no check routes when the fiscal seat cannot confirm a stop", async () => {
  const backend = Object.create(venue.backend, {
    confirmClockStop: { value: undefined },
  }) as FiscalBackend;
  const box = await stoppedBox(DAY, { backend });
  expect((await ask(box, staffCookie)).status).toBe(404);
});

it("sees no stop behind the chain where the seat reads none", async () => {
  const backend = Object.create(venue.backend, {
    clockStopState: { value: undefined },
  }) as FiscalBackend;
  const box = await stoppedBox(DAY, { backend });
  await expectRefused(box, ask(box, staffCookie), 409, setRefused("not_stopped"));
});

it("answers a seat's own refusal of the box's reading as a failure, setting nothing", async () => {
  const backend = Object.create(venue.backend, {
    assertRecordableAt: {
      value: () => {
        throw new Error("the seat refuses every reading");
      },
    },
  }) as FiscalBackend;
  const box = await stoppedBox(DAY, { backend });
  const before = written(box);
  const answer = await ask(box, staffCookie);
  expect(answer.status).toBe(500);
  expect(written(box)).toEqual(before);
});
