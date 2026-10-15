import { beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deviceProfiles, devices, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createPinThrottle,
  deviceProfileAdmissionPersons,
  persons,
  registerModulePermissions,
  sessions,
} from "@waitron/identity";
import { WorkforceBackend, timeEntries, closePayPeriod } from "@waitron/workforce";
import { deviceOrigin } from "@waitron/shared";
import type { PersonHours } from "@waitron/workforce/attendance-contract";
import { ALL_MODULES } from "./modules.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import { mountTillAttendanceApi } from "./till-attendance-api.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const backend = new WorkforceBackend();
const now = new Date("2026-10-31T23:30:00Z");
let venue: ClockVenue;
beforeEach(async () => {
  venue = await createClockVenue(suite.db, () => now);
  registerModulePermissions(ALL_MODULES.flatMap((m) => m.permissions ?? []));
  mountTillAttendanceApi(
    venue.app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => now,
      attemptsFor: (id) => ({ throttle: createPinThrottle(), slot: id }),
    },
    () => {},
  );
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      personId: venue.personId,
      origin: deviceOrigin(venue.deviceId),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-05T17:00:00Z" });
  });
});
function read(
  query = `locationId=${venue.cfg.locationId}&kind=month&date=2026-01-05`,
  cookie = venue.cookie,
) {
  return venue.app.request(`/api/attendance/hours?${query}`, { headers: { cookie } });
}
const snapshot = () => suite.db.all(sql`select * from time_entries order by id`);
it("clock-only staff read their own completed hours passively without recording activity", async () => {
  const old = "2020-01-01T00:00:00.000Z";
  await suite.db.update(devices).set({ lastSeenAt: old }).where(eq(devices.id, venue.deviceId));
  const before = snapshot();
  const response = await read();
  expect(response.status).toBe(200);
  const value = (await response.json()) as PersonHours;
  expect(value).toMatchObject({
    personId: venue.personId,
    locationId: venue.cfg.locationId,
    workedMinutes: 480,
    period: { start: "2026-01-01", end: "2026-02-01" },
    pending: { prompts: [], items: [], automaticEntryIds: [] },
  });
  expect(value.record.entries.map((e) => e.entry.personId)).toEqual([
    venue.personId,
    venue.personId,
  ]);
  expect(snapshot()).toEqual(before);
  expect(
    (await suite.db.select().from(devices).where(eq(devices.id, venue.deviceId)))[0]!.lastSeenAt,
  ).toBe(old);
  const defaultView = await read(`locationId=${venue.cfg.locationId}&kind=month`);
  expect(defaultView.status).toBe(200);
  expect(await defaultView.json()).toMatchObject({
    businessDay: "2026-10-31",
    period: { start: "2026-10-01", end: "2026-11-01" },
  });
});
it("requires the current session before parsing the hours query", async () => {
  const response = await read("garbage", "");
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
});
it.each(["ended", "disabled", "deleted", "suspended", "admission", "profile", "location"] as const)(
  "refuses changed %s admission without revealing hours",
  async (kind) => {
    if (kind === "ended")
      await suite.db
        .update(sessions)
        .set({ endedAt: now.toISOString() })
        .where(eq(sessions.id, venue.sessionId));
    if (kind === "disabled")
      await suite.db.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
    if (kind === "deleted")
      await suite.db
        .update(devices)
        .set({ deletedAt: now.toISOString() })
        .where(eq(devices.id, venue.deviceId));
    if (kind === "suspended")
      await suite.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, venue.personId));
    if (kind === "admission")
      await suite.db
        .insert(deviceProfileAdmissionPersons)
        .values({ deviceProfileId: venue.profileId, personId: venue.personId, admitted: false });
    if (kind === "profile")
      await suite.db
        .update(deviceProfiles)
        .set({ capabilities: [] })
        .where(eq(deviceProfiles.id, venue.profileId));
    if (kind === "location") {
      const [other] = await suite.db
        .insert(locations)
        .values({ name: "Other", invoiceLocales: ["es"], operationDescription: "Restaurant" })
        .returning();
      await suite.db
        .update(devices)
        .set({ locationId: other!.id })
        .where(eq(devices.id, venue.deviceId));
    }
    const before = snapshot();
    const response = await read();
    expect(response.status).toBe(kind === "ended" ? 401 : 403);
    expect(await response.json()).toMatchObject({
      error: {
        code:
          kind === "ended"
            ? "session.required"
            : kind === "disabled" || kind === "deleted"
              ? "device.unauthorized"
              : kind === "profile"
                ? "device.forbidden_action"
                : "attendance.not_permitted",
      },
    });
    expect(snapshot()).toEqual(before);
  },
);
it("refuses a random workplace and admits a recorded historical workplace", async () => {
  const [other] = await suite.db
    .insert(locations)
    .values({ name: "Historic", invoiceLocales: ["es"], operationDescription: "Restaurant" })
    .returning();
  const query = `locationId=${other!.id}&kind=month&date=2026-01-05`;
  let response = await read(query);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "attendance.not_permitted" } });
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      locationId: other!.id,
      personId: venue.personId,
      origin: deviceOrigin(venue.deviceId),
      offsetMinutes: 0,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-06T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-06T17:00:00Z" });
  });
  response = await read(query);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ locationId: other!.id, workedMinutes: 480 });
});
it("scopes frozen snapshots and current entries to the session person", async () => {
  const [other] = await suite.db.select().from(persons).where(eq(persons.role, "admin"));
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      personId: other!.id,
      origin: deviceOrigin(venue.deviceId),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-05T18:00:00Z" });
    await closePayPeriod(tx, {
      ...venue.cfg,
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
      now: "2026-02-01T04:00:00Z",
      ruleset: { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
      origin: { source: "dashboard", deviceId: null },
    });
  });
  const response = await read();
  expect(response.status).toBe(200);
  const value = (await response.json()) as PersonHours;
  expect(value.workedMinutes).toBe(480);
  expect(value.record.closures[0]!.snapshot.sessions.map((s) => s.personId)).toEqual([
    venue.personId,
  ]);
  expect(value.record.closures[0]!.snapshot.entries.map((e) => e.entry.personId)).toEqual([
    venue.personId,
    venue.personId,
  ]);
  expect(value.record.entries.every((e) => e.entry.personId === venue.personId)).toBe(true);
});
it.each(["personId=foreign", "kind=pay-period", "date=2026-02-30", "kind=week&kind=month"])(
  "rejects widened or malformed scope %s",
  async (extra) => {
    const response = await read(`locationId=${venue.cfg.locationId}&kind=month&${extra}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  },
);
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it.each(["session", "admission", "allowed"] as const)(
  "rechecks the inner %s state after initial authentication",
  async (kind) => {
    expect((await read()).status).toBe(200);
    const entered = gate(),
      release = gate();
    const real = suite.db.withWriteLock.bind(suite.db);
    let calls = 0;
    const spy = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(async <T>(body: () => Promise<T>) => {
        if (++calls === 2) {
          entered.resolve();
          await release.promise;
        }
        return real(body);
      });
    const before = await suite.db.select().from(timeEntries);
    const asked = read();
    try {
      await entered.promise;
      if (kind === "session")
        await suite.db
          .update(sessions)
          .set({ endedAt: now.toISOString() })
          .where(eq(sessions.id, venue.sessionId));
      if (kind === "admission")
        await suite.db
          .insert(deviceProfileAdmissionPersons)
          .values({ deviceProfileId: venue.profileId, personId: venue.personId, admitted: false });
    } finally {
      release.resolve();
      spy.mockRestore();
    }
    const response = await asked;
    expect(response.status).toBe(kind === "allowed" ? 200 : kind === "session" ? 401 : 403);
    if (kind !== "allowed")
      expect(await response.json()).toMatchObject({
        error: { code: kind === "session" ? "session.required" : "attendance.not_permitted" },
      });
    expect(await suite.db.select().from(timeEntries)).toEqual(before);
  },
);
