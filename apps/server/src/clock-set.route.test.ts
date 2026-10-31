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
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, persons, startManagementSession, type PersonRoleValue } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ClockServiceStatus } from "./box-host-client.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import { clockCorrection } from "./clock-correction.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let marta: Manager;
let mario: Manager;

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

// Every case reads the latest record's time and builds each clock from it, because each sale
// moves it for the cases after it.
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
    marta = await seedPerson("manager", "Marta");
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

const BOOT: BootReading = { ms: 7_200_000, id: "boot-set-test" };

interface FakeHost {
  status: ClockServiceStatus;
  /** How far each set lands from its target. */
  missByMs: number;
  sets: { targetMs: number; requester: Record<string, string | null> }[];
  statusAsks: number;
  /** While set, `clockStatus` waits for it. */
  statusGate: Promise<void> | null;
  /** While set, `setClock` waits for it before moving the clock. */
  setGate: Promise<void> | null;
}

interface Box {
  /** The box's reading, `gapMs` behind the latest record. */
  behind: number;
  recordId: string;
  witnesses: ClockWitnessStore;
  /** The challenge, confirmation and set routes, on the box's clock. */
  app: Hono;
  clock: TrustedClock;
  host: FakeHost;
  correction: ReturnType<typeof clockCorrection>;
  setClock(ms: number): void;
  setSteady(ms: number): void;
  setFromBox(fromBox: boolean): void;
}

/** A new latest record, then a box whose clock reads `gapMs` behind it, with an empty witness
 * store, a correction over a fake host that moves the box's clock, and the routes over both. */
async function stoppedBox(
  gapMs: number,
  options: {
    backend?: FiscalBackend;
    /** The route reads a step counter this far behind the correction's. */
    stepsBehind?: number;
    /** No correction is handed to the routes. */
    noCorrection?: boolean;
  } = {},
): Promise<Box> {
  const backend = options.backend ?? venue.backend;
  await cashSale();
  const record = latest();
  const behind = record.at.getTime() - gapMs;
  let boxMs = behind;
  let steadyMs = 0;
  let fromBox = false;
  const witnesses = createClockWitnessStore({ wall: () => boxMs, monotonic: () => steadyMs });
  const base = systemClock();
  const clock: TrustedClock = {
    ...base,
    now: () => ({ ...base.now(), instant: new Date(boxMs), offsetMinutes: 60 }),
  };
  const host: FakeHost = {
    status: UNSYNCHRONISED,
    missByMs: 0,
    sets: [],
    statusAsks: 0,
    statusGate: null,
    setGate: null,
  };
  const correction = clockCorrection({
    host: {
      clockStatus: async () => {
        host.statusAsks += 1;
        await host.statusGate;
        return host.status;
      },
      setClock: async (input) => {
        host.sets.push(input);
        await host.setGate;
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
  const stepsBehind = options.stepsBehind ?? 0;
  const app = new Hono();
  mountBoxHealthApi(
    app,
    {
      db: venue.db,
      readHealth: () => Promise.reject(new Error("not read here")),
      freeSpace: () => Promise.reject(new Error("not freed here")),
      venue: { locationId: venue.cfg.locationId, language: "en" },
      clockConfirm: {
        backend,
        witnesses: () => witnesses.witnesses(),
        clearWitnesses: () => witnesses.clear(),
        clock,
        nodeId: venue.cfg.nodeId,
        steady: () => steadyMs,
        readBoot: () => BOOT,
        requestFromBox: () => fromBox,
        devMode: false,
        ...(options.noCorrection === true
          ? {}
          : {
              correction: {
                inTurn: correction.inTurn,
                set: correction.set,
                steps: () => correction.steps() - stepsBehind,
              },
            }),
      },
    },
    () => {},
  );
  return {
    behind,
    recordId: record.id,
    witnesses,
    app,
    clock,
    host,
    correction,
    setClock: (ms) => {
      boxMs = ms;
    },
    setSteady: (ms) => {
      steadyMs = ms;
    },
    setFromBox: (value) => {
      fromBox = value;
    },
  };
}

/** The box's time on its clock. */
const boxTime = (box: Box) => box.clock.now().instant.getTime();

function ask(box: Box, cookie: string | undefined) {
  return send(box.app, cookie ?? "", "POST", "/api/box/clock-challenge");
}

function setWith(box: Box, cookie: string | undefined, body: unknown) {
  return send(box.app, cookie ?? "", "POST", "/api/box/clock-set", body);
}

/** A challenge, then "Use your device's time" from a device whose clock reads `offsetMs` from the
 * box's. */
async function useDevice(box: Box, cookie: string | undefined, offsetMs: number) {
  const asked = await ask(box, cookie);
  if (asked.status !== 200) return asked;
  return setWith(box, cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxTime(box) + offsetMs,
  });
}

/** A device at its own address whose clock read `offsetMs` from the box's. */
let deviceCount = 0;
function noteDevice(box: Box, offsetMs: number): void {
  box.witnesses.noteDevice(
    randomUUID(),
    `192.168.10.${30 + deviceCount++}`,
    boxTime(box) + offsetMs,
    {
      wallMs: boxTime(box),
      monoMs: 0,
    },
  );
}

/** AEAT's reading, taken during the stop, putting the true time `aheadMs` after the box's. */
function noteAuthority(box: Box, aheadMs: number): void {
  box.witnesses.noteAuthority({
    authorityMs: boxTime(box) - 30_000 + aheadMs,
    uncertaintyMs: 500,
    at: { wallMs: boxTime(box) - 30_000, monoMs: 0 },
  });
}

function count(sqlText: ReturnType<typeof sql>): number {
  const [row] = venue.db.all<{ n: number }>(sqlText);
  return row!.n;
}

function written(box: Box) {
  return {
    rows: count(sql`select count(*) as n from clock_confirmations`),
    corrected: count(sql`select count(*) as n from incidents where code = 'clock.corrected'`),
    hostSets: box.host.sets.length,
  };
}

function confirmationRow(id: string) {
  const [row] = venue.db.all<{
    source: string;
    person_id: string | null;
    reason: string;
    check_id: string | null;
    step_ms: number;
    proof: string;
  }>(
    sql`select source, person_id, reason, check_id, step_ms, proof from clock_confirmations where id = ${id}`,
  );
  return { ...row!, proof: JSON.parse(row!.proof) as Record<string, unknown> };
}

function correctedParams(confirmationId: string): Record<string, unknown> | undefined {
  return venue.db
    .all<{ params: string }>(sql`select params from incidents where code = 'clock.corrected'`)
    .map((row) => JSON.parse(row.params) as Record<string, unknown>)
    .find((params) => params.confirmationId === confirmationId);
}

async function stopNow(box: Box) {
  const reading = box.clock.now();
  return venue.db.withWriteLock(() =>
    venue.backend.clockStopState!(venue.db as unknown as Transaction, reading, []),
  );
}

const refused = (reason: string) => ({ code: "clock.set_refused", params: { reason } });

/** Asserts a refusal: its answer, nothing written, nothing set. */
async function expectRefused(
  box: Box,
  sent: Promise<{ status: number; json: Record<string, unknown> }>,
  reason: string,
): Promise<void> {
  const before = written(box);
  const answer = await sent;
  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(refused(reason));
  expect(written(box)).toEqual(before);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

it("lets only an administrator with a management session set the clock", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const before = written(box);
  const body = { challengeId: randomUUID(), deviceAt: box.behind + 10 * MINUTE };

  const manager = await setWith(box, marta.cookie, body);
  expect(manager.status).toBe(403);
  expect(manager.json).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "person.admin" },
  });
  for (const cookie of [undefined, venue.cookie]) {
    const sent = await setWith(box, cookie, body);
    expect(sent.status).toBe(401);
    expect(sent.json).toMatchObject({ code: "management_session.required" });
  }
  expect(written(box)).toEqual(before);
  expect(box.host.statusAsks).toBe(0);
});

it("refuses an administrator on the box itself, asking the host nothing", async () => {
  const box = await stoppedBox(10 * MINUTE);
  box.setFromBox(true);
  await expectRefused(
    box,
    setWith(box, mario.cookie, { challengeId: randomUUID(), deviceAt: box.behind + 10 * MINUTE }),
    "same_machine",
  );
  expect(box.host.statusAsks).toBe(0);
});

it("refuses a body that is not a challenge id and a whole number of milliseconds", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const answer = await setWith(box, mario.cookie, { challengeId: randomUUID(), deviceAt: 1.5 });
  expect(answer.status).toBe(400);
  expect(answer.json).toEqual({
    code: "management.request_invalid",
    params: { field: "deviceAt" },
  });
});

it("refuses a challenge answered late, and an unknown one", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const asked = await ask(box, mario.cookie);
  box.setSteady(6_000);
  for (const challengeId of [asked.json.challengeId, randomUUID()]) {
    const before = written(box);
    const answer = await setWith(box, mario.cookie, {
      challengeId,
      deviceAt: boxTime(box) + 10 * MINUTE,
    });
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({ code: "clock.check_expired", params: {} });
    expect(written(box)).toEqual(before);
  }
  expect(box.host.statusAsks).toBe(0);
});

it("refuses a set with no stop", async () => {
  const box = await stoppedBox(10 * MINUTE);
  box.setClock(latest().at.getTime());
  await expectRefused(box, useDevice(box, mario.cookie, DAY), "not_stopped");
});

it("refuses a set once AEAT has spoken during the stop", async () => {
  const box = await stoppedBox(10 * MINUTE);
  noteAuthority(box, 10 * MINUTE);
  await expectRefused(box, useDevice(box, mario.cookie, 10 * MINUTE), "witnessed");
});

it("sets the clock from the administrator's device when only two devices disagree with the box", async () => {
  const box = await stoppedBox(10 * MINUTE);
  noteDevice(box, 2 * HOUR);
  noteDevice(box, 2 * HOUR);

  const answer = await useDevice(box, mario.cookie, 10 * MINUTE);

  expect(answer.status).toBe(200);
  expect(box.host.sets).toEqual([
    { targetMs: box.behind + 10 * MINUTE, requester: { source: "admin", person: mario.id } },
  ]);
  // Only the administrator's device set the clock; the devices that disagreed did not.
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    person_id: mario.id,
    proof: { authority: null, devices: [], admin: { uncertaintyMs: 0 } },
  });
});

it("measures the device against the box's time at the middle of the challenge's round trip", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const asked = await ask(box, mario.cookie);
  box.setSteady(4_000);

  const answer = await setWith(box, mario.cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxTime(box) + 10 * MINUTE,
  });

  expect(answer.status).toBe(200);
  expect(box.host.sets.map((set) => set.targetMs)).toEqual([box.behind + 10 * MINUTE + 2_000]);
});

it("refuses a device within a minute of the box: confirm instead", async () => {
  const box = await stoppedBox(10 * MINUTE);
  await expectRefused(box, useDevice(box, mario.cookie, 30_000), "agrees");
});

it("refuses while the time service says the clock is synchronised", async () => {
  const box = await stoppedBox(10 * MINUTE);
  box.host.status = SYNCHRONISED;
  await expectRefused(box, useDevice(box, mario.cookie, 10 * MINUTE), "synchronised");
});

it("refuses when the box's host service does not answer", async () => {
  const box = await stoppedBox(10 * MINUTE);
  box.host.status = NO_HOST;
  await expectRefused(box, useDevice(box, mario.cookie, 10 * MINUTE), "host_unavailable");
});

it("says the host is synchronised or unavailable, never witnessed, when AEAT has also spoken", async () => {
  const synchronised = await stoppedBox(10 * MINUTE);
  noteAuthority(synchronised, 10 * MINUTE);
  synchronised.host.status = SYNCHRONISED;
  await expectRefused(
    synchronised,
    useDevice(synchronised, mario.cookie, 10 * MINUTE),
    "synchronised",
  );

  const noHost = await stoppedBox(10 * MINUTE);
  noteAuthority(noHost, 10 * MINUTE);
  noHost.host.status = NO_HOST;
  await expectRefused(noHost, useDevice(noHost, mario.cookie, 10 * MINUTE), "host_unavailable");
});

it("refuses a device's time measured before a step the box made", async () => {
  const box = await stoppedBox(10 * MINUTE, { stepsBehind: 1 });
  await expectRefused(box, useDevice(box, mario.cookie, 10 * MINUTE), "stale");
});

it("refuses a device's time that would set the clock before 28-10-2024", async () => {
  const box = await stoppedBox(10 * MINUTE);
  await expectRefused(
    box,
    useDevice(box, mario.cookie, Date.UTC(2001, 0, 1) - boxTime(box)),
    "target_invalid",
  );
});

it("refuses a set the clock watch cannot first record its readings for", async () => {
  const box = await stoppedBox(10 * MINUTE);
  box.correction.addAnchor({
    stepComing: () => Promise.reject(new Error("disk full")),
    reanchor: async () => {},
  });
  await expectRefused(box, useDevice(box, mario.cookie, 10 * MINUTE), "pending_disproofs");
});

it("answers a set the host left three seconds short as unverified, with no row", async () => {
  const box = await stoppedBox(10 * MINUTE);
  box.host.missByMs = -3_000;
  const before = written(box);

  const answer = await useDevice(box, mario.cookie, 10 * MINUTE);

  expect(answer.status).toBe(502);
  expect(answer.json).toEqual({ code: "clock.set_failed", params: { reason: "unverified" } });
  expect(written(box)).toEqual({
    rows: before.rows,
    corrected: before.corrected + 1,
    hostSets: 1,
  });
});

it("sets the clock a day on from an administrator's device, records who, and lifts the stop", async () => {
  const box = await stoppedBox(DAY);
  const before = written(box);
  expect(await stopNow(box)).toMatchObject({ proof: "none" });

  const answer = await useDevice(box, mario.cookie, DAY);

  expect(answer.status).toBe(200);
  expect(answer.json).toEqual({
    confirmationId: expect.any(String),
    stepMs: DAY,
    confirmedAt: new Date(box.behind + DAY).toISOString(),
  });
  const confirmationId = answer.json.confirmationId as string;
  expect(confirmationRow(confirmationId)).toMatchObject({
    source: "admin",
    person_id: mario.id,
    reason: "behind_chain",
    step_ms: DAY,
  });
  expect(correctedParams(confirmationId)).toMatchObject({
    source: "admin",
    person: "Mario",
    byAdmin: true,
    verified: true,
  });
  expect(written(box)).toEqual({
    rows: before.rows + 1,
    corrected: before.corrected + 1,
    hostSets: 1,
  });
  expect(box.witnesses.witnesses()).toEqual([]);
  const after = await stopNow(box);
  expect(after === null || after.proof === "confirmed").toBe(true);
});

it("sets a clock that reads a date before 28-10-2024, as that stop", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const trueTime = latest().at.getTime();
  // Kept from the stop before this one: not taken during it, and not what sets the clock.
  noteAuthority(box, 10 * MINUTE);
  box.setClock(Date.UTC(2020, 0, 1, 12));

  const answer = await useDevice(box, mario.cookie, trueTime - boxTime(box));

  expect(answer.status).toBe(200);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    reason: "unusable",
    check_id: null,
    proof: { authority: null, devices: [] },
  });
  expect(boxTime(box)).toBe(trueTime);
});

it("has no set route when the routes are handed no correction", async () => {
  const box = await stoppedBox(10 * MINUTE, { noCorrection: true });
  const answer = await setWith(box, mario.cookie, {
    challengeId: randomUUID(),
    deviceAt: box.behind,
  });
  expect(answer.status).toBe(404);
});

it("has no set route when the fiscal seat records no step", async () => {
  const backend = Object.create(venue.backend, {
    confirmClockStep: { value: undefined },
  }) as FiscalBackend;
  const box = await stoppedBox(10 * MINUTE, { backend });
  const answer = await setWith(box, mario.cookie, {
    challengeId: randomUUID(),
    deviceAt: box.behind,
  });
  expect(answer.status).toBe(404);
});

it("writes a confirmation started while a set holds the turn only after the set's row", async () => {
  const order: string[] = [];
  let stopAsked: () => void = () => {};
  const stopAskedOnce = new Promise<void>((resolve) => {
    stopAsked = resolve;
  });
  const backend = Object.create(venue.backend, {
    confirmClockStep: {
      value: (
        tx: Transaction,
        input: Parameters<NonNullable<FiscalBackend["confirmClockStep"]>>[1],
      ) => {
        order.push("step");
        return venue.backend.confirmClockStep!(tx, input);
      },
    },
    confirmClockStop: {
      value: (
        tx: Transaction,
        input: Parameters<NonNullable<FiscalBackend["confirmClockStop"]>>[1],
      ) => {
        order.push("stop");
        stopAsked();
        return venue.backend.confirmClockStop!(tx, input);
      },
    },
  }) as FiscalBackend;
  const box = await stoppedBox(10 * MINUTE, { backend });
  let release: () => void = () => {};
  box.host.setGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const forSet = await ask(box, mario.cookie);
  const forConfirm = await ask(box, mario.cookie);

  const set = setWith(box, mario.cookie, {
    challengeId: forSet.json.challengeId,
    deviceAt: boxTime(box) + 10 * MINUTE,
  });
  await vi.waitFor(() => expect(box.host.sets).toHaveLength(1));
  const confirmed = send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
    challengeId: forConfirm.json.challengeId,
    deviceAt: boxTime(box),
  });
  await Promise.race([stopAskedOnce, sleep(200)]);
  release();

  expect((await set).status).toBe(200);
  expect((await confirmed).json).toEqual({
    code: "clock.confirm_refused",
    params: { reason: "not_stopped" },
  });
  expect(order).toEqual(["step", "stop"]);
});

it("finishes a set held in the turn and a confirmation started meanwhile, on the real database", async () => {
  const box = await stoppedBox(10 * MINUTE);
  let release: () => void = () => {};
  box.host.statusGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const forSet = await ask(box, mario.cookie);
  const forConfirm = await ask(box, mario.cookie);

  const set = setWith(box, mario.cookie, {
    challengeId: forSet.json.challengeId,
    deviceAt: boxTime(box) + 10 * MINUTE,
  });
  await vi.waitFor(() => expect(box.host.statusAsks).toBe(1));
  const confirmed = send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
    challengeId: forConfirm.json.challengeId,
    deviceAt: boxTime(box),
  });
  await sleep(100);
  release();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("the set and the confirmation never finished")),
      5_000,
    );
  });
  const [setAnswer, confirmAnswer] = await Promise.race([Promise.all([set, confirmed]), deadline]);
  clearTimeout(timer);
  expect(setAnswer.status).toBe(200);
  expect(confirmAnswer.status).toBe(409);
});
