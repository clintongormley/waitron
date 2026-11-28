import { seedAttendanceDay } from "@waitron/workforce/test/fixtures.js";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { convenioConfig, WORKFORCE_ES_RECORD_EXPORT } from "@waitron/workforce-es";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { deviceProfiles, devices, withTransaction, withFoldedPersonChanges } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  deviceProfileAdmissionRoles,
  persons,
  loginWithPin,
  registerModulePermissions,
  tillSessions,
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
import { recordAttendanceFact } from "./attendance-capture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { SESSION_COOKIE } from "./till-session.js";
import { DEVICE_COOKIE } from "./device-session.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const backend = new WorkforceBackend();
let venue: ClockVenue;
let instant: Date;
let targetId: string;
let managerId: string;
beforeEach(async () => {
  instant = new Date("2026-01-06T09:00:00Z");
  venue = await createClockVenue(suite.db, () => instant);
  registerModulePermissions(ALL_MODULES.flatMap((m) => m.permissions ?? []));
  mountTillAttendanceApi(
    venue.app,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => instant,
    },
    () => {},
  );
  const [manager] = await seedPersons(suite.db, {
    displayName: "Supervisor",
    role: "supervisor",
    pinHash: fixturePinHash("4321"),
  });
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
    changes: [{ target: { entryId: targetId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 }],
    reason: "Stayed later",
  };
}
async function snapshot() {
  return {
    rows: await suite.db.select().from(timeEntries),
    questions: await suite.db.select().from(attendanceQuestions),
    commands: suite.db.all(sql`select * from attendance_answers order by id`),
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
  ["day?date=2026-01-05", undefined],
  ["commands/ID", undefined],
  ["commands", { commandId: "invalid" }],
] as const;
function pathOf(path: string) {
  return path.replace("ID", randomUUID());
}

const managerRoutes = [
  ["manager/lookups", undefined],
  ["manager/queue", undefined],
  ["manager/day?personId=ID&date=2026-01-05", undefined],
  ["manager/commands", {}],
  ["manager/approve-days", { days: [] }],
] as const;

it.each(managerRoutes)(
  "requires a clock-in device and manager permission on %s",
  async (path, body) => {
    const url = pathOf(path);
    const unsigned = await request(url, body, "");
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toMatchObject({ error: { code: "session.required" } });
    const worker = await request(url, body);
    expect(worker.status).toBe(403);
    expect(await worker.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });

    await setBuiltInRoleForTest(suite.db, venue.personId, "admin");
    await suite.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, venue.profileId));
    const barredDevice = await request(url, body);
    expect(barredDevice.status).toBe(403);
    expect(await barredDevice.json()).toMatchObject({
      error: { code: "device.forbidden_action", params: { action: "clock-in" } },
    });
  },
);

async function managerCookie() {
  const device = await enrolDeviceForTest(suite.db, venue.cfg, {
    name: "Manager's clock till",
    profileId: venue.profileId,
  });
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { personId: managerId, deviceId: device.deviceId, pin: "4321" }),
  );
  return {
    deviceId: device.deviceId,
    sessionId: session.id,
    cookie: `${SESSION_COOKIE}=${session.token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
  };
}

it.each([
  ["ended", 401, "session.required"],
  ["admission", 403, "attendance.not_permitted"],
  ["suspended", 403, "attendance.not_permitted"],
] as const)(
  "refuses all manager routes if the manager's access changes: %s",
  async (change, status, code) => {
    const { cookie, sessionId } = await managerCookie();
    if (change === "ended") {
      await suite.db
        .update(tillSessions)
        .set({ endedAt: instant.toISOString() })
        .where(eq(tillSessions.id, sessionId));
    } else if (change === "admission") {
      await suite.db
        .delete(deviceProfileAdmissionRoles)
        .where(eq(deviceProfileAdmissionRoles.deviceProfileId, venue.profileId));
    } else {
      await suite.db
        .update(persons)
        .set(withFoldedPersonChanges({ status: "suspended" }))
        .where(eq(persons.id, managerId));
    }

    for (const [path, body] of managerRoutes) {
      const response = await request(pathOf(path), body, cookie);
      expect(response.status, path).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
  },
);

it("reads and approves another person's finished day from a manager's clock-only till", async () => {
  const { cookie, deviceId } = await managerCookie();
  const oldSighting = "2020-01-01T00:00:00.000Z";
  await suite.db.update(devices).set({ lastSeenAt: oldSighting }).where(eq(devices.id, deviceId));

  const read = async (path: string) => {
    const response = await request(path, undefined, cookie);
    expect(response.status, path).toBe(200);
    return response.json();
  };
  const lookups = await read("manager/lookups");
  expect(lookups.viewer).toEqual({ personId: managerId, canSelfApprove: false });
  expect(lookups.people).toContainEqual({ personId: venue.personId, displayName: "Anna" });
  const day = await read(`manager/day?personId=${venue.personId}&date=2026-01-05`);
  expect(day).toMatchObject({
    personId: venue.personId,
    date: "2026-01-05",
    approval: { status: "pending", digest: expect.stringMatching(/^[A-F0-9]{64}$/) },
  });
  const days = [{ personId: venue.personId, date: "2026-01-05", digest: day.approval.digest }];
  expect(await read("manager/queue")).toMatchObject({ items: [], finishedDays: days });
  const [managerDevice] = await suite.db.select().from(devices).where(eq(devices.id, deviceId));
  expect(managerDevice?.lastSeenAt).toBe(oldSighting);

  const before = await snapshot();
  const stale = await request(
    "manager/approve-days",
    { days: [{ ...days[0], digest: "0".repeat(64) }] },
    cookie,
  );
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "attendance.state_changed" } });
  expect(await snapshot()).toEqual(before);

  expect((await request("manager/approve-days", { days }, cookie)).status).toBe(204);
  expect(await read("manager/queue")).toEqual({ items: [], finishedDays: [] });
  expect(
    (await snapshot()).rows.filter((entry) => entry.entryKind === "day_approval"),
  ).toMatchObject([{ personId: venue.personId, recordedByPersonId: managerId }]);
});

it("settles a worker's request as the signed-in manager and scopes receipt recovery to that manager", async () => {
  const itemId = await pending();
  const { cookie } = await managerCookie();
  const commandId = randomUUID();
  const response = await request(
    "manager/commands",
    { action: "approve", commandId, itemId, expectedRevision: await revision() },
    cookie,
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ commandId, replayed: false });
  const receipt = await request(`commands/${commandId}`, undefined, cookie);
  expect(await receipt.json()).toEqual({ ...result, replayed: true });
  expect(await (await request(`commands/${commandId}`)).json()).toBeNull();
  const inbox = (await (await request("inbox")).json()) as AttendanceInbox;
  expect(inbox.items).toMatchObject([{ id: itemId, status: "approved" }]);
  expect(inbox.items[0]?.history).toContainEqual(
    expect.objectContaining({ entryId: result.entryIds[0], recordedByPersonId: managerId }),
  );
});

it("keeps a request pending when a manager's PIN is entered on the worker's session", async () => {
  const itemId = await pending();
  await setBuiltInRoleForTest(suite.db, venue.personId, "admin");
  const before = await snapshot();
  for (const action of ["approve", "decline"] as const) {
    const response = await request("commands", {
      action,
      commandId: randomUUID(),
      itemId,
      expectedRevision: await revision(),
      override: { personId: managerId, pin: "4321" },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
  const bareApproval = await request("commands", {
    action: "approve",
    commandId: randomUUID(),
    itemId,
    expectedRevision: await revision(),
  });
  expect(bareApproval.status).toBe(400);
  expect(await bareApproval.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "action" } },
  });
  expect((await request(`items/${itemId}/approvers?action=approve`)).status).toBe(404);
  expect(await snapshot()).toEqual(before);
});

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
  const day = await request("day?date=2026-01-05");
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

it("offers a first correction before any clock history", async () => {
  const [worker] = await seedPersons(suite.db, {
    displayName: "New worker",
    role: "staff",
    pinHash: fixturePinHash("5678"),
  });
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
  expect(inbox.timeZone).toBe("Europe/Madrid");
  const day = await request("day?date=2026-01-04", undefined, cookie);
  expect(day.status).toBe(200);
  expect(await day.json()).toMatchObject({ personId: worker!.id, record: { entries: [] } });
  const submitted = await request(
    "commands",
    {
      commandId: randomUUID(),
      expectedRevision: inbox.revision,
      action: "request",
      questionId: null,
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
  expect(refreshed.timeZone).toBe("Europe/Madrid");
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
it.each(["ended", "disabled", "deleted", "admission", "suspended"] as const)(
  "rechecks %s admission on every attendance route",
  async (kind) => {
    const valid = await command();
    if (kind === "ended")
      await suite.db
        .update(tillSessions)
        .set({ endedAt: instant.toISOString() })
        .where(eq(tillSessions.id, venue.sessionId));
    if (kind === "disabled")
      await suite.db.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
    if (kind === "deleted")
      await suite.db
        .update(devices)
        .set({ active: false, deletedAt: instant.toISOString() })
        .where(eq(devices.id, venue.deviceId));
    if (kind === "admission")
      await suite.db
        .delete(deviceProfileAdmissionRoles)
        .where(eq(deviceProfileAdmissionRoles.deviceProfileId, venue.profileId));
    if (kind === "suspended")
      await suite.db
        .update(persons)
        .set(withFoldedPersonChanges({ status: "suspended" }))
        .where(eq(persons.id, venue.personId));
    const before = await snapshot();
    for (const [path, body] of routes) {
      const response = await request(pathOf(path), body === undefined ? undefined : valid);
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

it("rejects malformed queries, ids and forged attribution without appending", async () => {
  const before = await snapshot();
  for (const path of [
    "inbox?personId=foreign",
    "commands/not-an-id",
    `commands/${randomUUID()}?personId=foreign`,
    "day?date=2026-02-30",
    `day?date=2026-01-05&personId=${managerId}`,
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
it.each(["permission", "session"] as const)(
  "rechecks a manager's %s after the command body arrives",
  async (change) => {
    const { cookie, sessionId } = await managerCookie();
    const date = "2026-01-05";
    const path = change === "permission" ? "commands" : "approve-days";
    let body: unknown;
    if (change === "permission") {
      body = {
        action: "approve",
        commandId: randomUUID(),
        itemId: await pending(),
        expectedRevision: await revision(),
      };
    } else {
      const personId = venue.personId;
      const day = await request(`manager/day?personId=${personId}&date=${date}`, undefined, cookie);
      expect(day.status).toBe(200);
      const { approval } = await day.json();
      body = { days: [{ personId, date, digest: approval.digest }] };
    }

    const readingBody = gate();
    const resumeBody = gate();
    const raw = new Request(`http://test/api/attendance/manager/${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = raw.text.bind(raw);
    raw.text = async () => {
      readingBody.resolve();
      await resumeBody.promise;
      return text();
    };

    const before = await snapshot();
    const asked = venue.app.request(raw);
    try {
      await readingBody.promise;
      if (change === "permission") await setBuiltInRoleForTest(suite.db, managerId, "staff");
      else {
        await suite.db
          .update(tillSessions)
          .set({ endedAt: instant.toISOString() })
          .where(eq(tillSessions.id, sessionId));
      }
    } finally {
      resumeBody.resolve();
    }
    const response = await asked;
    expect(response.status).toBe(change === "permission" ? 403 : 401);
    expect(await response.json()).toMatchObject({
      error: { code: change === "permission" ? "authorization.not_permitted" : "session.required" },
    });
    expect(await snapshot()).toEqual(before);
  },
);
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
          .update(tillSessions)
          .set({ endedAt: instant.toISOString() })
          .where(eq(tillSessions.id, venue.sessionId));
      if (kind === "admission")
        await tx
          .delete(deviceProfileAdmissionRoles)
          .where(eq(deviceProfileAdmissionRoles.deviceProfileId, venue.profileId));
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
      .set(withFoldedPersonChanges({ displayName: "Updated supervisor" }))
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
  const [other] = await seedPersons(suite.db, {
    displayName: "Other worker",
    role: "staff",
    pinHash: fixturePinHash("5555"),
  });
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
      attendanceDayId: await seedAttendanceDay(suite.db, {
        businessDay: "2026-01-04",
        startAt: "2026-01-04T04:00:00.000Z",
        endAt: "2026-01-05T04:00:00.000Z",
      }),
      shiftKey: "foreign",
      kind: "missing-times",
      missingKinds: ["in", "out"],
      evidenceKeys: ["order:foreign"],
      createdAt: instant.toISOString(),
    })
    .returning();
  await setBuiltInRoleForTest(suite.db, venue.personId, "admin");
  const before = await snapshot();
  expect(await (await request(`commands/${foreign.commandId}`)).json()).toBeNull();
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
      action: "accept",
      itemId,
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
  const { cookie } = await managerCookie();
  const responses = await Promise.all(
    ["approve", "decline"].map((action) =>
      request(
        "manager/commands",
        {
          commandId: randomUUID(),
          expectedRevision,
          action,
          itemId: body.commandId,
        },
        cookie,
      ),
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
      attendanceDayId: await seedAttendanceDay(suite.db, {
        businessDay: "2026-01-04",
        startAt: "2026-01-04T04:00:00.000Z",
        endAt: "2026-01-05T04:00:00.000Z",
      }),
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
  const { cookie } = await managerCookie();
  const decision = await request(
    "manager/commands",
    {
      commandId: randomUUID(),
      expectedRevision: await revision(),
      action: "decline",
      itemId: body.commandId,
    },
    cookie,
  );
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

it("delivers paid totals through every attendance read route", async () => {
  await suite.db.insert(convenioConfig).values({
    breakThresholdMinutes: 300,
    splitMinSegmentMinutes: 180,
    splitMaxSegmentMinutes: 300,
    splitMinGapMinutes: 90,
    continuousPaidBreakMinutes: 20,
  });
  const backend = new WorkforceBackend();
  for (const [kind, at] of [
    ["clockIn", "09:00"],
    ["breakStart", "12:00"],
    ["breakEnd", "12:20"],
    ["clockOut", "15:40"],
  ] as const)
    await withTransaction(suite.db, (tx) =>
      backend[kind](tx, {
        nodeId: venue.cfg.nodeId,
        personId: venue.personId,
        at: `2026-01-06T${at}:00Z`,
        offsetMinutes: 0,
        origin: deviceOrigin(venue.deviceId),
      }),
    );
  const paid = new Hono();
  mountTillAttendanceApi(
    paid,
    {
      db: suite.db,
      cfg: venue.cfg,
      now: () => new Date("2026-01-07T09:00:00Z"),
      exporter: WORKFORCE_ES_RECORD_EXPORT,
    },
    () => {},
  );
  for (const path of ["day?date=2026-01-06", "hours?kind=month&date=2026-01-06"]) {
    const response = await paid.request(`/api/attendance/${path}`, {
      headers: { cookie: venue.cookie },
    });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(
      value.record.sessions.find((row: { workDate: string }) => row.workDate === "2026-01-06"),
    ).toMatchObject({ workedMinutes: 400, breakMinutes: 20 });
  }
});
