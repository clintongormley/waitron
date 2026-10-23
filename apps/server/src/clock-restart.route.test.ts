import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPin, persons, startManagementSession, type PersonRoleValue } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { BoxHealth } from "./box-health.js";
import { mountBoxHealthApi } from "./box-health-api.js";
import { createClockWitnessStore, type ClockWitnessStore } from "./clock-witnesses.js";
import { inTx, provisionBillVenue, send, type BillVenue } from "./testing/bill-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { systemClock } from "./till-backend.js";
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
  app: Hono;
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
  const app = new Hono();
  mountBoxHealthApi(
    app,
    {
      db: venue.db,
      readHealth: async () => ({}) as BoxHealth,
      freeSpace: () => Promise.reject(new Error("not freed here")),
      clockRestart: {
        backend,
        witnesses: () => witnesses.witnesses(),
        clock: clockAt(behind),
        nodeId: venue.cfg.nodeId,
      },
    },
    () => {},
  );
  return { behind, recordId: record.id, witnesses, app };
}

/** A device whose clock read `offsetMs` from the box's, noted at the box's reading. */
function noteDevice(stop: Stop, offsetMs: number): void {
  stop.witnesses.noteDevice(randomUUID(), stop.behind + offsetMs, {
    wallMs: stop.behind,
    monoMs: 0,
  });
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
