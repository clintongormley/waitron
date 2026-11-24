import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { assignMenuToVenue, createMenu, createCategory, createProduct } from "@waitron/menu";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, startManagementSession, type BuiltInRoleKey } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { ClockServiceStatus } from "./box-host-client.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import { clockCorrection } from "./clock-correction.js";
import { createStaffApp } from "./cloud-remote.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";
import { requireManagementChangeFromOwnPage } from "./own-page.js";
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

async function seedPerson(role: BuiltInRoleKey, name: string): Promise<Manager> {
  return withTransaction(venue.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: name, pinHash: hashPin("1234"), role });
    const session = await startManagementSession(tx, { method: "password", personId: person!.id });
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
      const menu = await createMenu(tx, { name: "Menu" });
      const category = await createCategory(tx, { name: "Food" });
      const dish = await createProduct(tx, {
        categoryId: category.id,
        name: "Dish",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "general",
      });
      dishId = dish.id;
      await assignMenuToVenue(tx, menu.id);
      counter = await offerProducts(tx, { productIds: [dishId] });
    });
    marta = await seedPerson("manager", "Martha");
    mario = await seedPerson("admin", "Mario");
  },
});

function latest(): { id: string; at: Date } {
  const [row] = venue.db.all<{ id: string; at: string }>(sql`
    select id, fecha_hora_huso_gen_registro as at
    from verifactu_records
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
  const [any] = venue.db.all<{ n: number }>(sql`select count(*) as n from verifactu_records`);
  const at = any!.n === 0 ? Date.now() : latest().at.getTime() + 1000;
  const sale = await send(
    venue.appAt(clockAt(at)),
    venue.cookie,
    "POST",
    `/api/working-orders/${randomUUID()}/payments`,
    {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered: "10.00",
      dining: "eat_in",
      basket: {
        zoneId: counter.zoneId,
        lines: [{ menuItemId: counter.offerFor(dishId), quantity: "1" }],
      },
    },
  );
  if (sale.status !== 200) throw new Error(`sale answered ${sale.status}`);
}

const UNSYNCHRONISED: ClockServiceStatus = {
  available: true,
  service: "on",
  unit: "chrony.service",
  synchronised: false,
  lastSyncAt: null,
};

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
  /** The start's clock check handed to the routes, if any. */
  start: StartClockState | undefined;
  /** What the routes logged. */
  logs: { event: string; fields: Record<string, unknown> }[];
  setClock(ms: number): void;
  setSteady(ms: number): void;
  setFromBox(fromBox: boolean): void;
  /** The route's next read of the step counter is one behind, as if a step landed after it. */
  stepBehindOnce(): void;
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
    /** The start's clock check, handed to the correction and the routes. */
    start?: StartClockState;
    /** The routes judge the request's source themselves, behind the own-page check. */
    realSource?: boolean;
  } = {},
): Promise<Box> {
  const backend = options.backend ?? venue.backend;
  const startDep =
    options.start === undefined
      ? {}
      : { start: { state: options.start, heads: (tx: Transaction) => backend.recordHeads!(tx) } };
  await cashSale();
  const record = latest();
  const behind = record.at.getTime() - gapMs;
  let boxMs = behind;
  let steadyMs = 0;
  let fromBox = false;
  let lag = 0;
  const logs: Box["logs"] = [];
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
    ...startDep,
  });
  const stepsBehind = options.stepsBehind ?? 0;
  const app = new Hono();
  if (options.realSource === true)
    app.use(
      "*",
      requireManagementChangeFromOwnPage(
        async () => false,
        () => {},
      ),
    );
  mountBoxHealthApi(
    app,
    {
      db: venue.db,
      readHealth: () => Promise.reject(new Error("not read here")),
      freeSpace: () => Promise.reject(new Error("not freed here")),
      restart: () => {},
      clockSet: {
        backend,
        clock,
        steady: () => steadyMs,
        ...(options.realSource === true ? {} : { requestFromBox: () => fromBox }),
        devMode: false,
        ...startDep,
        ...(options.noCorrection === true
          ? {}
          : {
              correction: {
                inTurn: correction.inTurn,
                set: correction.set,
                steps: () => {
                  const steps = correction.steps() - stepsBehind - lag;
                  lag = 0;
                  return steps;
                },
              },
            }),
      },
    },
    (_level, event, fields) => void logs.push({ event, fields: { ...fields } }),
  );
  return {
    behind,
    recordId: record.id,
    witnesses,
    app,
    clock,
    host,
    correction,
    start: options.start,
    logs,
    setClock: (ms) => {
      boxMs = ms;
    },
    setSteady: (ms) => {
      steadyMs = ms;
    },
    setFromBox: (value) => {
      fromBox = value;
    },
    stepBehindOnce: () => {
      lag = 1;
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

function count(sqlText: ReturnType<typeof sql>): number {
  const [row] = venue.db.all<{ n: number }>(sqlText);
  return row!.n;
}

function written(box: Box) {
  return {
    rows: count(sql`select count(*) as n from verifactu_history where kind = 'clock.confirmed'`),
    corrected: count(sql`select count(*) as n from incidents where code = 'clock.corrected'`),
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
    sql`select person_id, json_extract(data, '$.source') as source,
      json_extract(data, '$.reason') as reason, json_extract(data, '$.stepMs') as step_ms,
      json_extract(data, '$.proof') as proof
      from verifactu_history where kind = 'clock.confirmed' and id = ${id}`,
  );
  return { ...row!, proof: JSON.parse(row!.proof) as Record<string, unknown> };
}

const refused = (reason: string) => ({ code: "clock.set_refused", params: { reason } });

/** Asserts a refusal: its answer, nothing written, nothing set, the start check unchanged. */
async function expectRefused(
  box: Box,
  sent: Promise<{ status: number; json: Record<string, unknown> }>,
  reason: string,
): Promise<void> {
  const before = { ...written(box), start: box.start?.status };
  const answer = await sent;
  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(refused(reason));
  expect({ ...written(box), start: box.start?.status }).toEqual(before);
}

/** A challenge, then "Confirm the time as shown". */
async function confirmAsShown(box: Box, cookie: string | undefined) {
  const asked = await ask(box, cookie);
  if (asked.status !== 200) return asked;
  return send(box.app, cookie ?? "", "POST", "/api/box/clock-confirm", {
    challengeId: asked.json.challengeId,
    asShown: true,
  });
}

const realHeads = () =>
  venue.db.withWriteLock(() => venue.backend.recordHeads!(venue.db as unknown as Transaction));

it("lets only an administrator with a management session set the clock", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const before = written(box);
  const body = { challengeId: randomUUID(), deviceAt: box.behind + 10 * MINUTE };

  const manager = await setWith(box, marta.cookie, body);
  expect(manager.status).toBe(403);
  expect(manager.json).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "system.box_admin" },
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

const STAFF = "https://staff.example.test";
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };

/**
 * A POST from the staff page to `app`, its socket on loopback, which the box takes for its own unless
 * the staff entrance marked the request remote.
 */
async function postFromStaffPage(app: Hono, path: string, cookie: string, body?: unknown) {
  const res = await app.request(
    `${STAFF}${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: STAFF },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    LOOPBACK,
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json: (parsed.error as Record<string, unknown>) ?? parsed };
}

it("sets the clock for an administrator through the staff entrance, even from loopback", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start, realSource: true });
  const staff = createStaffApp(box.app, async () => STAFF);
  const before = written(box);

  const asked = await postFromStaffPage(staff, "/api/box/clock-challenge", mario.cookie);
  expect(asked).toEqual({
    status: 200,
    json: { challengeId: expect.any(String), boxAt: expect.any(String) },
  });
  const target = boxTime(box) + 10 * MINUTE;
  const answer = await postFromStaffPage(staff, "/api/box/clock-set", mario.cookie, {
    challengeId: asked.json.challengeId,
    deviceAt: target,
  });

  expect(answer).toEqual({
    status: 200,
    json: {
      confirmationId: expect.any(String),
      stepMs: expect.any(Number),
      confirmedAt: expect.any(String),
    },
  });
  expect(box.host.sets).toEqual([
    { targetMs: target, requester: { source: "admin", person: mario.id } },
  ]);
  expect(written(box)).toEqual({
    rows: before.rows + 1,
    corrected: before.corrected + 1,
    hostSets: 1,
  });
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    person_id: mario.id,
  });
  expect(start.status).toBe("by_person");
});

it("confirms the time for an administrator through the staff entrance, even from loopback", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start, realSource: true });
  const staff = createStaffApp(box.app, async () => STAFF);
  const before = written(box);

  const asked = await postFromStaffPage(staff, "/api/box/clock-challenge", mario.cookie);
  expect(asked.status).toBe(200);
  const answer = await postFromStaffPage(staff, "/api/box/clock-confirm", mario.cookie, {
    challengeId: asked.json.challengeId,
    asShown: true,
  });

  expect(answer).toEqual({
    status: 200,
    json: {
      confirmationId: null,
      stepMs: 0,
      confirmedAt: new Date(boxTime(box)).toISOString(),
    },
  });
  expect(written(box)).toEqual(before);
  expect(box.host.statusAsks).toBe(0);
  expect(start.status).toBe("by_person");
});

it("refuses the same administrator's requests sent unmarked from loopback", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start, realSource: true });
  await expectRefused(
    box,
    postFromStaffPage(box.app, "/api/box/clock-challenge", mario.cookie),
    "same_machine",
  );
  await expectRefused(
    box,
    postFromStaffPage(box.app, "/api/box/clock-set", mario.cookie, {
      challengeId: randomUUID(),
      deviceAt: boxTime(box) + 10 * MINUTE,
    }),
    "same_machine",
  );
  await expectRefused(
    box,
    postFromStaffPage(box.app, "/api/box/clock-confirm", mario.cookie, {
      challengeId: randomUUID(),
      asShown: true,
    }),
    "same_machine",
  );
  expect(box.host.statusAsks).toBe(0);
  expect(start.status).toBe("waiting");
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

it("sets a waiting start's clock two days back from an administrator's device, confirming it by a person", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start });
  const before = boxTime(box);

  const answer = await useDevice(box, mario.cookie, -2 * DAY);

  expect(answer.status).toBe(200);
  expect(box.host.sets).toEqual([
    { targetMs: before - 2 * DAY, requester: { source: "admin", person: mario.id } },
  ]);
  const row = confirmationRow(answer.json.confirmationId as string);
  expect(row).toMatchObject({ source: "admin", person_id: mario.id, reason: "start" });
  expect(Math.abs(row.step_ms + 2 * DAY)).toBeLessThan(MINUTE);
  expect(start.status).toBe("by_person");
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

it("sets a clock that reads a date before 28-10-2024, as that stop", async () => {
  const box = await stoppedBox(10 * MINUTE);
  const trueTime = latest().at.getTime();
  box.setClock(Date.UTC(2020, 0, 1, 12));

  const answer = await useDevice(box, mario.cookie, trueTime - boxTime(box));

  expect(answer.status).toBe(200);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    reason: "unusable",
    proof: { devices: [] },
  });
  expect(boxTime(box)).toBe(trueTime);
});

it("sets a waiting start's clock that reads before 28-10-2024 at the start, confirming it by a person", async () => {
  const start = startClockState();
  const box = await stoppedBox(10 * MINUTE, { start });
  const trueTime = latest().at.getTime();
  box.setClock(Date.UTC(2020, 0, 1, 12));

  const answer = await useDevice(box, mario.cookie, trueTime - boxTime(box));

  expect(answer.status).toBe(200);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "admin",
    reason: "start",
  });
  expect(boxTime(box)).toBe(trueTime);
  expect(start.status).toBe("by_person");
});

it("confirms a waiting start as the box's date and time stand, setting nothing", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start });
  const before = written(box);

  const answer = await confirmAsShown(box, mario.cookie);

  expect(answer.status).toBe(200);
  expect(answer.json).toEqual({
    confirmationId: null,
    stepMs: 0,
    confirmedAt: new Date(boxTime(box)).toISOString(),
  });
  expect(written(box)).toEqual(before);
  expect(box.host.statusAsks).toBe(0);
  expect(start.status).toBe("by_person");
  const heads = await realHeads();
  expect(Object.keys(heads)).not.toHaveLength(0);
  expect(start.mark).toEqual(heads);
  expect(box.logs.filter((l) => l.event === "clock_start.confirmed")).toEqual([
    {
      event: "clock_start.confirmed",
      fields: {
        source: "admin",
        person: mario.id,
        boxAt: new Date(boxTime(box)).toISOString(),
        heads,
      },
    },
  ]);
});

it("confirms a waiting start as shown while the box's clock service does not answer", async () => {
  const start = startClockState();
  start.noteHost(false);
  const box = await stoppedBox(0, { start });
  box.host.status = { available: false, reason: "lost" };
  const before = written(box);

  const answer = await confirmAsShown(box, mario.cookie);

  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({ confirmationId: null, stepMs: 0 });
  expect(written(box)).toEqual(before);
  expect(start.status).toBe("by_person");
});

it("refuses a confirmation while the start does not wait, or with no start check", async () => {
  const confirmed = startClockState();
  confirmed.confirm("by_internet", {});
  for (const start of [confirmed, undefined]) {
    const box = await stoppedBox(0, start === undefined ? {} : { start });
    await expectRefused(box, confirmAsShown(box, mario.cookie), "not_stopped");
  }
});

it("refuses a confirmation while the clock reads a date before 28-10-2024", async () => {
  const box = await stoppedBox(0, { start: startClockState() });
  box.setClock(Date.UTC(2020, 0, 1, 12));
  await expectRefused(box, confirmAsShown(box, mario.cookie), "stopped");
});

it("refuses a confirmation when a step of the box's clock lands during it", async () => {
  const box = await stoppedBox(0, { start: startClockState() });
  const asked = await ask(box, mario.cookie);
  box.stepBehindOnce();
  await expectRefused(
    box,
    send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
      challengeId: asked.json.challengeId,
      asShown: true,
    }),
    "stale",
  );
});

it("refuses a confirmation when the box's clock moved between its challenge and its confirm", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start });
  const asked = await ask(box, mario.cookie);
  box.setClock(boxTime(box) + 2 * DAY);
  await expectRefused(
    box,
    send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
      challengeId: asked.json.challengeId,
      asShown: true,
    }),
    "stale",
  );
  expect(start.status).toBe("waiting");
});

it("confirms when the box's clock ran with its steady clock between challenge and confirm", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start });
  const asked = await ask(box, mario.cookie);
  box.setClock(boxTime(box) + 3_000);
  box.setSteady(3_000);
  const answer = await send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
    challengeId: asked.json.challengeId,
    asShown: true,
  });
  expect(answer.status).toBe(200);
  expect(start.status).toBe("by_person");
});

it.each([
  [1_000, 200, "by_person"],
  [1_001, 409, "waiting"],
] as const)(
  "after a step of %i ms between challenge and confirm, answers %i and the start is %s",
  async (stepMs, status, after) => {
    const start = startClockState();
    const box = await stoppedBox(0, { start });
    const asked = await ask(box, mario.cookie);
    box.setClock(boxTime(box) + stepMs);
    const answer = await send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
      challengeId: asked.json.challengeId,
      asShown: true,
    });
    expect(answer.status).toBe(status);
    if (status === 409) expect(answer.json).toEqual(refused("stale"));
    expect(start.status).toBe(after);
  },
);

it("refuses a confirmation on the box itself, and from anyone but an administrator", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { start });
  const body = { challengeId: randomUUID(), asShown: true };
  const answers = [];
  for (const cookie of ["", venue.cookie, marta.cookie])
    answers.push(await send(box.app, cookie, "POST", "/api/box/clock-confirm", body));
  box.setFromBox(true);
  answers.push(await send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", body));

  expect(answers.map((a) => [a.status, a.json.code])).toEqual([
    [401, "management_session.required"],
    [401, "management_session.required"],
    [403, "authorization.not_permitted"],
    [409, "clock.set_refused"],
  ]);
  expect(answers[3]!.json).toEqual(refused("same_machine"));
  expect(start.status).toBe("waiting");
});

it("refuses a confirmation body without asShown: true", async () => {
  const box = await stoppedBox(0, { start: startClockState() });
  for (const extra of [{}, { asShown: false }, { asShown: "yes" }, { deviceAt: boxTime(box) }]) {
    const answer = await send(box.app, mario.cookie, "POST", "/api/box/clock-confirm", {
      challengeId: randomUUID(),
      ...extra,
    });
    expect(answer.status).toBe(400);
    expect(answer.json).toEqual({
      code: "management.request_invalid",
      params: { field: "asShown" },
    });
  }
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
