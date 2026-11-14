import { ensureFixtureJobRole } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  assignCatalogueToVenue,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { devices, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { BootReading, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  createPinThrottle,
  deviceProfileAdmissionRoles,
  type PinThrottle,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { ClockServiceStatus } from "./box-host-client.js";
import { clockCorrection } from "./clock-correction.js";
import { clockStartUp, type ClockStartUp } from "./clock-start-up.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { mountTillApi } from "./till-api.js";
import { systemClock } from "./till-backend.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";
import "./errors.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 2001-06-01, a reading before 28-10-2024. */
const IN_2001 = Date.UTC(2001, 5, 1, 12);

let venue: BillVenue;
let counter: ZoneOffers;
let dishId = "";
let profileId = "";
/** Anna, the provisioned staff member, PIN 5555. */
let staffCookie = "";

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
    staffCookie = venue.cookie;
    const [till] = await db
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, venue.deviceId));
    profileId = till!.profileId;
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

const BOOT: BootReading = { ms: 7_200_000, id: "boot-till-check-test" };

interface FakeHost {
  status: ClockServiceStatus;
  /** How far each set lands from its target. */
  missByMs: number;
  sets: { targetMs: number; requester: Record<string, string | null> }[];
  statusAsks: number;
  /** Holds each status read, after the set has judged the stop, until it settles. */
  statusGate: Promise<void> | null;
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
  /** What the till API logged. */
  logs: { event: string; fields: Record<string, unknown> }[];
  setClock(ms: number): void;
  setSteady(ms: number): void;
  setFromBox(fromBox: boolean): void;
  /** The route's next read of the step counter answers one fewer, as if a set landed after it. */
  stepAfterReading(): void;
  /** Holds the correction's one-at-a-time turn until the answer's `release`. */
  holdTurn(): { release: () => Promise<void> };
  /** How many of the route's requests have asked for the turn, directly or through a set. */
  turnAsks(): number;
}

/** A new latest record, then a box whose clock reads `gapMs` behind it (or `at`), an empty witness
 * store, a correction over a fake host that moves the box's clock, an open start-up window, and
 * the till API over them. */
async function stoppedBox(
  gapMs: number,
  options: {
    at?: number;
    devMode?: boolean;
    backend?: FiscalBackend;
    /** The start's clock check, handed to the correction and the routes. */
    start?: StartClockState;
  } = {},
): Promise<Box> {
  const backend = options.backend ?? venue.backend;
  await cashSale();
  const record = latest();
  const behind = options.at ?? record.at.getTime() - gapMs;
  let boxMs = behind;
  let steadyMs = 0;
  let fromBox = false;
  let lag = 0;
  let turnAsks = 0;
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
    ...(options.start === undefined ? {} : { start: { state: options.start, heads: recordHeads } }),
  });
  const startUp = clockStartUp({ primaryAtStart: true });
  const logs: Box["logs"] = [];
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
      admission: testTradingAdmission(),
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
          inTurn: (fn) => {
            turnAsks += 1;
            return correction.inTurn(fn);
          },
          set: (input) => {
            turnAsks += 1;
            return correction.set(input);
          },
          steps: () => {
            const steps = correction.steps() - lag;
            lag = 0;
            return steps;
          },
        },
        startUp,
        steady: () => steadyMs,
        requestFromBox: () => fromBox,
        ...(options.start === undefined
          ? {}
          : { start: { state: options.start, heads: recordHeads } }),
      },
    },
    (_level, event, fields) => {
      logs.push({ event, fields: { ...fields } });
    },
  );
  return {
    behind,
    logs,
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
    stepAfterReading: () => {
      lag = 1;
    },
    turnAsks: () => turnAsks,
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

const recordHeads = (tx: Transaction) => venue.backend.recordHeads!(tx);

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
    .delete(deviceProfileAdmissionRoles)
    .where(eq(deviceProfileAdmissionRoles.deviceProfileId, profileId));
  try {
    return await fn();
  } finally {
    await venue.db
      .insert(deviceProfileAdmissionRoles)
      .values({ deviceProfileId: profileId, staffRoleId: await ensureFixtureJobRole(venue.db) });
  }
}

it("sets a clock that reads before 28-10-2024 from a staff member's till", async () => {
  const box = await stoppedBox(0, { at: IN_2001 });
  const answer = await check(box, staffCookie, Date.now() + DAY - IN_2001);
  expect(answer.status).toBe(200);
  expect(box.host.sets).toHaveLength(1);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "staff",
    reason: "unusable",
  });
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

it("refuses with no stop, and closes the start-up window", async () => {
  const box = await stoppedBox(-MINUTE);
  await expectRefused(box, ask(box, staffCookie), 409, setRefused("not_stopped"));
  expect(box.startUp.open()).toBe(false);
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

it("refuses an override that is not a person's id and a PIN", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(
    box,
    check(box, staffCookie, DAY, { override: { personId: "not-an-id", pin: "1234" } }),
    401,
    { code: "pin.invalid", params: {} },
  );
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

it("refuses an override that is not an object as the request's field", async () => {
  const box = await stoppedBox(DAY);
  await expectRefused(box, check(box, staffCookie, DAY, { override: "1234" }), 400, {
    code: "management.request_invalid",
    params: { field: "override" },
  });
});

/** A box whose latest record is a minute behind its clock, so no stop holds, with the start check
 * waiting and the start-up window already shut by a read that saw no stop. */
async function waitingBox() {
  const start = startClockState();
  const box = await stoppedBox(-MINUTE, { start });
  box.startUp.noStop();
  return { box, start };
}

it("serves a waiting box's challenge and keep with AEAT never asked", async () => {
  const { box, start } = await waitingBox();
  const answer = await check(box, staffCookie, 10 * MINUTE, { keep: true });
  expect(answer.status).toBe(200);
  expect(start.status).toBe("by_person");
});

it("refuses the challenge with the window shut once the start check is by the internet, the control", async () => {
  const { box, start } = await waitingBox();
  start.confirm("by_internet", {});
  await expectRefused(box, ask(box, staffCookie), 409, setRefused("not_stopped"));
});

it("offers a staff member the keep with the window shut, and keeps the box's time from a till 10 minutes off: no set, no row, one log line", async () => {
  const { box, start } = await waitingBox();
  const before = written(box);
  const boxAt = boxTime(box);
  const asked = await ask(box, staffCookie);
  expect(asked.status).toBe(200);
  expect(asked.json).toMatchObject({ keepOffered: true });
  const answer = await confirmWith(box, staffCookie, {
    challengeId: asked.json.challengeId,
    deviceAt: boxAt + 10 * MINUTE,
    keep: true,
  });
  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({ stepMs: 0 });
  expect(written(box)).toEqual(before);
  expect(box.host.statusAsks).toBe(0);
  expect(boxTime(box)).toBe(boxAt);
  expect(start.status).toBe("by_person");
  const heads = await venue.db.withWriteLock(() => recordHeads(venue.db as unknown as Transaction));
  expect(start.mark).toEqual(heads);
  const confirmed = box.logs.filter((line) => line.event === "clock_start.confirmed");
  expect(confirmed).toEqual([
    {
      event: "clock_start.confirmed",
      fields: {
        source: "staff",
        person: venue.operatorId,
        device: venue.deviceId,
        boxAt: new Date(boxAt).toISOString(),
        heads,
      },
    },
  ]);
});

it("sets the box from a till 2 days off while waiting, at reason start, then by a person", async () => {
  const { box, start } = await waitingBox();
  const before = written(box);
  const answer = await check(box, staffCookie, 2 * DAY);
  expect(answer.status).toBe(200);
  expect(box.host.sets).toHaveLength(1);
  expect(box.host.sets[0]!.requester).toEqual({
    source: "staff",
    person: venue.operatorId,
    device: venue.deviceId,
  });
  expect(written(box).rows).toBe(before.rows + 1);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "staff",
    person_id: venue.operatorId,
    reason: "start",
  });
  expect(start.status).toBe("by_person");
});

it("confirms a till within a minute while waiting with no set and no row", async () => {
  const { box, start } = await waitingBox();
  const before = written(box);
  const answer = await check(box, staffCookie, 20_000);
  expect(answer.status).toBe(200);
  expect(written(box)).toEqual(before);
  expect(box.host.statusAsks).toBe(0);
  expect(start.status).toBe("by_person");
  expect(box.logs.filter((line) => line.event === "clock_start.confirmed")).toHaveLength(1);
});

it("refuses a keep with no stop once the start check turned by the internet after the challenge, and shuts the window", async () => {
  const start = startClockState();
  const box = await stoppedBox(-MINUTE, { start });
  const asked = await ask(box, staffCookie);
  expect(asked.json).toMatchObject({ keepOffered: true });
  start.confirm("by_internet", {});
  await expectRefused(
    box,
    confirmWith(box, staffCookie, {
      challengeId: asked.json.challengeId,
      deviceAt: boxTime(box),
      keep: true,
    }),
    409,
    setRefused("not_stopped"),
  );
  expect(box.startUp.open()).toBe(false);
});

it("sets a waiting box whose clock reads before 28-10-2024 at reason start, and refuses its Yes", async () => {
  const start = startClockState();
  const box = await stoppedBox(0, { at: IN_2001, start });
  // A till that agrees with the box also reads before 28-10-2024.
  await expectRefused(box, check(box, staffCookie, 20_000), 409, setRefused("target_invalid"));
  expect(start.status).toBe("waiting");
  const answer = await check(box, staffCookie, Date.now() + DAY - IN_2001);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  expect(confirmationRow(answer.json.confirmationId as string)).toMatchObject({
    source: "staff",
    reason: "start",
  });
  expect(start.status).toBe("by_person");
});

it("keeps the box's time from a till whose own clock reads 1970", async () => {
  const { box, start } = await waitingBox();
  const asked = await ask(box, staffCookie);
  const answer = await confirmWith(box, staffCookie, {
    challengeId: asked.json.challengeId,
    deviceAt: 0,
    keep: true,
  });
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  expect(start.status).toBe("by_person");
  expect(box.host.sets).toHaveLength(0);
});

it("refuses a keep that is not true or false as the request's field", async () => {
  const { box, start } = await waitingBox();
  const asked = await ask(box, staffCookie);
  await expectRefused(
    box,
    confirmWith(box, staffCookie, {
      challengeId: asked.json.challengeId,
      deviceAt: boxTime(box),
      keep: "yes",
    }),
    400,
    { code: "management.request_invalid", params: { field: "keep" } },
  );
  expect(start.status).toBe("waiting");
});
