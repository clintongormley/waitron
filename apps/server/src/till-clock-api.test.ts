import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deviceProfiles, devices, locations, withTransaction } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { loginWithPin, persons, sessions } from "@waitron/identity";
import {
  readChain,
  readChainHead,
  timeEntries,
  verifyChain,
  WorkforceBackend,
} from "@waitron/workforce";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import type { TillClockState } from "./till-clock-state.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { SESSION_COOKIE } from "./till-session.js";
import { DEVICE_COOKIE } from "./device-session.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: ClockVenue;
let instant: Date;
beforeEach(async () => {
  instant = new Date("2026-01-05T09:00:00Z");
  venue = await createClockVenue(suite.db, () => instant);
});
const paths = ["state", "in", "out", "break-start", "break-end"] as const;
function request(
  path: (typeof paths)[number],
  body: unknown = { expectedEntryId: null },
  cookie = venue.cookie,
) {
  return venue.app.request(`/api/clock/${path}`, {
    method: path === "state" ? "GET" : "POST",
    headers: { cookie, "Content-Type": "application/json" },
    ...(path === "state" ? {} : { body: JSON.stringify(body) }),
  });
}
async function state() {
  const response = await request("state");
  expect(response.status).toBe(200);
  return (await response.json()) as TillClockState;
}
async function count() {
  return (await suite.db.select({ id: timeEntries.id }).from(timeEntries)).length;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("signed-in own till clock routes", () => {
  it("serves a legitimate concurrent clock request behind another person's write", async () => {
    const entered = deferred();
    const release = deferred();
    const holder = withTransaction(suite.db, async (tx) => {
      await tx
        .update(persons)
        .set({ displayName: "Owner updated" })
        .where(eq(persons.role, "admin"));
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const asked = deferred();
    const realLock = suite.db.withWriteLock.bind(suite.db);
    const lock = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>) => {
        asked.resolve();
        return realLock(body);
      });
    let response: ReturnType<ClockVenue["app"]["request"]>;
    try {
      response = request("in");
      await asked.promise;
    } finally {
      lock.mockRestore();
      release.resolve();
    }
    await holder;
    expect((await response!).status).toBe(200);
    expect(await count()).toBe(1);
  });

  it("refuses break and out writes on a shift at another location, while a matching-location shift succeeds", async () => {
    const [other] = await suite.db
      .insert(locations)
      .values({ name: "Other shift", invoiceLocales: ["es"], operationDescription: "Restaurant" })
      .returning({ id: locations.id });
    const foreignNode = await seedNode(suite.db, brandLocationId(other!.id));
    const backend = new WorkforceBackend();
    const foreign = {
      personId: venue.personId,
      locationId: other!.id,
      nodeId: foreignNode,
      at: instant.toISOString(),
      offsetMinutes: 60,
      origin: jobOrigin("dashboard"),
    };
    await withTransaction(suite.db, (tx) => backend.clockIn(tx, foreign));
    const before = await state();
    expect(before).toMatchObject({
      state: "working",
      activeLocationId: other!.id,
      firstClockIn: true,
    });
    for (const path of ["out", "break-start", "break-end"] as const) {
      const response = await request(path, { expectedEntryId: before.lastEntryId });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "attendance.not_permitted" } });
    }
    expect(await count()).toBe(1);
    await withTransaction(suite.db, (tx) =>
      backend.clockOut(tx, { ...foreign, at: "2026-01-05T09:01:00Z" }),
    );
    instant = new Date("2026-01-05T09:02:00Z");
    expect((await request("in", { expectedEntryId: (await state()).lastEntryId })).status).toBe(
      200,
    );
    expect(await state()).toMatchObject({
      state: "working",
      activeLocationId: venue.cfg.locationId,
      firstClockIn: false,
    });
  });

  it("keeps an automatic state read passive and records a submitted action as device activity", async () => {
    const lastSeenAt = "2020-01-01T00:00:00.000Z";
    await suite.db.update(devices).set({ lastSeenAt }).where(eq(devices.id, venue.deviceId));
    await state();
    const device = () =>
      suite.db
        .select({ lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(eq(devices.id, venue.deviceId));
    expect(await device()).toEqual([{ lastSeenAt }]);
    expect((await request("in")).status).toBe(200);
    expect((await device())[0]!.lastSeenAt).not.toBe(lastSeenAt);
  });

  it.each(["session", "profile", "person", "location"] as const)(
    "rechecks %s admission after the request queued behind another write",
    async (change) => {
      const bodyReached = deferred();
      const releaseBody = deferred();
      const raw = new Request("http://clock.test/api/clock/in", {
        method: "POST",
        headers: { cookie: venue.cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedEntryId: null }),
      });
      const realText = raw.text.bind(raw);
      // Hono's JSON reader consumes raw text; pausing here leaves authentication complete.
      raw.text = async () => {
        bodyReached.resolve();
        await releaseBody.promise;
        return realText();
      };
      const response = venue.app.request(raw);
      await bodyReached.promise;
      const entered = deferred();
      const releaseWriter = deferred();
      const holder = withTransaction(suite.db, async (tx) => {
        if (change === "session")
          await tx
            .update(sessions)
            .set({ endedAt: instant.toISOString() })
            .where(eq(sessions.id, venue.sessionId));
        if (change === "profile")
          await tx
            .update(deviceProfiles)
            .set({ capabilities: [] })
            .where(eq(deviceProfiles.id, venue.profileId));
        if (change === "person")
          await tx
            .update(persons)
            .set({ status: "suspended" })
            .where(eq(persons.id, venue.personId));
        if (change === "location") {
          const [other] = await tx
            .insert(locations)
            .values({ name: "Moved", invoiceLocales: ["es"], operationDescription: "Restaurant" })
            .returning({ id: locations.id });
          await tx
            .update(devices)
            .set({ locationId: other!.id })
            .where(eq(devices.id, venue.deviceId));
        }
        entered.resolve();
        await releaseWriter.promise;
      });
      await entered.promise;
      const queued = deferred();
      const realLock = suite.db.withWriteLock.bind(suite.db);
      const lock = vi
        .spyOn(suite.db, "withWriteLock")
        .mockImplementation(<T>(body: () => Promise<T>) => {
          queued.resolve();
          return realLock(body);
        });
      try {
        releaseBody.resolve();
        await queued.promise;
      } finally {
        lock.mockRestore();
        releaseBody.resolve();
        releaseWriter.resolve();
      }
      await holder;
      const result = await response;
      expect(result.status).toBe(change === "session" ? 401 : 403);
      expect(await result.json()).toMatchObject({
        error: {
          code:
            change === "session"
              ? "session.required"
              : change === "profile"
                ? "device.forbidden_action"
                : "attendance.not_permitted",
        },
      });
      expect(await count()).toBe(0);
    },
  );

  it("serialises two devices clocking in the same person", async () => {
    const other = await enrolDeviceForTest(suite.db, venue.cfg, {
      name: "Other clock till",
      profileId: venue.profileId,
    });
    const session = await withTransaction(suite.db, (tx) =>
      loginWithPin(tx, { deviceId: other.deviceId, personId: venue.personId, pin: "5555" }),
    );
    const cookie = `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${other.deviceId}.${other.token}`;
    const responses = await Promise.all([
      request("in"),
      request("in", { expectedEntryId: null }, cookie),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await responses.find((r) => r.status === 409)!.json()).toMatchObject({
      error: { code: "attendance.state_changed" },
    });
    expect(await count()).toBe(1);
    const rows = await readChain(suite.db, {
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
    });
    expect(verifyChain(rows)).toEqual({ ok: true });
  });

  it("rolls back the break end and chain head when the out append is refused", async () => {
    await request("in");
    await request("break-start", { expectedEntryId: (await state()).lastEntryId });
    const before = await state();
    const key = { nodeId: venue.cfg.nodeId, locationId: venue.cfg.locationId };
    const head = await withTransaction(suite.db, (tx) => readChainHead(tx, key));
    await suite.db.execute(sql`create trigger clock_test_out_refusal before insert on time_entries
      when new.entry_kind = 'out' begin select raise(abort, 'clock test out refusal'); end`);
    try {
      const response = await request("out", { expectedEntryId: before.lastEntryId });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: "server.internal" } });
      expect(await count()).toBe(2);
      expect(await state()).toEqual(before);
      expect(await withTransaction(suite.db, (tx) => readChainHead(tx, key))).toEqual(head);
    } finally {
      await suite.db.execute(sql`drop trigger clock_test_out_refusal`);
    }
  });

  it.each([
    ["2026-10-25T00:30:00Z", 120],
    ["2026-10-25T01:30:00Z", 60],
    ["2026-03-29T00:30:00Z", 60],
    ["2026-03-29T01:30:00Z", 120],
  ] as const)("records Madrid's server-derived offset at %s as %s", async (at, offset) => {
    instant = new Date(at);
    expect((await request("in")).status).toBe(200);
    const rows = await readChain(suite.db, {
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
    });
    expect(rows.map((r) => [r.eventAt, r.eventOffsetMinutes])).toEqual([
      [instant.toISOString(), offset],
    ]);
  });

  it("allows admitted staff with only clock-in and no service-zone access", async () => {
    expect(await state()).toEqual({
      personId: venue.personId,
      locationId: venue.cfg.locationId,
      businessDay: "2026-01-05",
      state: "out",
      activeLocationId: null,
      lastEntryId: null,
      firstClockIn: true,
    });
    for (const [path, want] of [
      ["in", "working"],
      ["break-start", "on_break"],
      ["break-end", "working"],
      ["out", "out"],
    ] as const) {
      const previous = await state();
      const response = await request(path, { expectedEntryId: previous.lastEntryId });
      expect(response.status, path).toBe(200);
      expect(await response.json()).toEqual({
        ...previous,
        state: want,
        activeLocationId: want === "out" ? null : venue.cfg.locationId,
        lastEntryId: expect.any(String),
        firstClockIn: false,
      });
      instant = new Date(instant.getTime() + 60_000);
    }
    const chain = await readChain(suite.db, {
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
    });
    expect(
      chain.map((row) => [
        row.entryKind,
        row.personId,
        row.recordedByPersonId,
        row.capturedBySource,
        row.capturedByDeviceId,
      ]),
    ).toEqual([
      ["in", venue.personId, venue.personId, "device", venue.deviceId],
      ["break_start", venue.personId, venue.personId, "device", venue.deviceId],
      ["break_end", venue.personId, venue.personId, "device", venue.deviceId],
      ["out", venue.personId, venue.personId, "device", venue.deviceId],
    ]);
    expect(verifyChain(chain)).toEqual({ ok: true });
  });

  it.each(paths)("rejects a profile without clock-in on %s", async (path) => {
    await suite.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, venue.profileId));
    const response = await request(path);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "device.forbidden_action", params: { action: "clock-in" } },
    });
    expect(await count()).toBe(0);
  });

  it.each(paths)(
    "requires an open authenticated session on %s, even with a malformed body",
    async (path) => {
      const response = await request(path, null, "");
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
      expect(await count()).toBe(0);
    },
  );

  it("rejects forged subject and time and malformed expected ids before writing", async () => {
    for (const body of [
      null,
      [],
      {},
      { expectedEntryId: "" },
      { expectedEntryId: 1 },
      { expectedEntryId: [] },
      { expectedEntryId: "not-a-uuid" },
      { expectedEntryId: null, personId: venue.personId },
      { expectedEntryId: null, at: instant.toISOString() },
      { expectedEntryId: null, locationId: venue.cfg.locationId },
      { expectedEntryId: null, origin: {} },
    ]) {
      const response = await request("in", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "attendance.invalid", params: { reason: "clock_request" } },
      });
    }
    const response = await venue.app.request(`/api/clock/state?personId=${venue.personId}`, {
      headers: { cookie: venue.cookie },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "attendance.invalid" } });
    expect(await count()).toBe(0);
  });

  it("refuses a legitimate stale UUID or null with state_changed and appends nothing", async () => {
    const stale = await request("in", { expectedEntryId: "10000000-0000-4000-8000-000000000001" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "attendance.state_changed" } });
    expect((await request("in")).status).toBe(200);
    const second = await request("out", { expectedEntryId: null });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "attendance.state_changed" } });
    expect(await count()).toBe(1);
  });

  it("ends a break and clocks out atomically at one server instant", async () => {
    await request("in");
    instant = new Date("2026-01-05T10:00:00Z");
    await request("break-start", { expectedEntryId: (await state()).lastEntryId });
    instant = new Date("2026-01-05T10:30:00Z");
    const response = await request("out", { expectedEntryId: (await state()).lastEntryId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "out", activeLocationId: null });
    const rows = await readChain(suite.db, {
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
    });
    expect(rows.map((r) => [r.entryKind, r.eventAt])).toEqual([
      ["in", "2026-01-05T09:00:00.000Z"],
      ["break_start", "2026-01-05T10:00:00.000Z"],
      ["break_end", "2026-01-05T10:30:00.000Z"],
      ["out", "2026-01-05T10:30:00.000Z"],
    ]);
    expect(verifyChain(rows)).toEqual({ ok: true });
  });

  it("refuses a revoked person, ended session or device moved to another location", async () => {
    await suite.db
      .update(persons)
      .set({ status: "suspended" })
      .where(eq(persons.id, venue.personId));
    const revoked = await request("in");
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toMatchObject({ error: { code: "attendance.not_permitted" } });
    await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, venue.personId));
    const [other] = await suite.db
      .insert(locations)
      .values({ name: "Other", invoiceLocales: ["es"], operationDescription: "Restaurant" })
      .returning({ id: locations.id });
    await suite.db
      .update(devices)
      .set({ locationId: other!.id })
      .where(eq(devices.id, venue.deviceId));
    const moved = await request("in");
    expect(moved.status).toBe(403);
    expect(await moved.json()).toMatchObject({ error: { code: "attendance.not_permitted" } });
    await withTransaction(suite.db, (tx) =>
      tx
        .update(sessions)
        .set({ endedAt: instant.toISOString() })
        .where(eq(sessions.id, venue.sessionId)),
    );
    const ended = await request("in");
    expect(ended.status).toBe(401);
    expect(await ended.json()).toMatchObject({ error: { code: "session.required" } });
    expect(await count()).toBe(0);
  });
});
