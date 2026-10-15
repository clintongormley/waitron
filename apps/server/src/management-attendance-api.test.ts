import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  hashSessionToken,
  managementSessions,
  persons,
  registerModulePermissions,
  startManagementSession,
  withPassiveManagementRead,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  executeAttendanceCommand,
  readAttendanceInbox,
  timeEntries,
  WorkforceBackend,
} from "@waitron/workforce";
import { jobOrigin } from "@waitron/shared";
import type {
  AttendanceCommandResult,
  AttendanceInbox,
} from "@waitron/workforce/attendance-contract";
import { ALL_MODULES } from "./modules.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import { mountManagementAttendanceApi } from "./management-attendance-api.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let app: Hono;
let venue: ClockVenue;
let managerId: string;
let managerCookie: string;
let staffCookie: string;
let managementId: string;
let targetId: string;
beforeEach(async () => {
  venue = await createClockVenue(suite.db, () => new Date("2026-01-06T09:00:00Z"));
  registerModulePermissions(ALL_MODULES.flatMap((m) => m.permissions ?? []));
  const backend = new WorkforceBackend();
  await withTransaction(suite.db, async (tx) => {
    const [manager] = await tx.select().from(persons).where(eq(persons.role, "admin"));
    managerId = manager!.id;
    const session = await startManagementSession(tx, { personId: managerId });
    managementId = (
      await tx
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.tokenHash, hashSessionToken(session.token)))
    )[0]!.id;
    managerCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: venue.personId })).token}`;
    const common = {
      ...venue.cfg,
      personId: venue.personId,
      origin: jobOrigin("dashboard"),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-05T17:00:00Z" });
  });
  targetId = (await suite.db.select().from(timeEntries)).find((e) => e.entryKind === "out")!.id;
  app = new Hono();
  app.use("/management-api/*", (c, next) =>
    c.req.method === "GET" && c.req.header("x-waitron-live") === "1"
      ? withPassiveManagementRead(next)
      : next(),
  );
  mountManagementAttendanceApi(
    app,
    { db: suite.db, cfg: venue.cfg, now: () => new Date("2026-01-06T09:00:00Z") },
    () => {},
  );
});
function request(path: string, body?: unknown, cookie = managerCookie, passive = false) {
  return app.request(`/management-api/attendance/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      ...(passive ? { "x-waitron-live": "1" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function inbox(): Promise<AttendanceInbox> {
  return withTransaction(suite.db, (tx) => readAttendanceInbox(tx, venue.personId));
}
async function proposal() {
  return {
    commandId: randomUUID(),
    expectedRevision: (await inbox()).revision,
    action: "propose",
    personId: venue.personId,
    locationId: venue.cfg.locationId,
    changes: [{ target: { entryId: targetId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 }],
    reason: "Check the finish",
  };
}
const paths = ["lookups", "queue", "day", "commands/id", "commands"];
function route(path: string) {
  if (path === "queue") return `queue?locationId=${venue.cfg.locationId}`;
  if (path === "day")
    return `day?locationId=${venue.cfg.locationId}&personId=${venue.personId}&date=2026-01-05`;
  return path.replace("/id", `/${randomUUID()}`);
}
it.each(paths)("requires management permission for %s", async (path) => {
  for (const cookie of ["", staffCookie]) {
    const response = await request(
      route(path),
      path === "commands" ? await proposal() : undefined,
      cookie,
    );
    expect(response.status).toBe(cookie ? 403 : 401);
    expect(await response.json()).toMatchObject({
      error: { code: cookie ? "authorization.not_permitted" : "management_session.required" },
    });
  }
});
it("provides minimal lookups, own viewer eligibility, an empty queue and a day from the same subject revision", async () => {
  const lookups = await request("lookups");
  expect(lookups.status).toBe(200);
  expect(await lookups.json()).toEqual({
    viewer: { personId: managerId, canSelfApprove: true },
    locations: [{ id: venue.cfg.locationId, name: "Clock venue", timeZone: "Europe/Madrid" }],
    people: expect.arrayContaining([
      { personId: managerId, displayName: "Owner" },
      { personId: venue.personId, displayName: "Ana" },
    ]),
  });
  await suite.db.update(persons).set({ role: "supervisor" }).where(eq(persons.id, managerId));
  expect(await (await request("lookups")).json()).toMatchObject({
    viewer: { personId: managerId, canSelfApprove: false },
  });
  expect(await (await request(route("queue"))).json()).toEqual({
    locationId: venue.cfg.locationId,
    items: [],
  });
  expect(await (await request(route("day"))).json()).toMatchObject({
    personId: venue.personId,
    locationId: venue.cfg.locationId,
    date: "2026-01-05",
    revision: (await inbox()).revision,
  });
});
it("proposes with the authenticated manager, then the worker accepts with original history and replay retained", async () => {
  const body = await proposal();
  const response = await request("commands", body);
  expect(response.status).toBe(200);
  const result = (await response.json()) as AttendanceCommandResult;
  expect(result).toEqual({
    commandId: body.commandId,
    entryIds: [expect.any(String)],
    replayed: false,
  });
  const before = await suite.db.select().from(timeEntries);
  expect(before.find((e) => e.id === result.entryIds[0])).toMatchObject({
    recordedByPersonId: managerId,
    personId: venue.personId,
    capturedBySource: "dashboard",
    capturedByDeviceId: null,
  });
  expect(await (await request("commands", body)).json()).toEqual({ ...result, replayed: true });
  expect(await suite.db.select().from(timeEntries)).toEqual(before);
  expect(await (await request(`commands/${body.commandId}`)).json()).toEqual({
    ...result,
    replayed: true,
  });
  const worker = await inbox();
  expect(worker.prompts).toMatchObject([{ kind: "proposal", personId: venue.personId }]);
  await withTransaction(suite.db, (tx) =>
    executeAttendanceCommand(tx, {
      nodeId: venue.cfg.nodeId,
      requestedByPersonId: venue.personId,
      authorizedByPersonId: venue.personId,
      origin: jobOrigin("dashboard"),
      now: new Date("2026-01-06T10:00:00Z"),
      command: {
        commandId: randomUUID(),
        expectedRevision: worker.revision,
        action: "accept",
        itemId: result.entryIds[0]!,
      },
    }),
  );
  expect((await inbox()).items).toMatchObject([
    {
      status: "approved",
      history: expect.arrayContaining([
        expect.objectContaining({ entryId: targetId }),
        expect.objectContaining({ entryId: result.entryIds[0] }),
      ]),
    },
  ]);
  expect(await (await request(route("queue"))).json()).toEqual({
    locationId: venue.cfg.locationId,
    items: [],
  });
});
it("keeps passive reads from extending a management session, but explicit reads do", async () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  await suite.db
    .update(managementSessions)
    .set({ lastSeenAt: old })
    .where(eq(managementSessions.id, managementId));
  expect((await request("lookups", undefined, managerCookie, true)).status).toBe(200);
  expect(
    (
      await suite.db
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.id, managementId))
    )[0]!.lastSeenAt,
  ).toBe(old);
  expect((await request("lookups")).status).toBe(200);
  expect(
    (
      await suite.db
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.id, managementId))
    )[0]!.lastSeenAt,
  ).not.toBe(old);
});
it("rejects forged actors, extra scope, worker actions, malformed JSON and suspended managers", async () => {
  const before = await suite.db.select().from(timeEntries);
  for (const extra of [
    { authorizedByPersonId: managerId },
    { override: { personId: managerId, pin: "1234" } },
    { now: "2026-01-06T09:00:00Z" },
    { nodeId: randomUUID() },
  ]) {
    const response = await request("commands", { ...(await proposal()), ...extra });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
  for (const path of [
    "lookups?personId=x",
    `${route("queue")}&locationId=${venue.cfg.locationId}`,
    `${route("day")}&date=2026-01-06`,
    "commands/not-an-id",
  ]) {
    const response = await request(path);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
  const malformed = await app.request("/management-api/attendance/commands", {
    method: "POST",
    headers: { cookie: managerCookie, "content-type": "application/json" },
    body: "{",
  });
  expect(malformed.status).toBe(400);
  await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, managerId));
  for (const path of paths) {
    const response = await request(route(path), path === "commands" ? await proposal() : undefined);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "person.suspended" } });
  }
  expect(await suite.db.select().from(timeEntries)).toEqual(before);
});

it.each(["ended", "expired"] as const)(
  "refuses an %s management session on every attendance route",
  async (kind) => {
    const body = await proposal();
    await suite.db
      .update(managementSessions)
      .set(
        kind === "ended"
          ? { endedAt: new Date().toISOString() }
          : { lastSeenAt: "2020-01-01T00:00:00Z" },
      )
      .where(eq(managementSessions.id, managementId));
    const before = await suite.db.select().from(timeEntries);
    for (const path of paths) {
      const response = await request(route(path), path === "commands" ? body : undefined);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: {
          code: kind === "ended" ? "management_session.required" : "management_session.expired",
        },
      });
    }
    expect(await suite.db.select().from(timeEntries)).toEqual(before);
  },
);

it("refuses a manager demoted after authentication but before the command write", async () => {
  let reached!: () => void, release!: () => void;
  const read = new Promise<void>((done) => {
    reached = done;
  });
  const proceed = new Promise<void>((done) => {
    release = done;
  });
  const raw = new Request("http://test/management-api/attendance/commands", {
    method: "POST",
    headers: { cookie: managerCookie, "content-type": "application/json" },
    body: JSON.stringify(await proposal()),
  });
  const text = raw.text.bind(raw);
  raw.text = async () => {
    reached();
    await proceed;
    return text();
  };
  const before = await suite.db.select().from(timeEntries);
  const asked = app.request(raw);
  await read;
  try {
    await suite.db.update(persons).set({ role: "staff" }).where(eq(persons.id, managerId));
  } finally {
    release();
  }
  const response = await asked;
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(await suite.db.select().from(timeEntries)).toEqual(before);
});

it("a different permitted manager cannot recover another requester's command receipt", async () => {
  const body = await proposal();
  expect((await request("commands", body)).status).toBe(200);
  await suite.db.update(persons).set({ role: "supervisor" }).where(eq(persons.id, venue.personId));
  const response = await request(`commands/${body.commandId}`, undefined, staffCookie);
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
});
