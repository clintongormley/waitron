import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, newId, type Transaction, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WorkforceBackend } from "./clocking.js";
import { readRecordedEntries } from "./record-reads.js";
import { readAttendanceRevision } from "./attendance-responses.js";
import { upsertAttendanceQuestion, mergeAttendanceQuestions } from "./attendance-questions.js";
import { attendanceQuestions } from "./schema/attendance.js";
import * as api from "./index.js";
import type { AttendanceCommandPayload } from "./attendance-contract.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
const origin = jobOrigin("dashboard");
const now = new Date("2026-02-07T08:00:00.000Z");
let personId: string, other: string, manager: string, locationId: string, nodeId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
    ])
    .returning({ id: persons.id });
  [personId, other, manager] = rows.map((r) => r.id) as [string, string, string];
});
async function shift(
  subject = personId,
  location = locationId,
  date = "2026-01-05",
  offsetMinutes = 0,
) {
  const input = { nodeId, personId: subject, locationId: location, offsetMinutes, origin };
  await run((tx) => backend.clockIn(tx, { ...input, at: `${date}T09:00:00Z` }));
  const start = (
    await readRecordedEntries(suite.db, { personId: subject, locationId: location })
  ).find((e) => e.entryKind === "in" && e.eventAt === `${date}T09:00:00.000Z`)!.entryId;
  await run((tx) => backend.clockOut(tx, { ...input, at: `${date}T17:00:00Z` }));
  const end = (
    await readRecordedEntries(suite.db, { personId: subject, locationId: location })
  ).find((e) => e.entryKind === "out" && e.eventAt === `${date}T17:00:00.000Z`)!.entryId;
  return { start, end };
}
async function send(
  payload: AttendanceCommandPayload,
  requester = personId,
  authorizer = requester,
  subject = personId,
) {
  const command = {
    ...payload,
    commandId: newId(),
    expectedRevision: await run((tx) => readAttendanceRevision(tx, subject)),
  };
  return run((tx) =>
    api.executeAttendanceCommand(tx, {
      nodeId,
      requestedByPersonId: requester,
      authorizedByPersonId: authorizer,
      origin,
      command,
      now,
    }),
  );
}
function inbox(subject = personId) {
  expect(api).toHaveProperty("readAttendanceInbox", expect.any(Function));
  return run((tx) => api.readAttendanceInbox(tx, subject));
}
function day(date = "2026-01-05", location = locationId, subject = personId) {
  expect(api).toHaveProperty("readAttendanceDay", expect.any(Function));
  return run((tx) => api.readAttendanceDay(tx, { personId: subject, locationId: location, date }));
}
function queue(location = locationId) {
  expect(api).toHaveProperty("readAttendanceManagerQueue", expect.any(Function));
  return run((tx) => api.readAttendanceManagerQueue(tx, location));
}
function question(
  input: {
    date?: string;
    location?: string;
    subject?: string;
    key?: string;
    automatic?: string;
    open?: string;
  } = {},
) {
  const date = input.date ?? "2026-01-05";
  const end = new Date(`${date}T04:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return run((tx) =>
    upsertAttendanceQuestion(
      tx,
      {
        personId: input.subject ?? personId,
        day: {
          locationId: input.location ?? locationId,
          businessDay: date,
          startAt: `${date}T04:00:00Z`,
          endAt: end.toISOString(),
        },
        shiftKey: input.key ?? `rota:${date}`,
        kind: input.automatic ? "automatic-out" : "missing-times",
        missingKinds: input.automatic ? [] : ["in", "out"],
        automaticEntryId: input.automatic ?? null,
        openEntryId: input.open ?? null,
        evidenceKeys: [input.key ?? `rota:${date}`],
      },
      now,
    ),
  );
}
function request(end: string, at = "2026-01-05T18:00:00Z") {
  return send({
    action: "request",
    questionId: null,
    locationId,
    changes: [{ target: { entryId: end }, at, offsetMinutes: 0 }],
    reason: "Left later",
  });
}

it("returns an empty own inbox and one compatible subject revision for day and inbox", async () => {
  await question({ subject: other });
  const value = await inbox();
  expect(value).toEqual({
    personId,
    revision: await run((tx) => readAttendanceRevision(tx, personId)),
    prompts: [],
    items: [],
    locations: [],
  });
  expect((await day()).revision).toBe(value.revision);
  expect(await queue()).toEqual({ locationId, items: [] });
});
it("keeps canonical active unanswered questions oldest first without exposing another worker or retired rows", async () => {
  const newer = await question({ date: "2026-01-06" });
  const older = await question();
  const alias = await question({ key: "activity:duplicate" });
  await run((tx) => mergeAttendanceQuestions(tx, older, alias));
  const retired = await question({ date: "2026-01-04" });
  await suite.db
    .update(attendanceQuestions)
    .set({ active: false, inactiveReason: "rota_superseded" })
    .where(eq(attendanceQuestions.id, retired));
  await question({ subject: other });
  const value = await inbox();
  expect(value.prompts.map((p) => p.id)).toEqual([older, newer]);
  expect(value.prompts[0]).toEqual({
    id: older,
    questionId: older,
    itemId: null,
    personId,
    locationId,
    locationName: "Main",
    businessDay: "2026-01-05",
    day: {
      locationId,
      businessDay: "2026-01-05",
      startAt: "2026-01-05T04:00:00.000Z",
      endAt: "2026-01-06T04:00:00.000Z",
    },
    kind: "missing-times",
    automaticEntryId: null,
    missingKinds: ["in", "out"],
    timeZone: "Europe/Madrid",
    history: [],
  });
});
it("uses saved business bounds and retains an automatic original outside the business-day calendar date", async () => {
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-06T00:30:00Z",
      offsetMinutes: 60,
      origin,
    }),
  );
  const start = (await readRecordedEntries(suite.db, { personId }))[0]!.entryId;
  const automatic = await run((tx) =>
    backend.recordAutomaticClose(tx, {
      nodeId,
      personId,
      locationId,
      openEntryId: start,
      at: "2026-01-06T02:00:00Z",
      offsetMinutes: 60,
      origin,
    }),
  );
  const id = await question({ open: start, automatic });
  await suite.db
    .update(locations)
    .set({ dayCutover: "06:00:00", timeZone: "Europe/London" })
    .where(eq(locations.id, locationId));
  const prompt = (await inbox()).prompts[0]!;
  expect(prompt.id).toBe(id);
  expect(prompt.day).toEqual({
    locationId,
    businessDay: "2026-01-05",
    startAt: "2026-01-05T04:00:00.000Z",
    endAt: "2026-01-06T04:00:00.000Z",
  });
  expect(prompt.timeZone).toBe("Europe/London");
  expect(prompt.history.map((e) => [e.entryId, e.offsetMinutes, e.recordedByPersonId])).toEqual([
    [start, 60, personId],
    [automatic, 60, null],
  ]);
  expect((await day()).record.entries).toEqual([]);
  expect((await day("2026-01-06")).record.sessions[0]!.workedMinutes).toBe(90);
  await send({ action: "confirm", questionId: id });
  expect((await inbox()).prompts).toEqual([]);
});
it("keeps a worker request as history while a manager proposal is a prompt with its original and exact offset", async () => {
  const { end } = await shift();
  const requested = await request(end);
  expect((await inbox()).prompts).toEqual([]);
  const proposal = await send(
    {
      action: "propose",
      personId,
      locationId,
      changes: [{ target: { entryId: end }, at: "2026-01-05T16:00:00Z", offsetMinutes: 60 }],
      reason: "Check departure",
    },
    manager,
    manager,
  );
  const value = await inbox();
  expect(value.items.map((i) => i.status)).toEqual(["waiting-manager", "waiting-worker"]);
  expect(value.prompts).toHaveLength(1);
  const prompt = value.prompts[0]!;
  expect(prompt).toMatchObject({
    id: proposal.entryIds[0],
    questionId: null,
    itemId: proposal.entryIds[0],
    personId,
    locationId,
    kind: "proposal",
    businessDay: null,
    day: null,
    timeZone: "Europe/Madrid",
  });
  expect(prompt.history.map((e) => e.entryId)).toEqual([
    end,
    requested.entryIds[0],
    proposal.entryIds[0],
  ]);
  expect(prompt.history.at(-1)).toMatchObject({
    eventAt: "2026-01-05T16:00:00.000Z",
    offsetMinutes: 60,
    recordedByPersonId: manager,
  });
  expect((await queue()).items.map((i) => i.id)).toEqual([
    requested.entryIds[0],
    proposal.entryIds[0],
  ]);
});
it("retains historical locations and their current named zones, excluding locations belonging only to others", async () => {
  const historic = await seedLocation(suite.db);
  await suite.db
    .update(locations)
    .set({ name: "Old venue", timeZone: "America/New_York" })
    .where(eq(locations.id, historic));
  await question({ location: historic });
  await shift(other);
  const value = await inbox();
  expect(value.locations).toEqual([
    { id: historic, name: "Old venue", timeZone: "America/New_York" },
  ]);
  expect(value.prompts[0]).toMatchObject({
    locationId: historic,
    locationName: "Old venue",
    timeZone: "America/New_York",
  });
});
it("keeps all scoped original and response history when a correction crosses a month", async () => {
  const { end } = await shift(personId, locationId, "2026-01-31");
  const response = await request(end, "2026-02-01T00:30:00Z");
  await send({ action: "approve", itemId: response.entryIds[0]! }, manager, manager);
  const jan = await day("2026-01-31");
  const feb = await day("2026-02-01");
  for (const value of [jan, feb]) {
    expect(value.items).toHaveLength(1);
    expect(value.items[0]).toMatchObject({ status: "approved", personId, locationId });
    expect(value.items[0]!.history.map((e) => e.entryKind)).toEqual([
      "out",
      "correction",
      "correction",
    ]);
    expect(value.record.entries.map((e) => e.entry.entryId)).not.toHaveLength(0);
  }
  expect(jan.record.sessions[0]!.workedMinutes).toBe(930);
  expect(feb.record.sessions).toEqual([]);
  expect((await queue()).items).toEqual([]);
});
it("manager queue spans old dates and people but only the selected location and outstanding or disputed items", async () => {
  const { end } = await shift();
  const worker = await request(end);
  const second = await shift(other, locationId, "2026-01-06");
  const disputed = await send(
    {
      action: "propose",
      personId: other,
      locationId,
      changes: [{ target: { entryId: second.end }, at: "2026-01-06T18:00:00Z", offsetMinutes: 0 }],
      reason: "Later end",
    },
    manager,
    manager,
    other,
  );
  await send(
    { action: "disagree", itemId: disputed.entryIds[0]!, reason: "I left at five" },
    other,
    other,
    other,
  );
  const elsewhere = await seedLocation(suite.db);
  const foreign = await shift(other, elsewhere, "2026-01-07");
  await send(
    {
      action: "propose",
      personId: other,
      locationId: elsewhere,
      changes: [{ target: { entryId: foreign.end }, at: "2026-01-07T18:00:00Z", offsetMinutes: 0 }],
      reason: "Other place",
    },
    manager,
    manager,
    other,
  );
  const value = await queue();
  expect(value.items.map((i) => [i.id, i.personId, i.status])).toEqual([
    [worker.entryIds[0], personId, "waiting-manager"],
    [disputed.entryIds[0], other, "disputed"],
  ]);
  expect(value.items[1]!.history.at(-1)).toMatchObject({
    correctionStatus: "disputed",
    correctionReason: "I left at five",
    recordedByPersonId: other,
  });
  expect(
    value.items.every((i) =>
      i.history.every((e) => e.locationId === locationId && e.personId === i.personId),
    ),
  ).toBe(true);
});
it("selected days keep relevant pending missing pairs and omit unrelated days and locations", async () => {
  const value = await send({
    action: "request",
    questionId: null,
    locationId,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 },
      { target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 0 },
    ],
    reason: "Forgot the shift",
  });
  const selected = await day();
  expect(selected.items.map((i) => i.id)).toEqual([value.commandId]);
  expect(selected.record.sessions).toEqual([]);
  expect((await day("2026-01-06")).items).toEqual([]);
  expect((await day("2026-01-05", await seedLocation(suite.db))).items).toEqual([]);
  expect((await inbox()).locations.map((l) => l.id)).toEqual([locationId]);
});
it.each(["", "2026-02-30", "2026-1-5", "9999-12-31"])(
  "refuses invalid or unrepresentable selected date %s",
  async (date) => {
    await expect(day(date)).rejects.toMatchObject({ code: "attendance.invalid" });
  },
);
it("refuses an absent selected location without returning another location's record", async () => {
  await shift();
  await expect(day("2026-01-05", newId())).rejects.toMatchObject({ code: "attendance.invalid" });
});

it("a raw-library decline reopens a stored-resolved question with only its unanswered kind", async () => {
  const questionId = await question();
  const requested = await send({
    action: "request",
    questionId,
    locationId,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 },
      { target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 0 },
    ],
    reason: "Missing shift",
  });
  expect((await inbox()).prompts).toEqual([]);
  await run((tx) =>
    backend.declineCorrection(tx, {
      nodeId,
      correctionId: requested.entryIds[0]!,
      actorPersonId: manager,
      origin,
    }),
  );
  const value = await inbox();
  expect(value.prompts.map((p) => [p.questionId, p.missingKinds])).toEqual([[questionId, ["in"]]]);
  expect(value.prompts[0]!.history.map((e) => e.entryId)).toEqual(
    expect.arrayContaining(requested.entryIds),
  );
  expect(value.items.map((i) => i.status)).toEqual(["declined", "waiting-manager"]);
});
it("an overtaken proposal stays visible in day history but is absent from prompts and manager queue", async () => {
  const { end } = await shift();
  const proposal = await send(
    {
      action: "propose",
      personId,
      locationId,
      changes: [{ target: { entryId: end }, at: "2026-01-05T16:00:00Z", offsetMinutes: 0 }],
      reason: "Earlier end",
    },
    manager,
    manager,
  );
  const requested = await request(end);
  await send({ action: "approve", itemId: requested.entryIds[0]! }, manager, manager);
  expect((await inbox()).prompts).toEqual([]);
  expect((await queue()).items).toEqual([]);
  expect((await day()).items.find((i) => i.id === proposal.entryIds[0])).toMatchObject({
    status: "overtaken",
    readyToApply: false,
  });
});
it("keeps a blocked proposal available to disagree while checking competing work in another location", async () => {
  const { end } = await shift();
  const proposal = await send(
    {
      action: "propose",
      personId,
      locationId,
      changes: [{ target: { entryId: end }, at: "2026-01-05T19:00:00Z", offsetMinutes: 0 }],
      reason: "Check end",
    },
    manager,
    manager,
  );
  const elsewhere = await seedLocation(suite.db);
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId: elsewhere,
      at: "2026-01-05T18:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  expect((await queue()).items[0]).toMatchObject({ id: proposal.entryIds[0], readyToApply: false });
  expect((await day()).items[0]).toMatchObject({ readyToApply: false });
  expect((await inbox()).prompts.map((p) => p.itemId)).toEqual([proposal.entryIds[0]]);
  await send({
    action: "disagree",
    itemId: proposal.entryIds[0]!,
    reason: "Already at other site",
  });
  expect((await inbox()).prompts).toEqual([]);
  expect((await queue()).items[0]).toMatchObject({ status: "disputed", readyToApply: false });
});
it("both split shifts remain visible after a delayed missing-shift approval", async () => {
  await shift(personId, locationId, "2026-01-06");
  const pair = await send({
    action: "request",
    questionId: null,
    locationId,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 },
      { target: { missingKind: "out" }, at: "2026-01-05T13:00:00Z", offsetMinutes: 0 },
    ],
    reason: "Morning shift missing",
  });
  await send({ action: "approve", itemId: pair.commandId }, manager, manager);
  const evening = await send({
    action: "request",
    questionId: null,
    locationId,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 },
      { target: { missingKind: "out" }, at: "2026-01-05T22:00:00Z", offsetMinutes: 0 },
    ],
    reason: "Evening shift missing",
  });
  await send({ action: "approve", itemId: evening.commandId }, manager, manager);
  expect(
    (await day()).record.sessions.map((s) => [s.startedAt, s.endedAt, s.workedMinutes]),
  ).toEqual([
    ["2026-01-05T09:00:00.000Z", "2026-01-05T13:00:00.000Z", 240],
    ["2026-01-05T18:00:00.000Z", "2026-01-05T22:00:00.000Z", 240],
  ]);
  expect((await day()).items.map((i) => [i.id, i.status])).toEqual([
    [pair.commandId, "approved"],
    [evening.commandId, "approved"],
  ]);
  expect((await day("2026-01-06")).record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
});
it("an approved missing out permits the next clock-in without closing a later actual in", async () => {
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-05T09:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  const value = await send({
    action: "request",
    questionId: null,
    locationId,
    changes: [{ target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 0 }],
    reason: "Forgot to finish",
  });
  await send({ action: "approve", itemId: value.entryIds[0]! }, manager, manager);
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-06T09:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  expect((await day()).record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
  await expect(
    run((tx) =>
      backend.clockIn(tx, {
        nodeId,
        personId,
        locationId,
        at: "2026-01-06T10:00:00Z",
        offsetMinutes: 0,
        origin,
      }),
    ),
  ).rejects.toMatchObject({ code: "attendance.already_open" });
  await run((tx) =>
    backend.clockOut(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-06T17:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  expect((await day("2026-01-06")).record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
});
it("refuses empty reader scopes rather than reading the venue", async () => {
  await expect(inbox("")).rejects.toMatchObject({ code: "attendance.invalid" });
  await expect(day("2026-01-05", locationId, "")).rejects.toMatchObject({
    code: "attendance.invalid",
  });
  await expect(queue("")).rejects.toMatchObject({ code: "attendance.invalid" });
});

it("keeps recorded history scoped to the inbox subject even in a shared location", async () => {
  const own = await shift();
  const ownRequest = await request(own.end);
  const foreign = await shift(other);
  await send(
    {
      action: "request",
      questionId: null,
      locationId,
      changes: [{ target: { entryId: foreign.end }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 }],
      reason: "Other worker's end",
    },
    other,
    other,
    other,
  );
  const value = await inbox();
  expect(value.items.map((i) => i.id)).toEqual([ownRequest.entryIds[0]]);
  expect(value.items.every((i) => i.history.every((e) => e.personId === personId))).toBe(true);
});
it("selects calendar work dates from stored offsets after the location zone changes", async () => {
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-05T23:30:00Z",
      offsetMinutes: 120,
      origin,
    }),
  );
  await run((tx) =>
    backend.clockOut(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-06T01:00:00Z",
      offsetMinutes: 120,
      origin,
    }),
  );
  await suite.db
    .update(locations)
    .set({ timeZone: "America/New_York" })
    .where(eq(locations.id, locationId));
  expect((await day()).record.entries).toEqual([]);
  const recorded = await day("2026-01-06");
  expect(recorded.timeZone).toBe("America/New_York");
  expect(
    recorded.record.sessions.map((s) => [s.workDate, s.workedMinutes, s.startOffsetMinutes]),
  ).toEqual([["2026-01-06", 90, 120]]);
  expect(recorded.record.entries.map((e) => e.entry.offsetMinutes)).toEqual([120, 120]);
});

it("approves an older missing out behind a newer actual in without closing the current shift", async () => {
  await run((tx) =>
    backend.clockIn(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-06T09:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  const historical = await send({
    action: "request",
    questionId: null,
    locationId,
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 },
      { target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 0 },
    ],
    reason: "Yesterday's missing times",
  });
  await send({ action: "approve", itemId: historical.commandId }, manager, manager);
  expect((await day()).record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
  await expect(
    run((tx) =>
      backend.clockIn(tx, {
        nodeId,
        personId,
        locationId,
        at: "2026-01-06T10:00:00Z",
        offsetMinutes: 0,
        origin,
      }),
    ),
  ).rejects.toMatchObject({ code: "attendance.already_open" });
  await run((tx) =>
    backend.clockOut(tx, {
      nodeId,
      personId,
      locationId,
      at: "2026-01-06T17:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  expect((await day("2026-01-06")).record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
});
