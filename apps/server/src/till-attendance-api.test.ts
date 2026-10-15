import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deviceProfiles, devices, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createPinThrottle,
  deviceProfileAdmissionPersons,
  hashPin,
  persons,
  loginWithPin,
  registerModulePermissions,
  sessions,
} from "@waitron/identity";
import {
  attendanceQuestions,
  readAttendanceInbox,
  timeEntries,
  WorkforceBackend,
} from "@waitron/workforce";
import { deviceOrigin } from "@waitron/shared";
import type {
  AttendanceCommandResult,
  AttendanceInbox,
} from "@waitron/workforce/attendance-contract";
import { ALL_MODULES } from "./modules.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import { mountTillAttendanceApi } from "./till-attendance-api.js";
import {
  watchDerivations,
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
} from "./testing/watched-scrypt.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { SESSION_COOKIE } from "./till-session.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { mountTillApi } from "./till-api.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";

vi.mock("node:crypto", async (original) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await original()),
);

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const backend = new WorkforceBackend();
let venue: ClockVenue;
let instant: Date;
let targetId: string;
let managerId: string;
let throttle: ReturnType<typeof createPinThrottle>;
beforeEach(async () => {
  instant = new Date("2026-01-06T09:00:00Z");
  venue = await createClockVenue(suite.db, () => instant);
  registerModulePermissions(ALL_MODULES.flatMap((m) => m.permissions ?? []));
  throttle = createPinThrottle();
  mountTillAttendanceApi(
    venue.app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => instant,
      attemptsFor: (id) => ({ throttle, slot: `override:${id}` }),
    },
    () => {},
  );
  const [manager] = await suite.db
    .insert(persons)
    .values({
      displayName: "Supervisor",
      role: "supervisor",
      pinHash: hashPin("4321"),
    })
    .returning({ id: persons.id });
  managerId = manager!.id;
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
  targetId = (await suite.db.select().from(timeEntries)).find((e) => e.entryKind === "out")!.id;
});
function request(path: string, body?: unknown, cookie = venue.cookie) {
  return venue.app.request(`/api/attendance/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function revision() {
  return (await withTransaction(suite.db, (tx) => readAttendanceInbox(tx, venue.personId)))
    .revision;
}
async function command() {
  return {
    commandId: randomUUID(),
    expectedRevision: await revision(),
    action: "request",
    questionId: null,
    locationId: venue.cfg.locationId,
    changes: [{ target: { entryId: targetId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 }],
    reason: "Stayed later",
  };
}
async function snapshot() {
  return {
    rows: await suite.db.select().from(timeEntries),
    questions: await suite.db.select().from(attendanceQuestions),
    commands: suite.db.all(sql`select * from attendance_response_commands order by id`),
    heads: suite.db.all(sql`select * from workforce_chains order by node_id, location_id`),
  };
}
async function pending() {
  const body = await command();
  const response = await request("commands", body);
  expect(response.status).toBe(200);
  return ((await response.json()) as AttendanceCommandResult).entryIds[0]!;
}
const routes = [
  ["inbox", undefined],
  ["day?date=2026-01-05&locationId=LOCATION", undefined],
  ["commands/ID", undefined],
  ["items/ID/approvers?action=approve", undefined],
  ["commands", { commandId: "invalid" }],
] as const;
function pathOf(path: string) {
  return path.replace("LOCATION", venue.cfg.locationId).replace("ID", randomUUID());
}

it("serves own history to clock-only staff without service zones and keeps reads passive", async () => {
  const lastSeenAt = "2020-01-01T00:00:00.000Z";
  await suite.db.update(devices).set({ lastSeenAt }).where(eq(devices.id, venue.deviceId));
  const inbox = await request("inbox");
  expect(inbox.status).toBe(200);
  expect(await inbox.json()).toMatchObject({
    personId: venue.personId,
    revision: await revision(),
    items: [],
    prompts: [],
  });
  const day = await request(`day?date=2026-01-05&locationId=${venue.cfg.locationId}`);
  expect(day.status).toBe(200);
  expect(await day.json()).toMatchObject({
    personId: venue.personId,
    date: "2026-01-05",
    timeZone: "Europe/Madrid",
    revision: await revision(),
  });
  expect(
    (await suite.db.select().from(devices).where(eq(devices.id, venue.deviceId)))[0]!.lastSeenAt,
  ).toBe(lastSeenAt);
});

it("offers the configured workplace for a first correction before any clock history", async () => {
  const [worker] = await suite.db
    .insert(persons)
    .values({ displayName: "New worker", role: "staff", pinHash: hashPin("5678") })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { personId: worker!.id, deviceId: venue.deviceId, pin: "5678" }),
  );
  const cookie = `${SESSION_COOKIE}=${session.token}; ${venue.cookie.split("; ")[1]!}`;
  const response = await request("inbox", undefined, cookie);
  expect(response.status).toBe(200);
  const inbox = (await response.json()) as AttendanceInbox;
  expect(inbox.personId).toBe(worker!.id);
  expect(inbox.items).toEqual([]);
  expect(inbox.prompts).toEqual([]);
  expect(inbox.locations).toEqual([
    { id: venue.cfg.locationId, name: "Clock venue", timeZone: "Europe/Madrid" },
  ]);
  const day = await request(
    `day?date=2026-01-04&locationId=${venue.cfg.locationId}`,
    undefined,
    cookie,
  );
  expect(day.status).toBe(200);
  expect(await day.json()).toMatchObject({ personId: worker!.id, record: { entries: [] } });
  const submitted = await request(
    "commands",
    {
      commandId: randomUUID(),
      expectedRevision: inbox.revision,
      action: "request",
      questionId: null,
      locationId: venue.cfg.locationId,
      changes: [
        { target: { missingKind: "in" }, at: "2026-01-04T09:00:00Z", offsetMinutes: 60 },
        { target: { missingKind: "out" }, at: "2026-01-04T17:00:00Z", offsetMinutes: 60 },
      ],
      reason: "Forgot both clock entries",
    },
    cookie,
  );
  expect(submitted.status).toBe(200);
  const result = (await submitted.json()) as AttendanceCommandResult;
  expect(result.entryIds).toHaveLength(2);
  const refreshed = (await (await request("inbox", undefined, cookie)).json()) as AttendanceInbox;
  expect(refreshed.locations).toEqual(inbox.locations);
  expect(refreshed.items).toMatchObject([
    { personId: worker!.id, status: "waiting-manager", requestEntryIds: result.entryIds },
  ]);
});

it.each(routes)("requires a current session on %s before parsing", async (path, body) => {
  const response = await request(pathOf(path), body, "");
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "session.required" } });
});
it.each(routes)("rejects a profile without clock-in on %s", async (path, body) => {
  await suite.db
    .update(deviceProfiles)
    .set({ capabilities: [] })
    .where(eq(deviceProfiles.id, venue.profileId));
  const response = await request(pathOf(path), body);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "device.forbidden_action", params: { action: "clock-in" } },
  });
});
it.each(["ended", "disabled", "deleted", "admission", "suspended", "location"] as const)(
  "rechecks %s admission on every attendance route",
  async (kind) => {
    if (kind === "ended")
      await suite.db
        .update(sessions)
        .set({ endedAt: instant.toISOString() })
        .where(eq(sessions.id, venue.sessionId));
    if (kind === "disabled")
      await suite.db.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
    if (kind === "deleted")
      await suite.db
        .update(devices)
        .set({ deletedAt: instant.toISOString() })
        .where(eq(devices.id, venue.deviceId));
    if (kind === "admission")
      await suite.db
        .insert(deviceProfileAdmissionPersons)
        .values({ deviceProfileId: venue.profileId, personId: venue.personId, admitted: false });
    if (kind === "suspended")
      await suite.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, venue.personId));
    if (kind === "location") {
      const [other] = await suite.db
        .insert(locations)
        .values({ name: "Moved", invoiceLocales: ["es"], operationDescription: "Restaurant" })
        .returning();
      await suite.db
        .update(devices)
        .set({ locationId: other!.id })
        .where(eq(devices.id, venue.deviceId));
    }
    const before = await snapshot();
    for (const [path, body] of routes) {
      const response = await request(
        pathOf(path),
        body === undefined ? undefined : await command(),
      );
      expect(response.status, path).toBe(kind === "ended" ? 401 : 403);
      expect(await response.json()).toMatchObject({
        error: {
          code:
            kind === "ended"
              ? "session.required"
              : kind === "disabled" || kind === "deleted"
                ? "device.unauthorized"
                : "attendance.not_permitted",
        },
      });
    }
    expect(await snapshot()).toEqual(before);
  },
);

it("records trusted requester and device, then replays before the old revision and scopes receipt recovery", async () => {
  const body = await command();
  const response = await request("commands", body);
  expect(response.status).toBe(200);
  const result = (await response.json()) as AttendanceCommandResult;
  expect(result).toEqual({
    commandId: body.commandId,
    entryIds: [expect.any(String)],
    replayed: false,
  });
  const rows = await suite.db.select().from(timeEntries);
  expect(rows.find((e) => e.id === result.entryIds[0])).toMatchObject({
    personId: venue.personId,
    recordedByPersonId: venue.personId,
    capturedBySource: "device",
    capturedByDeviceId: venue.deviceId,
    locationId: venue.cfg.locationId,
    nodeId: venue.cfg.nodeId,
    eventAt: "2026-01-05T18:00:00.000Z",
  });
  const replay = await request("commands", body);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ ...result, replayed: true });
  expect(await suite.db.select().from(timeEntries)).toEqual(rows);
  const receipt = await request(`commands/${body.commandId}`);
  expect(await receipt.json()).toEqual({ ...result, replayed: true });
  expect(await (await request(`commands/${randomUUID()}`)).json()).toBeNull();
  const inbox = (await (await request("inbox")).json()) as AttendanceInbox;
  expect(inbox.items).toMatchObject([{ id: result.entryIds[0], status: "waiting-manager" }]);
  expect(inbox.prompts).toEqual([]);
});

it("refuses arbitrary workplaces but permits recorded historical workplaces", async () => {
  const [other] = await suite.db
    .insert(locations)
    .values({ name: "Other", invoiceLocales: ["es"], operationDescription: "Restaurant" })
    .returning();
  const path = `day?date=2026-01-05&locationId=${other!.id}`;
  expect((await request(path)).status).toBe(403);
  const body = {
    ...(await command()),
    locationId: other!.id,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-04T09:00:00Z", offsetMinutes: 60 },
      { target: { missingKind: "out" }, at: "2026-01-04T17:00:00Z", offsetMinutes: 60 },
    ],
  };
  const response = await request("commands", body);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "attendance.not_permitted" } });
  await suite.db.insert(attendanceQuestions).values({
    locationId: other!.id,
    personId: venue.personId,
    businessDay: "2026-01-04",
    kind: "missing-times",
    active: false,
    shiftKey: "old-place",
    evidenceKeys: ["retained"],
    createdAt: instant.toISOString(),
    inactiveReason: "retired",
    startAt: "2026-01-04T04:00:00.000Z",
    endAt: "2026-01-05T04:00:00.000Z",
    missingKinds: ["in", "out"],
  });
  expect((await request(path)).status).toBe(200);
  body.expectedRevision = await revision();
  expect((await request("commands", body)).status).toBe(200);
});

it("requires the selected approver PIN even when the operator is an admin", async () => {
  const itemId = await pending();
  await suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, venue.personId));
  const body = {
    commandId: randomUUID(),
    expectedRevision: await revision(),
    action: "approve",
    itemId,
  };
  const before = await snapshot();
  for (const extra of [{}, { override: { personId: managerId, pin: "0000" } }]) {
    const response = await request("commands", { ...body, ...extra });
    expect(response.status).toBe(extra.override ? 403 : 400);
    expect(await response.json()).toMatchObject({
      error: { code: extra.override ? "pin.invalid" : "management.request_invalid" },
    });
    expect(await snapshot()).toEqual(before);
  }
  const allowed = await request("commands", {
    ...body,
    override: { personId: venue.personId, pin: "5555" },
  });
  expect(allowed.status).toBe(200);
  const inbox = (await (await request("inbox")).json()) as AttendanceInbox;
  expect(inbox.items).toMatchObject([{ status: "approved", selfApproved: true }]);
});

it.each(["", "x", "123"])("preserves identity's wrong-PIN refusal for %j", async (pin) => {
  const itemId = await pending();
  const response = await request("commands", {
    commandId: randomUUID(),
    expectedRevision: await revision(),
    action: "approve",
    itemId,
    override: { personId: managerId, pin },
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "pin.invalid" } });
});

it("lists eligible approvers without secrets and filters current self-approval and self-decline", async () => {
  const itemId = await pending();
  for (const role of ["staff", "supervisor", "admin"] as const) {
    await suite.db.update(persons).set({ role }).where(eq(persons.id, venue.personId));
    for (const action of ["approve", "decline"] as const) {
      const response = await request(`items/${itemId}/approvers?action=${action}`);
      expect(response.status).toBe(200);
      const result = (await response.json()) as { personId: string; displayName: string }[];
      expect(result).toContainEqual({ personId: managerId, displayName: "Supervisor" });
      expect(result.some((p) => p.personId === venue.personId)).toBe(
        role === "admin" && action === "approve",
      );
      expect(result.every((p) => Object.keys(p).sort().join() === "displayName,personId")).toBe(
        true,
      );
    }
  }
});

it("rejects malformed queries, ids and forged attribution without appending", async () => {
  const before = await snapshot();
  for (const path of [
    "inbox?personId=foreign",
    "commands/not-an-id",
    `commands/${randomUUID()}?personId=foreign`,
    `items/${randomUUID()}/approvers?action=approve&action=decline`,
    `day?date=2026-02-30&locationId=${venue.cfg.locationId}`,
    `day?date=2026-01-05&locationId=${venue.cfg.locationId}&personId=${managerId}`,
  ]) {
    const response = await request(path);
    expect(response.status, path).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
  for (const extra of [
    { personId: managerId },
    { nodeId: randomUUID() },
    { origin: "dashboard" },
    { now: instant.toISOString() },
    { override: { personId: managerId, pin: "4321" } },
  ]) {
    const response = await request("commands", { ...(await command()), ...extra });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
  expect(await snapshot()).toEqual(before);
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it.each(["session", "admission", "device", "profile"] as const)(
  "rechecks %s after authentication while the human write is queued",
  async (kind) => {
    const body = await command();
    const reached = gate(),
      releaseBody = gate(),
      writerEntered = gate(),
      releaseWriter = gate();
    const raw = new Request("http://test/api/attendance/commands", {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = raw.text.bind(raw);
    raw.text = async () => {
      reached.resolve();
      await releaseBody.promise;
      return text();
    };
    const before = await snapshot();
    const asked = venue.app.request(raw);
    await reached.promise;
    const holder = withTransaction(suite.db, async (tx) => {
      if (kind === "session")
        await tx
          .update(sessions)
          .set({ endedAt: instant.toISOString() })
          .where(eq(sessions.id, venue.sessionId));
      if (kind === "admission")
        await tx
          .insert(deviceProfileAdmissionPersons)
          .values({ deviceProfileId: venue.profileId, personId: venue.personId, admitted: false });
      if (kind === "device")
        await tx.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
      if (kind === "profile")
        await tx
          .update(deviceProfiles)
          .set({ capabilities: [] })
          .where(eq(deviceProfiles.id, venue.profileId));
      writerEntered.resolve();
      await releaseWriter.promise;
    });
    await writerEntered.promise;
    const queued = gate();
    const realLock = suite.db.withWriteLock.bind(suite.db);
    const spy = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>) => {
        queued.resolve();
        return realLock(body);
      });
    try {
      releaseBody.resolve();
      await queued.promise;
    } finally {
      spy.mockRestore();
      releaseWriter.resolve();
      releaseBody.resolve();
    }
    await holder;
    const response = await asked;
    expect(response.status).toBe(kind === "session" ? 401 : 403);
    expect(await response.json()).toMatchObject({
      error: {
        code:
          kind === "session"
            ? "session.required"
            : kind === "admission"
              ? "attendance.not_permitted"
              : kind === "profile"
                ? "device.forbidden_action"
                : "device.unauthorized",
      },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("lets a legitimate request queued behind another transaction write its own correction", async () => {
  const body = await command();
  const entered = gate(),
    release = gate(),
    queued = gate();
  const holder = withTransaction(suite.db, async (tx) => {
    await tx
      .update(persons)
      .set({ displayName: "Updated supervisor" })
      .where(eq(persons.id, managerId));
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const realLock = suite.db.withWriteLock.bind(suite.db);
  const spy = vi
    .spyOn(suite.db, "withWriteLock")
    .mockImplementation(<T>(body: () => Promise<T>) => {
      queued.resolve();
      return realLock(body);
    });
  let asked: ReturnType<typeof request>;
  try {
    asked = request("commands", body);
    await queued.promise;
  } finally {
    spy.mockRestore();
    release.resolve();
  }
  await holder;
  expect((await asked!).status).toBe(200);
  expect((await snapshot()).rows).toHaveLength(3);
});

it.each(["active", "demoted", "suspended"] as const)(
  "checks the PIN ahead and rechecks an %s authorizer with identity's current-hash policy",
  async (kind) => {
    const itemId = await pending();
    const before = await snapshot();
    watchDerivationsAndLock(suite.db, "4321", () =>
      withTransaction(suite.db, async (tx) => {
        if (kind === "demoted")
          await tx.update(persons).set({ role: "staff" }).where(eq(persons.id, managerId));
        else if (kind === "suspended")
          await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, managerId));
        else
          await tx
            .update(persons)
            .set({ displayName: "Still a supervisor" })
            .where(eq(persons.id, managerId));
      }),
    );
    let response: Response, order: string[];
    try {
      response = await request("commands", {
        commandId: randomUUID(),
        expectedRevision: await revision(),
        action: "approve",
        itemId,
        override: { personId: managerId, pin: "4321" },
      });
    } finally {
      order = await watchedOrder();
    }
    expect(order!).toEqual(
      kind === "suspended"
        ? ["writer", "derived", "derived under the request's lock"]
        : ["writer", "derived"],
    );
    expect(watchedDerivationCount()).toBe(kind === "suspended" ? 2 : 1);
    expect(response!.status).toBe(kind === "active" ? 200 : 403);
    if (kind !== "active") {
      expect(await response!.json()).toMatchObject({
        error: { code: kind === "demoted" ? "authorization.not_permitted" : "pin.invalid" },
      });
      expect(await snapshot()).toEqual(before);
    }
  },
);

it("takes turns on the shared override throttle and derives only the first four wrong attempts", async () => {
  const itemId = await pending(),
    before = await snapshot(),
    expectedRevision = await revision();
  watchDerivations("0000");
  let responses: Response[];
  try {
    responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request("commands", {
          commandId: randomUUID(),
          expectedRevision,
          action: "approve",
          itemId,
          override: { personId: managerId, pin: "0000" },
        }),
      ),
    );
  } finally {
    await watchedOrder();
  }
  expect(watchedDerivationCount()).toBe(4);
  expect(responses!.map((r) => r.status).sort()).toEqual([
    403, 403, 403, 403, 429, 429, 429, 429, 429, 429, 429, 429,
  ]);
  expect(throttle.wouldRefuse(`override:${venue.deviceId}`, managerId)).toBe(true);
  expect(await snapshot()).toEqual(before);
});

it("the real till mount shares the existing device override throttle with attendance decisions", async () => {
  const itemId = await pending();
  for (let i = 0; i < 4; i++) throttle.recordFailure(`override:${venue.deviceId}`, managerId);
  const app = new Hono(),
    clock = systemClock();
  mountTillApi(
    app,
    {
      db: suite.db,
      cfg: venue.cfg,
      clock: { ...clock, now: () => ({ ...clock.now(), instant }) },
      backend: makeFiscalBackend(
        ALL_MODULES.filter((m) => m.name === "fiscal-none"),
        "none",
        suite.db,
        {},
      ),
      secureCookies: false,
      venueLocale: "en-GB",
      workforceEnabled: true,
      pinThrottle: throttle,
    },
    () => {},
  );
  const before = await snapshot();
  const response = await app.request("/api/attendance/commands", {
    method: "POST",
    headers: { cookie: venue.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      commandId: randomUUID(),
      expectedRevision: await revision(),
      action: "approve",
      itemId,
      override: { personId: managerId, pin: "4321" },
    }),
  });
  expect(response.status).toBe(429);
  expect(await response.json()).toMatchObject({ error: { code: "pin.throttled" } });
  expect(await snapshot()).toEqual(before);
});

it("commits an overdue automatic finish before returning a stale human-command conflict", async () => {
  await withTransaction(suite.db, async (tx) => {
    await backend.clockIn(tx, {
      ...venue.cfg,
      personId: venue.personId,
      origin: deviceOrigin(venue.deviceId),
      at: "2026-01-06T09:00:00Z",
      offsetMinutes: 60,
    });
    await recordAttendanceFact(tx, {
      source: "order",
      key: "late-order",
      personId: venue.personId,
      locationId: venue.cfg.locationId,
      kind: "order",
      at: "2026-01-06T17:00:00Z",
      offsetMinutes: 60,
      outcome: "qualified",
    });
  });
  const body = await command();
  instant = new Date("2026-01-07T09:00:00Z");
  const response = await request("commands", body);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "attendance.state_changed" } });
  const rows = (await snapshot()).rows;
  expect(rows).toHaveLength(4);
  expect(rows.at(-1)).toMatchObject({
    entryKind: "out",
    authorKind: "automatic",
    eventAt: "2026-01-06T17:00:00.000Z",
  });
  expect(rows.filter((r) => r.entryKind === "correction")).toEqual([]);
  expect((await snapshot()).questions).toMatchObject([
    { kind: "automatic-out", resolvedByEntryId: null },
  ]);
});

it("hides foreign receipts and refuses another worker's question, item and target even for an admin operator", async () => {
  const [other] = await suite.db
    .insert(persons)
    .values({ displayName: "Other worker", role: "staff", pinHash: hashPin("5555") })
    .returning();
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      personId: other!.id,
      origin: deviceOrigin(venue.deviceId),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-05T17:00:00Z" });
  });
  const otherTarget = (await suite.db.select().from(timeEntries)).find(
    (e) => e.personId === other!.id && e.entryKind === "out",
  )!.id;
  const device = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Other",
    profileId: venue.profileId,
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { personId: other!.id, deviceId: device.deviceId, pin: "5555" }),
  );
  const cookie = `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  const foreign = {
    ...(await command()),
    expectedRevision: (await withTransaction(suite.db, (tx) => readAttendanceInbox(tx, other!.id)))
      .revision,
    changes: [{ target: { entryId: otherTarget }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 }],
  };
  const response = await request("commands", foreign, cookie);
  expect(response.status).toBe(200);
  const itemId = ((await response.json()) as AttendanceCommandResult).entryIds[0]!;
  const [question] = await suite.db
    .insert(attendanceQuestions)
    .values({
      personId: other!.id,
      locationId: venue.cfg.locationId,
      businessDay: "2026-01-04",
      startAt: "2026-01-04T04:00:00.000Z",
      endAt: "2026-01-05T04:00:00.000Z",
      shiftKey: "foreign",
      kind: "missing-times",
      missingKinds: ["in", "out"],
      evidenceKeys: ["order:foreign"],
      createdAt: instant.toISOString(),
    })
    .returning();
  await suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, venue.personId));
  const before = await snapshot();
  expect(await (await request(`commands/${foreign.commandId}`)).json()).toBeNull();
  const picker = await request(`items/${itemId}/approvers?action=approve`);
  expect(picker.status).toBe(404);
  expect(await picker.json()).toMatchObject({ error: { code: "correction.target_not_found" } });
  for (const [index, body] of [
    {
      ...(await command()),
      changes: [
        { target: { entryId: otherTarget }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 },
      ],
    },
    {
      ...(await command()),
      questionId: question!.id,
      changes: [{ target: { missingKind: "in" }, at: "2026-01-04T09:00:00Z", offsetMinutes: 60 }],
    },
    {
      commandId: randomUUID(),
      expectedRevision: await revision(),
      action: "approve",
      itemId,
      override: { personId: venue.personId, pin: "5555" },
    },
  ].entries()) {
    const denied = await request("commands", body);
    expect(denied.status).toBe([400, 403, 400][index]);
    expect(await denied.json()).toMatchObject({
      error: {
        code: ["correction.invalid", "correction.not_permitted", "correction.target_not_found"][
          index
        ],
      },
    });
    expect(await snapshot()).toEqual(before);
  }
});

it("racing approve and decline settle a complete missing pair once", async () => {
  const body = {
    ...(await command()),
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-04T09:00:00Z", offsetMinutes: 60 },
      { target: { missingKind: "out" }, at: "2026-01-04T17:00:00Z", offsetMinutes: 60 },
    ],
  };
  const submitted = await request("commands", body);
  expect(submitted.status).toBe(200);
  expect(((await submitted.json()) as AttendanceCommandResult).entryIds).toHaveLength(2);
  const expectedRevision = await revision();
  const responses = await Promise.all(
    ["approve", "decline"].map((action) =>
      request("commands", {
        commandId: randomUUID(),
        expectedRevision,
        action,
        itemId: body.commandId,
        override: { personId: managerId, pin: "4321" },
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await responses.find((r) => r.status === 409)!.json()).toMatchObject({
    error: { code: "attendance.state_changed" },
  });
  const rows = (await snapshot()).rows.filter((e) => e.entryKind === "correction");
  expect(rows).toHaveLength(4);
  expect(rows.slice(0, 2).map((e) => e.correctionStatus)).toEqual(["requested", "requested"]);
  expect(rows[2]!.correctionStatus).toBe(rows[3]!.correctionStatus);
  expect(["approved", "declined"]).toContain(rows[2]!.correctionStatus);
  expect((await snapshot()).commands).toHaveLength(2);
});

it("racing acceptance and disagreement retain a single terminal response", async () => {
  const itemId = await withTransaction(suite.db, (tx) =>
    backend.proposeCorrection(tx, {
      nodeId: venue.cfg.nodeId,
      actorPersonId: managerId,
      correctsEntryId: targetId,
      at: "2026-01-05T18:00:00Z",
      offsetMinutes: 60,
      reason: "Please confirm",
      origin: deviceOrigin(venue.deviceId),
    }),
  );
  const expectedRevision = await revision();
  const responses = await Promise.all(
    ["accept", "disagree"].map((action) =>
      request("commands", {
        commandId: randomUUID(),
        expectedRevision,
        action,
        itemId,
        ...(action === "disagree" ? { reason: "Finished at five" } : {}),
      }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await responses.find((r) => r.status === 409)!.json()).toMatchObject({
    error: { code: "attendance.state_changed" },
  });
  const rows = (await snapshot()).rows.filter((e) => e.entryKind === "correction");
  expect(rows).toHaveLength(2);
  expect(["approved", "disputed"]).toContain(rows[1]!.correctionStatus);
  expect(rows[1]!.recordedByPersonId).toBe(venue.personId);
  expect((await snapshot()).commands).toHaveLength(1);
});

it("lets the worker answer a reopened missing-time question without a reminder pass", async () => {
  const [question] = await suite.db
    .insert(attendanceQuestions)
    .values({
      personId: venue.personId,
      locationId: venue.cfg.locationId,
      businessDay: "2026-01-04",
      startAt: "2026-01-04T04:00:00.000Z",
      endAt: "2026-01-05T04:00:00.000Z",
      shiftKey: "missed-shift",
      kind: "missing-times",
      missingKinds: ["in", "out"],
      evidenceKeys: ["order:own"],
      createdAt: instant.toISOString(),
    })
    .returning();
  const original = {
    ...(await command()),
    questionId: question!.id,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-04T09:00:00Z", offsetMinutes: 60 },
      { target: { missingKind: "out" }, at: "2026-01-04T17:00:00Z", offsetMinutes: 60 },
    ],
  };
  const response = await request("commands", original);
  expect(response.status).toBe(200);
  const result = (await response.json()) as AttendanceCommandResult;
  await withTransaction(suite.db, async (tx) => {
    for (const correctionId of result.entryIds)
      await backend.declineCorrection(tx, {
        nodeId: venue.cfg.nodeId,
        actorPersonId: managerId,
        correctionId,
        origin: deviceOrigin(venue.deviceId),
      });
  });
  const refreshed = await request("inbox");
  expect(refreshed.status).toBe(200);
  const inbox = (await refreshed.json()) as AttendanceInbox;
  expect(inbox.prompts).toMatchObject([{ questionId: question!.id, missingKinds: ["in", "out"] }]);
  expect(
    (await snapshot()).questions.find((q) => q.id === question!.id)!.resolvedByEntryId,
  ).toBeNull();
  const resubmitted = await request("commands", {
    ...original,
    commandId: randomUUID(),
    expectedRevision: inbox.revision,
  });
  expect(resubmitted.status).toBe(200);
  expect(((await resubmitted.json()) as AttendanceCommandResult).entryIds).toHaveLength(2);
});

it("an old bundle whose members were answered separately refuses a fresh group decision as nonpending", async () => {
  const body = {
    ...(await command()),
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-04T09:00:00Z", offsetMinutes: 60 },
      { target: { missingKind: "out" }, at: "2026-01-04T17:00:00Z", offsetMinutes: 60 },
    ],
  };
  const response = await request("commands", body);
  expect(response.status).toBe(200);
  const result = (await response.json()) as AttendanceCommandResult;
  await withTransaction(suite.db, (tx) =>
    backend.declineCorrection(tx, {
      nodeId: venue.cfg.nodeId,
      actorPersonId: managerId,
      correctionId: result.entryIds[0]!,
      origin: deviceOrigin(venue.deviceId),
    }),
  );
  const before = await snapshot();
  const decision = await request("commands", {
    commandId: randomUUID(),
    expectedRevision: await revision(),
    action: "decline",
    itemId: body.commandId,
    override: { personId: managerId, pin: "4321" },
  });
  expect(decision.status).toBe(409);
  expect(await decision.json()).toMatchObject({ error: { code: "correction.not_pending" } });
  expect(await snapshot()).toEqual(before);
  const replay = await request("commands", body);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ ...result, replayed: true });
  expect(await snapshot()).toEqual(before);
});

it.each(["{", "null", "[]"])(
  "refuses malformed command JSON %j without human appends",
  async (body) => {
    const before = await snapshot();
    const response = await venue.app.request("/api/attendance/commands", {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
    expect(await snapshot()).toEqual(before);
  },
);
