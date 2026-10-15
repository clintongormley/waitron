import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { locations, withTransaction } from "@waitron/db";
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
  WorkforceBackend,
  readAttendanceInbox,
  timeEntries,
  upsertAttendanceQuestion,
} from "@waitron/workforce";
import { jobOrigin } from "@waitron/shared";
import type {
  AttendanceCommandResult,
  PersonHours,
  ManagerHours,
} from "@waitron/workforce/attendance-contract";
import { ALL_MODULES } from "./modules.js";
import { createClockVenue, type ClockVenue } from "./testing/clock-venue.js";
import { mountManagementAttendanceApi } from "./management-attendance-api.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const backend = new WorkforceBackend();
const now = new Date("2026-10-31T23:30:00Z");
let app: Hono,
  venue: ClockVenue,
  owner: string,
  staffCookie: string,
  ownerCookie: string,
  staffSession: string,
  target: string;
beforeEach(async () => {
  venue = await createClockVenue(suite.db, () => now);
  registerModulePermissions(ALL_MODULES.flatMap((m) => m.permissions ?? []));
  const [admin] = await suite.db.select().from(persons).where(eq(persons.role, "admin"));
  owner = admin!.id;
  await withTransaction(suite.db, async (tx) => {
    const staff = await startManagementSession(tx, { personId: venue.personId });
    staffCookie = `${MANAGEMENT_COOKIE}=${staff.token}`;
    staffSession = (
      await tx
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.tokenHash, hashSessionToken(staff.token)))
    )[0]!.id;
    ownerCookie = `${MANAGEMENT_COOKIE}=${(await startManagementSession(tx, { personId: owner })).token}`;
    const common = {
      ...venue.cfg,
      personId: venue.personId,
      origin: jobOrigin("dashboard"),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-05T17:00:00Z" });
  });
  target = (await suite.db.select().from(timeEntries)).find((e) => e.entryKind === "out")!.id;
  app = new Hono();
  app.use("/management-api/*", (c, next) =>
    c.req.method === "GET" && c.req.header("x-waitron-live") === "1"
      ? withPassiveManagementRead(next)
      : next(),
  );
  mountManagementAttendanceApi(app, { db: suite.db, cfg: venue.cfg, now: () => now }, () => {});
});
const own = "/management-api/me/attendance/";
function path(kind = "month") {
  return `hours?locationId=${venue.cfg.locationId}&kind=${kind}&date=2026-01-05`;
}
function ask(route: string, body?: unknown, cookie = staffCookie, passive = false) {
  return app.request(route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      ...(passive ? { "x-waitron-live": "1" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function revision(personId = venue.personId) {
  return (await withTransaction(suite.db, (tx) => readAttendanceInbox(tx, personId))).revision;
}
async function command() {
  return {
    commandId: crypto.randomUUID(),
    expectedRevision: await revision(),
    action: "request",
    questionId: null,
    locationId: venue.cfg.locationId,
    changes: [{ target: { entryId: target }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 }],
    reason: "Stayed later",
  };
}
function snapshot() {
  return {
    entries: suite.db.all(sql`select * from time_entries order by id`),
    heads: suite.db.all(sql`select * from workforce_chains order by node_id, location_id`),
    questions: suite.db.all(sql`select * from attendance_questions order by id`),
    mail: suite.db.all(sql`select * from attendance_mail order by id`),
  };
}
function routes() {
  return [
    own + "inbox",
    own + path(),
    own + `day?locationId=${venue.cfg.locationId}&date=2026-01-05`,
    own + `commands/${crypto.randomUUID()}`,
    own + "commands",
    "/management-api/attendance/" + path("pay-period"),
  ];
}
it("ordinary staff read only their own record and configured workplace without the manager permission", async () => {
  const response = await ask(own + path());
  expect(response.status).toBe(200);
  const value = (await response.json()) as PersonHours;
  expect(value.workedMinutes).toBe(480);
  expect(value.personId).toBe(venue.personId);
  expect(value.record.entries.map((e) => e.entry.personId)).toEqual([
    venue.personId,
    venue.personId,
  ]);
  const inbox = await ask(own + "inbox");
  expect(inbox.status).toBe(200);
  expect(await inbox.json()).toMatchObject({
    personId: venue.personId,
    locations: [{ id: venue.cfg.locationId, name: "Clock venue", timeZone: "Europe/Madrid" }],
  });
  const day = await ask(own + `day?locationId=${venue.cfg.locationId}&date=2026-01-05`);
  expect(day.status).toBe(200);
  expect(await day.json()).toMatchObject({ personId: venue.personId, revision: await revision() });
  await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, venue.personId));
  expect((await ask(own + path())).status).toBe(200);
});
it("manager hours refuses staff and permits a supervisor with minimal people data", async () => {
  const route = "/management-api/attendance/" + path("pay-period");
  let response = await ask(route);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  await suite.db.update(persons).set({ role: "supervisor" }).where(eq(persons.id, venue.personId));
  response = await ask(route);
  expect(response.status).toBe(200);
  const value = (await response.json()) as ManagerHours;
  expect(value.period).toEqual({ start: "2026-01-01", end: "2026-02-01" });
  expect(value.people.find((p) => p.personId === venue.personId)!.hours.workedMinutes).toBe(480);
  expect(
    value.people.every((p) => Object.keys(p).sort().join() === "displayName,hours,personId"),
  ).toBe(true);
});
it.each(["absent", "ended", "expired", "suspended"] as const)(
  "every new route refuses an %s management session",
  async (kind) => {
    const body = await command();
    if (kind === "ended")
      await suite.db
        .update(managementSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(managementSessions.id, staffSession));
    if (kind === "expired")
      await suite.db
        .update(managementSessions)
        .set({ lastSeenAt: "2020-01-01T00:00:00Z" })
        .where(eq(managementSessions.id, staffSession));
    if (kind === "suspended")
      await suite.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, venue.personId));
    const before = snapshot();
    for (const route of routes()) {
      const response = await ask(
        route,
        route === own + "commands" ? body : undefined,
        kind === "absent" ? "" : staffCookie,
      );
      expect(response.status, route).toBe(kind === "suspended" ? 403 : 401);
      expect(await response.json()).toMatchObject({
        error: {
          code:
            kind === "suspended"
              ? "person.suspended"
              : kind === "expired"
                ? "management_session.expired"
                : "management_session.required",
        },
      });
    }
    expect(snapshot()).toEqual(before);
  },
);
it("automatic own and manager reads are passive while an explicit read extends the dashboard session", async () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  await suite.db
    .update(managementSessions)
    .set({ lastSeenAt: old })
    .where(eq(managementSessions.id, staffSession));
  const before = snapshot();
  for (const route of routes().slice(0, 4))
    expect((await ask(route, undefined, staffCookie, true)).status).toBe(200);
  expect(
    (
      await suite.db
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.id, staffSession))
    )[0]!.lastSeenAt,
  ).toBe(old);
  expect(snapshot()).toEqual(before);
  expect((await ask(own + path())).status).toBe(200);
  expect(
    (
      await suite.db
        .select()
        .from(managementSessions)
        .where(eq(managementSessions.id, staffSession))
    )[0]!.lastSeenAt,
  ).not.toBe(old);
});
it("an own request remains pending until approval and supports requester-only replay recovery", async () => {
  const body = await command();
  let response = await ask(own + "commands", body);
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
    capturedBySource: "dashboard",
    capturedByDeviceId: null,
    correctionStatus: "requested",
  });
  expect(((await (await ask(own + path())).json()) as PersonHours).workedMinutes).toBe(480);
  response = await ask(own + "commands", body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...result, replayed: true });
  expect(await (await ask(own + `commands/${body.commandId}`)).json()).toEqual({
    ...result,
    replayed: true,
  });
  expect(
    await (await ask(own + `commands/${body.commandId}`, undefined, ownerCookie)).json(),
  ).toBeNull();
  expect(await (await ask(own + `commands/${crypto.randomUUID()}`)).json()).toBeNull();
  expect(await suite.db.select().from(timeEntries)).toEqual(rows);
  response = await ask(
    "/management-api/attendance/commands",
    {
      commandId: crypto.randomUUID(),
      expectedRevision: await revision(),
      action: "approve",
      itemId: result.entryIds[0],
    },
    ownerCookie,
  );
  expect(response.status).toBe(200);
  expect(((await (await ask(own + path())).json()) as PersonHours).workedMinutes).toBe(540);
});
it.each(["accept", "disagree"] as const)(
  "workers can %s a manager proposal without impersonating its author",
  async (action) => {
    let response = await ask(
      "/management-api/attendance/commands",
      { ...(await command()), action: "propose", personId: venue.personId, questionId: undefined },
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const proposed = (await response.json()) as AttendanceCommandResult;
    response = await ask(own + "commands", {
      commandId: crypto.randomUUID(),
      expectedRevision: await revision(),
      action,
      itemId: proposed.entryIds[0],
      ...(action === "disagree" ? { reason: "I left at five" } : {}),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as AttendanceCommandResult;
    const value = (await (await ask(own + path())).json()) as PersonHours;
    expect(value.workedMinutes).toBe(action === "accept" ? 540 : 480);
    expect(
      value.record.entries.find((e) => e.entry.entryId === result.entryIds[0])!.entry
        .recordedByPersonId,
    ).toBe(venue.personId);
    expect(value.pending.items.map((i) => i.status)).toEqual(
      action === "accept" ? [] : ["disputed"],
    );
  },
);
it("own automatic acknowledgement preserves counted hours and appends worker attribution", async () => {
  let openId = "",
    endId = "",
    questionId = "";
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      personId: venue.personId,
      origin: jobOrigin("dashboard"),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-06T09:00:00Z" });
    openId = (await tx.select().from(timeEntries)).find(
      (e) => e.entryKind === "in" && e.eventAt === "2026-01-06T09:00:00.000Z",
    )!.id;
    endId = await backend.recordAutomaticClose(tx, {
      ...common,
      at: "2026-01-06T17:00:00Z",
      openEntryId: openId,
    });
    questionId = await upsertAttendanceQuestion(
      tx,
      {
        personId: venue.personId,
        day: {
          locationId: venue.cfg.locationId,
          businessDay: "2026-01-06",
          startAt: "2026-01-06T04:00:00Z",
          endAt: "2026-01-07T04:00:00Z",
        },
        shiftKey: `open:${openId}`,
        kind: "automatic-out",
        missingKinds: [],
        openEntryId: openId,
        automaticEntryId: endId,
        evidenceKeys: ["order:last"],
      },
      now,
    );
  });
  const response = await ask(own + "commands", {
    commandId: crypto.randomUUID(),
    expectedRevision: await revision(),
    action: "confirm",
    questionId,
  });
  expect(response.status).toBe(200);
  const value = (await (await ask(own + path())).json()) as PersonHours;
  expect(value.workedMinutes).toBe(960);
  expect(value.pending.automaticEntryIds).toEqual([]);
  expect(value.record.entries.find((e) => e.entry.entryId === endId)).toMatchObject({
    confirmed: true,
    confirmedByWorker: true,
  });
});
it("forbids another subject's target, manager actions, overrides and stale own revisions", async () => {
  const before = snapshot();
  for (const body of [
    {
      ...(await command()),
      action: "approve",
      itemId: target,
      questionId: undefined,
      changes: undefined,
      locationId: undefined,
      reason: undefined,
    },
    { ...(await command()), override: { personId: owner, pin: "1234" } },
    { ...(await command()), personId: owner },
  ]) {
    const response = await ask(own + "commands", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  }
  let response = await ask(own + "commands", { ...(await command()), expectedRevision: "stale" });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: { code: "attendance.state_changed" } });
  const foreign = {
    ...(await command()),
    changes: [
      { target: { entryId: crypto.randomUUID() }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 },
    ],
  };
  response = await ask(own + "commands", foreign);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "correction.invalid", params: { reason: "target_scope" } },
  });
  expect(snapshot()).toEqual(before);
});
it("only admits the configured or historically recorded own workplace", async () => {
  const [other] = await suite.db
    .insert(locations)
    .values({ name: "Old", invoiceLocales: ["es"], operationDescription: "Restaurant" })
    .returning();
  const route = own + `hours?locationId=${other!.id}&kind=month&date=2026-01-05`;
  let response = await ask(route);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "attendance.not_permitted" } });
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      locationId: other!.id,
      personId: venue.personId,
      origin: jobOrigin("dashboard"),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-06T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-06T17:00:00Z" });
  });
  response = await ask(route);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    personId: venue.personId,
    locationId: other!.id,
    workedMinutes: 480,
  });
});
it("rechecks a revoked own session after authentication and before the human write", async () => {
  expect((await ask(own + path())).status).toBe(200);
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => {
    reached = done;
  });
  const proceed = new Promise<void>((done) => {
    release = done;
  });
  const raw = new Request(`http://test${own}commands`, {
    method: "POST",
    headers: { cookie: staffCookie, "content-type": "application/json" },
    body: JSON.stringify(await command()),
  });
  const text = raw.text.bind(raw);
  raw.text = async () => {
    reached();
    await proceed;
    return text();
  };
  const before = snapshot();
  const asked = app.request(raw);
  try {
    await entered;
    await suite.db
      .update(managementSessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(managementSessions.id, staffSession));
  } finally {
    release();
  }
  const response = await asked;
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "management_session.required" } });
  expect(snapshot()).toEqual(before);
});

it("another worker's actual target, question and proposal confer no own authority", async () => {
  const [other] = await suite.db
    .insert(persons)
    .values({ displayName: "Other worker", pinHash: "scrypt$00$00", role: "staff" })
    .returning();
  let targetId = "",
    questionId = "",
    proposalId = "";
  await withTransaction(suite.db, async (tx) => {
    const common = {
      ...venue.cfg,
      personId: other!.id,
      origin: jobOrigin("dashboard"),
      offsetMinutes: 60,
    };
    await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
    await backend.clockOut(tx, { ...common, at: "2026-01-05T17:00:00Z" });
    targetId = (await tx.select().from(timeEntries)).find(
      (e) => e.personId === other!.id && e.entryKind === "out",
    )!.id;
    proposalId = await backend.proposeCorrection(tx, {
      nodeId: venue.cfg.nodeId,
      correctsEntryId: targetId,
      at: "2026-01-05T18:00:00Z",
      offsetMinutes: 60,
      reason: "Check departure",
      actorPersonId: owner,
      origin: jobOrigin("dashboard"),
    });
    questionId = await upsertAttendanceQuestion(
      tx,
      {
        personId: other!.id,
        day: {
          locationId: venue.cfg.locationId,
          businessDay: "2026-01-06",
          startAt: "2026-01-06T04:00:00Z",
          endAt: "2026-01-07T04:00:00Z",
        },
        shiftKey: "rota:other",
        kind: "missing-times",
        missingKinds: ["in", "out"],
        automaticEntryId: null,
        openEntryId: null,
        evidenceKeys: ["rota:other"],
      },
      now,
    );
  });
  const before = snapshot();
  for (const [body, status, code] of [
    [
      {
        ...(await command()),
        changes: [{ target: { entryId: targetId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 }],
      },
      400,
      "correction.invalid",
    ],
    [
      {
        commandId: crypto.randomUUID(),
        expectedRevision: await revision(),
        action: "confirm",
        questionId,
      },
      403,
      "correction.not_permitted",
    ],
    [
      {
        commandId: crypto.randomUUID(),
        expectedRevision: await revision(),
        action: "accept",
        itemId: proposalId,
      },
      403,
      "correction.not_permitted",
    ],
  ] as const) {
    const response = await ask(own + "commands", body);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  }
  expect(snapshot()).toEqual(before);
  const value = (await (await ask(own + path())).json()) as PersonHours;
  expect(value.pending.items).toEqual([]);
  expect(value.record.entries.every((e) => e.entry.personId === venue.personId)).toBe(true);
});

it("refuses an unknown manager workplace with the same domain refusal as queue and day", async () => {
  const locationId = crypto.randomUUID();
  for (const route of [
    `hours?locationId=${locationId}&kind=pay-period`,
    `queue?locationId=${locationId}`,
    `day?locationId=${locationId}&personId=${venue.personId}&date=2026-01-05`,
  ]) {
    const response = await ask("/management-api/attendance/" + route, undefined, ownerCookie);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "attendance.invalid", params: { reason: "record_scope_or_period" } },
    });
  }
  expect(
    (await ask("/management-api/attendance/" + path("pay-period"), undefined, ownerCookie)).status,
  ).toBe(200);
});
