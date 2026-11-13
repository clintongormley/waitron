import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPin, startManagementSession, type PersonRoleValue } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountBoxHealthApi } from "./box-health-api.js";
import { clockCorrection } from "./clock-correction.js";
import { createClockWitnessStore } from "./clock-witnesses.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";
import { provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

const DAY = 24 * 60 * 60_000;

let venue: BillVenue;
let marta: { cookie: string };
let mario: { id: string; cookie: string };

async function seedPerson(role: PersonRoleValue, name: string) {
  return withTransaction(venue.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: name, pinHash: hashPin("1234"), role });
    const session = await startManagementSession(tx, { personId: person!.id });
    return { id: person!.id, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    marta = await seedPerson("manager", "Martha");
    mario = await seedPerson("admin", "Mario");
  },
});

const recordHeads = (tx: Transaction) => venue.backend.recordHeads!(tx);

/** The box-health routes over a box whose clock reads `boxMs` (or now), a fake host that counts
 * what it is asked, and the start check `start` (none when null). */
function box(options: { start?: StartClockState | null; boxMs?: number } = {}) {
  const start = options.start === undefined ? startClockState() : options.start;
  const boxMs = options.boxMs ?? Date.now();
  let fromBox = false;
  let lag = 0;
  const hostAsks = { status: 0, sets: 0 };
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const base = systemClock();
  const clock: TrustedClock = {
    ...base,
    now: () => ({ ...base.now(), instant: new Date(boxMs), offsetMinutes: 60 }),
  };
  const startDep = start === null ? {} : { start: { state: start, heads: recordHeads } };
  const correction = clockCorrection({
    host: {
      clockStatus: async () => {
        hostAsks.status += 1;
        return { available: false, reason: "missing", detail: "ENOENT" };
      },
      setClock: async () => {
        hostAsks.sets += 1;
        return { available: false, reason: "missing" };
      },
    },
    backend: venue.backend,
    store: createClockWitnessStore({ wall: () => boxMs, monotonic: () => 0 }),
    clock,
    wall: () => boxMs,
    monotonic: () => 0,
    boot: { readBoot: () => ({ ms: 1, id: "boot-confirm-test" }) },
    read: (fn) => venue.db.withWriteLock(() => fn(venue.db as unknown as Transaction)),
    transaction: (fn) => withTransaction(venue.db, fn),
    nodeId: venue.cfg.nodeId,
    log: () => {},
    ...startDep,
  });
  const app = new Hono();
  mountBoxHealthApi(
    app,
    {
      db: venue.db,
      readHealth: () => Promise.reject(new Error("not read here")),
      freeSpace: () => Promise.reject(new Error("not freed here")),
      restart: () => {},
      clockSet: {
        backend: venue.backend,
        clock,
        steady: () => 0,
        requestFromBox: () => fromBox,
        devMode: false,
        correction: {
          inTurn: correction.inTurn,
          set: correction.set,
          // The first read after `stepBehind` is one step behind, as if a step landed after it.
          steps: () => {
            const steps = correction.steps() - lag;
            lag = 0;
            return steps;
          },
        },
        ...startDep,
      },
    },
    (_level, event, fields) => void logs.push({ event, fields: { ...fields } }),
  );
  return {
    app,
    start,
    hostAsks,
    logs,
    boxTime: () => boxMs,
    setFromBox: (value: boolean) => void (fromBox = value),
    stepBehind: () => void (lag = 1),
  };
}

type Box = ReturnType<typeof box>;

function rows(): number {
  const [row] = venue.db.all<{ n: number }>(sql`select count(*) as n from clock_confirmations`);
  return row!.n;
}

/** A challenge, then a confirmation with `body` added to its id. */
async function confirm(b: Box, cookie: string, body: Record<string, unknown>) {
  const asked = await send(b.app, cookie, "POST", "/api/box/clock-challenge");
  if (asked.status !== 200) return asked;
  return send(b.app, cookie, "POST", "/api/box/clock-confirm", {
    challengeId: asked.json.challengeId,
    ...body,
  });
}

/** Asserts a refusal with `reason`, no row, no host call and the start check unchanged. */
async function expectRefused(
  b: Box,
  sent: Promise<{ status: number; json: Record<string, unknown> }>,
  reason: string,
) {
  const before = { rows: rows(), status: b.start?.status };
  const answer = await sent;
  expect(answer.status).toBe(409);
  expect(answer.json).toEqual({ code: "clock.set_refused", params: { reason } });
  expect({ rows: rows(), status: b.start?.status }).toEqual(before);
  expect(b.hostAsks).toEqual({ status: 0, sets: 0 });
}

it("confirms a waiting start from an administrator's device within a minute, setting nothing", async () => {
  const b = box();
  const before = rows();

  const answer = await confirm(b, mario.cookie, { deviceAt: b.boxTime() + 30_000 });

  expect(answer.status).toBe(200);
  expect(answer.json).toEqual({
    confirmationId: null,
    stepMs: 0,
    confirmedAt: new Date(b.boxTime()).toISOString(),
  });
  expect(rows()).toBe(before);
  expect(b.hostAsks).toEqual({ status: 0, sets: 0 });
  expect(b.start!.status).toBe("by_person");
  const heads = await venue.db.withWriteLock(() => recordHeads(venue.db as unknown as Transaction));
  expect(b.start!.mark).toEqual(heads);
  expect(b.logs.filter((l) => l.event === "clock_start.confirmed")).toEqual([
    {
      event: "clock_start.confirmed",
      fields: {
        source: "admin",
        person: mario.id,
        boxAt: new Date(b.boxTime()).toISOString(),
        heads,
      },
    },
  ]);
});

it("confirms a waiting start as the box's date and time stand, whatever the device reads", async () => {
  const b = box();
  const before = rows();

  const answer = await confirm(b, mario.cookie, { asShown: true });

  expect(answer.status).toBe(200);
  expect(answer.json).toMatchObject({ confirmationId: null, stepMs: 0 });
  expect(rows()).toBe(before);
  expect(b.hostAsks).toEqual({ status: 0, sets: 0 });
  expect(b.start!.status).toBe("by_person");
});

it("refuses a confirmation while the start does not wait, or with no start check", async () => {
  const confirmed = startClockState();
  confirmed.confirm("by_internet", {});
  for (const start of [confirmed, null]) {
    const b = box({ start });
    await expectRefused(b, confirm(b, mario.cookie, { asShown: true }), "not_stopped");
    await expectRefused(b, confirm(b, mario.cookie, { deviceAt: b.boxTime() }), "not_stopped");
  }
});

it("refuses a device two days off without asShown, leaving the start waiting", async () => {
  const b = box();
  await expectRefused(
    b,
    confirm(b, mario.cookie, { deviceAt: b.boxTime() - 2 * DAY }),
    "disagrees",
  );
  expect(b.start!.status).toBe("waiting");
});

it("refuses asShown while the clock reads a date before 28-10-2024", async () => {
  const b = box({ boxMs: Date.UTC(2020, 0, 1, 12) });
  await expectRefused(b, confirm(b, mario.cookie, { asShown: true }), "stopped");
  expect(b.start!.status).toBe("waiting");
});

it("refuses a device's reading before 28-10-2024, even one agreeing with the box", async () => {
  const b = box({ boxMs: Date.UTC(2020, 0, 1, 12) });
  await expectRefused(b, confirm(b, mario.cookie, { deviceAt: b.boxTime() }), "target_invalid");
  expect(b.start!.status).toBe("waiting");
});

it("refuses a confirmation measured before a step of the box's clock", async () => {
  const b = box();
  const asked = await send(b.app, mario.cookie, "POST", "/api/box/clock-challenge");
  b.stepBehind();
  await expectRefused(
    b,
    send(b.app, mario.cookie, "POST", "/api/box/clock-confirm", {
      challengeId: asked.json.challengeId,
      asShown: true,
    }),
    "stale",
  );
  expect(b.start!.status).toBe("waiting");
});

it("refuses an administrator on the box itself", async () => {
  const b = box();
  b.setFromBox(true);
  await expectRefused(
    b,
    send(b.app, mario.cookie, "POST", "/api/box/clock-confirm", {
      challengeId: randomUUID(),
      asShown: true,
    }),
    "same_machine",
  );
});

it("lets only an administrator with a management session confirm", async () => {
  const b = box();
  const body = { challengeId: randomUUID(), asShown: true };
  const manager = await send(b.app, marta.cookie, "POST", "/api/box/clock-confirm", body);
  expect(manager.status).toBe(403);
  expect(manager.json).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "system.box_admin" },
  });
  for (const cookie of ["", venue.cookie]) {
    const sent = await send(b.app, cookie, "POST", "/api/box/clock-confirm", body);
    expect(sent.status).toBe(401);
    expect(sent.json).toMatchObject({ code: "management_session.required" });
  }
  expect(b.start!.status).toBe("waiting");
});

it("refuses an asShown that is not true or false", async () => {
  const b = box();
  const answer = await send(b.app, mario.cookie, "POST", "/api/box/clock-confirm", {
    challengeId: randomUUID(),
    asShown: "yes",
  });
  expect(answer.status).toBe(400);
  expect(answer.json).toEqual({ code: "management.request_invalid", params: { field: "asShown" } });
});
