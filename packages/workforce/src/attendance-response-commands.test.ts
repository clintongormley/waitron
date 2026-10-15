import { beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  locations,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  newId,
  openVenueDatabase,
  type Transaction,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import {
  deviceOrigin,
  jobOrigin,
  locationId as brandLocationId,
  type Origin,
} from "@waitron/shared";
import { seedLocation } from "../test/fixtures.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { WorkforceBackend } from "./clocking.js";
import * as responses from "./attendance-responses.js";
import { upsertAttendanceQuestion } from "./attendance-questions.js";
import { attendanceQuestions, attendanceMail } from "./schema/attendance.js";
import { readRecordedEntries } from "./record-reads.js";
import {
  mergeAttendanceQuestions,
  listPendingAttendanceQuestions,
} from "./attendance-questions.js";
import * as api from "./index.js";
import type { AttendanceCommand, AttendanceCommandPayload } from "./attendance-contract.js";
import { attendanceResponseCommands } from "./schema/attendance-responses.js";
import { timeEntries } from "./schema/time-entries.js";
import { workforceChains } from "./schema/workforce-chains.js";
import { readChain } from "./chain.js";
import { verifyChain } from "./chain-hash.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const backend = new WorkforceBackend();
const origin = jobOrigin("dashboard");
const now = new Date("2026-01-07T08:00:00.000Z");
let personId: string, manager: string, other: string, locationId: string, nodeId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
      { displayName: "Other", pinHash: "scrypt$00$00", role: "staff" },
    ])
    .returning({ id: persons.id });
  [personId, manager, other] = rows.map((r) => r.id) as [string, string, string];
});
async function revision(subject = personId) {
  expect(responses).toHaveProperty("readAttendanceRevision", expect.any(Function));
  return run((tx) => responses.readAttendanceRevision(tx, subject));
}
function clock(at: string, subject = personId, location = locationId, node = nodeId) {
  return run((tx) =>
    backend.clockIn(tx, {
      nodeId: node,
      personId: subject,
      locationId: location,
      at,
      offsetMinutes: 0,
      origin,
    }),
  );
}
function question(subject = personId, key = "rota:first") {
  return run((tx) =>
    upsertAttendanceQuestion(
      tx,
      {
        personId: subject,
        day: {
          locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T04:00:00.000Z",
          endAt: "2026-01-06T04:00:00.000Z",
        },
        shiftKey: key,
        kind: "missing-times",
        missingKinds: ["in", "out"],
        openEntryId: null,
        automaticEntryId: null,
        evidenceKeys: [key],
      },
      now,
    ),
  );
}

it("revision changes for an older event appended on a different node", async () => {
  await clock("2026-01-06T09:00:00Z");
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
  const target = (await readRecordedEntries(suite.db, { personId })).find(
    (e) => e.entryKind === "out",
  )!.entryId;
  const before = await revision();
  expect(await revision()).toBe(before);
  const earlierNode = await seedNode(suite.db, brandLocationId(locationId));
  await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId: earlierNode,
      correctsEntryId: target,
      actorPersonId: personId,
      at: "2026-01-06T16:00:00Z",
      offsetMinutes: 0,
      reason: "Missed the end",
      origin,
    }),
  );
  expect(await revision()).not.toBe(before);
});
it("revision ignores another worker's entries and questions", async () => {
  const before = await revision();
  await clock("2026-01-05T09:00:00Z", other);
  await question(other);
  expect(await revision()).toBe(before);
});
it("revision covers a historical location as well as the current one", async () => {
  const before = await revision();
  const historical = await seedLocation(suite.db);
  const historicalNode = await seedNode(suite.db, brandLocationId(historical));
  await clock("2026-01-05T09:00:00Z", personId, historical, historicalNode);
  expect(await revision()).not.toBe(before);
});
it("revision covers question retirement with no legal append", async () => {
  const id = await question();
  const before = await revision();
  await suite.db
    .update(attendanceQuestions)
    .set({ active: false, inactiveReason: "rota_superseded" })
    .where(eq(attendanceQuestions.id, id));
  expect(await revision()).not.toBe(before);
});
it.each(["zone", "cutover", "dated-cutover", "settings-revision"] as const)(
  "revision covers %s changes without a legal append",
  async (kind) => {
    const before = await revision();
    if (kind === "zone")
      await suite.db.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, locationId));
    if (kind === "cutover")
      await suite.db
        .update(locations)
        .set({ dayCutover: "05:00:00" })
        .where(eq(locations.id, locationId));
    if (kind === "dated-cutover")
      await suite.db
        .insert(locationDayCutoverChanges)
        .values({ locationId, effectiveBusinessDay: "2026-01-05", dayCutover: "05:00:00" });
    if (kind === "settings-revision")
      await suite.db.insert(locationBusinessDaySettings).values({ locationId, revision: 1 });
    expect(await revision()).not.toBe(before);
  },
);

async function command(
  payload: AttendanceCommandPayload,
  subject = personId,
): Promise<AttendanceCommand> {
  return { ...payload, commandId: newId(), expectedRevision: await revision(subject) };
}
function send(
  value: AttendanceCommand,
  requester = personId,
  authorizer = requester,
  capture: Origin = origin,
  node = nodeId,
) {
  expect(api).toHaveProperty("executeAttendanceCommand", expect.any(Function));
  return run((tx) =>
    api.executeAttendanceCommand(tx, {
      nodeId: node,
      requestedByPersonId: requester,
      authorizedByPersonId: authorizer,
      origin: capture,
      command: value,
      now,
    }),
  );
}
function pair(): AttendanceCommandPayload {
  return {
    action: "request",
    questionId: null,
    locationId,
    reason: "Forgot both times",
    changes: [
      { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 },
      { target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 0 },
    ],
  };
}
async function snapshot() {
  return {
    entries: await suite.db.select().from(timeEntries).orderBy(timeEntries.id),
    heads: await suite.db
      .select()
      .from(workforceChains)
      .orderBy(workforceChains.nodeId, workforceChains.locationId),
    receipts: await suite.db
      .select()
      .from(attendanceResponseCommands)
      .orderBy(attendanceResponseCommands.id),
  };
}
async function refused(action: () => unknown, code: string) {
  const before = await snapshot();
  await expect(action()).rejects.toMatchObject({ code });
  expect(await snapshot()).toEqual(before);
}
async function intact() {
  expect(verifyChain(await readChain(suite.db, { nodeId, locationId }))).toEqual({ ok: true });
}
async function automaticQuestion() {
  await clock("2026-01-05T09:00:00Z");
  const openEntryId = (await readRecordedEntries(suite.db, { personId }))[0]!.entryId;
  const automaticEntryId = await run((tx) =>
    backend.recordAutomaticClose(tx, {
      nodeId,
      personId,
      locationId,
      openEntryId,
      at: "2026-01-05T17:00:00Z",
      offsetMinutes: 0,
      origin,
    }),
  );
  const id = await run((tx) =>
    upsertAttendanceQuestion(
      tx,
      {
        personId,
        day: {
          locationId,
          businessDay: "2026-01-05",
          startAt: "2026-01-05T04:00:00.000Z",
          endAt: "2026-01-06T04:00:00.000Z",
        },
        shiftKey: `open:${openEntryId}`,
        kind: "automatic-out",
        missingKinds: [],
        openEntryId,
        automaticEntryId,
        evidenceKeys: ["order:last"],
      },
      now,
    ),
  );
  return { questionId: id, automaticEntryId };
}

it("confirmation appends once and exact replay beats the now stale revision", async () => {
  const { questionId, automaticEntryId } = await automaticQuestion();
  const value = await command({ action: "confirm", questionId });
  const result = await send(value);
  expect(result).toEqual({
    commandId: value.commandId,
    entryIds: [expect.any(String)],
    replayed: false,
  });
  const saved = await snapshot();
  expect(await send(value)).toEqual({ ...result, replayed: true });
  expect(await snapshot()).toEqual(saved);
  expect(
    saved.entries
      .filter((e) => e.entryKind === "confirmation")
      .map((e) => [e.id, e.respondsToEntryId, e.recordedByPersonId, e.authorKind]),
  ).toEqual([[result.entryIds[0], automaticEntryId, personId, "worker"]]);
  expect(saved.receipts).toEqual([
    {
      id: value.commandId,
      requestedByPersonId: personId,
      authorizedByPersonId: personId,
      personId,
      locationId,
      questionId,
      action: "confirm",
      input: { action: "confirm", questionId },
      entryIds: result.entryIds,
      createdAt: now.toISOString(),
    },
  ]);
  expect((await suite.db.select().from(attendanceQuestions))[0]!.resolvedByEntryId).toBe(
    result.entryIds[0],
  );
  await intact();
});
it("requester-scoped command recovery returns null for another requester and absence", async () => {
  const value = await command(pair());
  const result = await send(value);
  expect(api).toHaveProperty("readAttendanceCommand", expect.any(Function));
  expect(
    await run((tx) =>
      api.readAttendanceCommand(tx, { commandId: value.commandId, requestedByPersonId: personId }),
    ),
  ).toEqual({ ...result, replayed: true });
  expect(
    await run((tx) =>
      api.readAttendanceCommand(tx, { commandId: value.commandId, requestedByPersonId: other }),
    ),
  ).toBeNull();
  expect(
    await run((tx) =>
      api.readAttendanceCommand(tx, { commandId: newId(), requestedByPersonId: personId }),
    ),
  ).toBeNull();
});
it("missing pair is one receipt and normalized timestamp and reason replay append nothing", async () => {
  const value = await command(pair());
  const result = await send(value);
  expect(result.entryIds).toHaveLength(2);
  expect(new Set(result.entryIds).size).toBe(2);
  if (value.action !== "request") throw new Error("fixture requires request");
  const equivalent = {
    ...value,
    expectedRevision: "old",
    reason: "  Forgot both times  ",
    changes: value.changes.map((c) => ({ ...c, at: c.at.replace("Z", ".000Z") })),
  };
  expect(await send(equivalent)).toEqual({ ...result, replayed: true });
  expect(
    (await snapshot()).entries
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
      .map((e) => [e.id, e.correctionStatus, e.recordedByPersonId]),
  ).toEqual(result.entryIds.map((id) => [id, "requested", personId]));
  await intact();
});
it.each(["payload", "requester", "authorizer"] as const)(
  "reused command with different %s refuses without an append",
  async (difference) => {
    const value = await command(pair());
    await send(value);
    const changed = difference === "payload" ? { ...value, reason: "Something else" } : value;
    await refused(
      () =>
        send(
          changed,
          difference === "requester" ? other : personId,
          difference === "authorizer" ? manager : difference === "requester" ? other : personId,
        ),
      "correction.invalid",
    );
  },
);
it("two device commands using one revision append only the first answer", async () => {
  const value = await command(pair());
  await send(value);
  await refused(() => send({ ...value, commandId: newId() }), "attendance.state_changed");
});
it("receipt failure rolls back both requests and the chain head", async () => {
  await suite.db.execute(
    sql`create trigger refuse_response before insert on attendance_response_commands begin select raise(abort, 'response fault'); end`,
  );
  try {
    const value = await command(pair());
    const before = await snapshot();
    await expect(send(value)).rejects.toMatchObject({ message: "response fault", errcode: 1811 });
    expect(await snapshot()).toEqual(before);
  } finally {
    await suite.db.execute(sql`drop trigger refuse_response`);
  }
});
it("approval changes 480 to 540 only after the manager decides", async () => {
  const { questionId, automaticEntryId } = await automaticQuestion();
  const value = await command({
    action: "request",
    questionId,
    locationId,
    reason: "Worked later",
    changes: [
      { target: { entryId: automaticEntryId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 },
    ],
  });
  const result = await send(value);
  const total = async () =>
    (
      await run((tx) =>
        backend.timeRecord(tx, { personId, period: { start: "2026-01-01", end: "2026-02-01" } }),
      )
    ).sessions.map((s) => s.workedMinutes);
  expect(await total()).toEqual([480]);
  const decision = await command({ action: "approve", itemId: result.entryIds[0]! });
  const approved = await send(decision, personId, manager);
  expect(await total()).toEqual([540]);
  expect((await snapshot()).entries.find((e) => e.id === approved.entryIds[0])).toMatchObject({
    respondsToEntryId: result.entryIds[0],
    recordedByPersonId: manager,
    capturedBySource: "dashboard",
    correctionStatus: "approved",
  });
  await intact();
});
it("manager pair stays pending until the worker accepts the entire item", async () => {
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({
    action: "propose",
    personId,
    locationId,
    changes: payload.changes,
    reason: "Please check these times",
  });
  const result = await send(value, manager);
  const decision = await command({ action: "accept", itemId: value.commandId });
  const accepted = await send(decision);
  expect(accepted.entryIds).toHaveLength(2);
  expect(
    (await snapshot()).entries
      .filter((e) => accepted.entryIds.includes(e.id))
      .sort((a, b) => a.sequenceNo - b.sequenceNo)
      .map((e) => [e.respondsToEntryId, e.recordedByPersonId, e.authorKind, e.correctionStatus]),
  ).toEqual(result.entryIds.map((id) => [id, personId, "worker", "approved"]));
  await intact();
});

it.each(["manager", "supervisor"] as const)("%s cannot approve their own request", async (role) => {
  await suite.db.update(persons).set({ role }).where(eq(persons.id, personId));
  const value = await command(pair());
  await send(value);
  const decision = await command({ action: "approve", itemId: value.commandId });
  await refused(() => send(decision), "correction.not_permitted");
});
it("current admin self-approval is stored and demotion refuses even exact replay", async () => {
  await suite.db.update(persons).set({ role: "admin" }).where(eq(persons.id, personId));
  const value = await command(pair());
  await send(value);
  const decision = await command({ action: "approve", itemId: value.commandId });
  const result = await send(decision);
  expect(
    (await snapshot()).entries
      .filter((e) => result.entryIds.includes(e.id))
      .map((e) => [e.selfApproved, e.recordedByPersonId]),
  ).toEqual([
    [true, personId],
    [true, personId],
  ]);
  await suite.db.update(persons).set({ role: "manager" }).where(eq(persons.id, personId));
  await refused(() => send(decision), "correction.not_permitted");
  await intact();
});
it("suspended selected authorizer cannot replay a successful decision", async () => {
  const value = await command(pair());
  await send(value);
  const decision = await command({ action: "approve", itemId: value.commandId });
  await send(decision, personId, manager);
  await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, manager));
  await refused(() => send(decision, personId, manager), "correction.not_permitted");
});
it("a foreign question cannot be confirmed by another worker", async () => {
  const { questionId } = await automaticQuestion();
  const value = await command({ action: "confirm", questionId }, other);
  await refused(() => send(value, other), "correction.not_permitted");
});
it("another worker's target cannot enter an own request", async () => {
  await clock("2026-01-05T09:00:00Z", other);
  const target = (await readRecordedEntries(suite.db, { personId: other }))[0]!.entryId;
  const value = await command({
    action: "request",
    questionId: null,
    locationId,
    reason: "Wrong worker",
    changes: [{ target: { entryId: target }, at: "2026-01-05T10:00:00Z", offsetMinutes: 0 }],
  });
  await refused(() => send(value), "correction.invalid");
});
it("a manager PIN does not let an unrelated worker answer someone else's item", async () => {
  const value = await command(pair());
  await send(value);
  const decision = await command({ action: "approve", itemId: value.commandId });
  await refused(() => send(decision, other, manager), "correction.not_permitted");
});
it("a different time-zone revision refuses a new human append", async () => {
  const value = await command(pair());
  await suite.db.update(locations).set({ timeZone: "UTC" }).where(eq(locations.id, locationId));
  await refused(() => send(value), "attendance.state_changed");
});
it("second-member append failure rolls back the first request and receipt", async () => {
  await suite.db.execute(
    sql`create trigger refuse_second_response before insert on time_entries when new.missing_entry_kind = 'out' begin select raise(abort, 'second answer fault'); end`,
  );
  try {
    const value = await command(pair());
    const before = await snapshot();
    await expect(send(value)).rejects.toMatchObject({
      message: "second answer fault",
      errcode: 1811,
    });
    expect(await snapshot()).toEqual(before);
  } finally {
    await suite.db.execute(sql`drop trigger refuse_second_response`);
  }
});
it.each(["pending", "rejected", "sending", "sent", "unknown", "cancelled"] as const)(
  "an answered question preserves attempted mail and cancels only unclaimed %s",
  async (status) => {
    const questionId = await question();
    const [mail] = await suite.db.select().from(attendanceMail);
    await suite.db
      .update(attendanceMail)
      .set({
        status,
        claimToken: "retained-token",
        claimedAt: now.toISOString(),
        recipient: "worker@example.test",
        outcome: status === "sent" || status === "unknown" ? status : null,
      })
      .where(eq(attendanceMail.id, mail!.id));
    const value = pair();
    if (value.action !== "request") throw new Error("fixture requires request");
    await send(await command({ ...value, questionId }));
    expect(await suite.db.select().from(attendanceMail)).toEqual([
      {
        ...mail!,
        status: status === "pending" || status === "rejected" ? "cancelled" : status,
        claimToken: "retained-token",
        claimedAt: now.toISOString(),
        recipient: "worker@example.test",
        outcome: status === "sent" || status === "unknown" ? status : null,
      },
    ]);
  },
);

it("declining a paired answer reopens its missing times without rearming email", async () => {
  const questionId = await question();
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({ ...payload, questionId });
  await send(value);
  expect(await run((tx) => listPendingAttendanceQuestions(tx, personId))).toEqual([]);
  await send(await command({ action: "decline", itemId: value.commandId }), manager);
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => [
      q.id,
      q.missingKinds,
    ]),
  ).toEqual([[questionId, ["in", "out"]]]);
  expect((await suite.db.select().from(attendanceMail))[0]!.status).toBe("cancelled");
});
it("a legacy partial pair decision reopens only the declined kind", async () => {
  const questionId = await question();
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({ ...payload, questionId });
  const result = await send(value);
  await run((tx) =>
    backend.approveCorrection(tx, {
      nodeId,
      correctionId: result.entryIds[0]!,
      approverPersonId: manager,
    }),
  );
  await run((tx) =>
    backend.declineCorrection(tx, {
      nodeId,
      correctionId: result.entryIds[1]!,
      actorPersonId: manager,
      origin,
    }),
  );
  expect(api).toHaveProperty("reconcileAttendanceResponses", expect.any(Function));
  await run((tx) => api.reconcileAttendanceResponses(tx, personId));
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => [
      q.id,
      q.missingKinds,
    ]),
  ).toEqual([[questionId, ["out"]]]);
  await intact();
});
it("a retired rota question stays retired after its answer is declined", async () => {
  const questionId = await question();
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({ ...payload, questionId });
  await send(value);
  await suite.db
    .update(attendanceQuestions)
    .set({ active: false, inactiveReason: "rota_superseded" })
    .where(eq(attendanceQuestions.id, questionId));
  await send(await command({ action: "decline", itemId: value.commandId }), manager);
  expect(await run((tx) => listPendingAttendanceQuestions(tx, personId))).toEqual([]);
  expect((await suite.db.select().from(attendanceQuestions))[0]).toMatchObject({
    active: false,
    inactiveReason: "rota_superseded",
  });
});
it("merged alias answers the canonical question once and replays with either spelling", async () => {
  const questionId = await question();
  const alias = await question(personId, "activity:alias");
  await run((tx) => mergeAttendanceQuestions(tx, questionId, alias));
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({ ...payload, questionId: alias });
  const result = await send(value);
  expect((await snapshot()).receipts[0]).toMatchObject({
    questionId,
    input: {
      ...payload,
      questionId,
      changes: payload.changes.map((c) => ({ ...c, at: c.at.replace("Z", ".000Z") })),
    },
  });
  if (value.action !== "request") throw new Error("fixture requires request");
  expect(await send({ ...value, questionId })).toEqual({ ...result, replayed: true });
  expect(await run((tx) => listPendingAttendanceQuestions(tx, personId))).toEqual([]);
});
it("a declined automatic-time change asks again while the original 480 still counts", async () => {
  const { questionId, automaticEntryId } = await automaticQuestion();
  const value = await command({
    action: "request",
    questionId,
    locationId,
    reason: "Worked later",
    changes: [
      { target: { entryId: automaticEntryId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 },
    ],
  });
  const result = await send(value);
  await send(await command({ action: "decline", itemId: result.entryIds[0]! }), manager);
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => q.id),
  ).toEqual([questionId]);
  const record = await run((tx) =>
    backend.timeRecord(tx, { personId, period: { start: "2026-01-01", end: "2026-02-01" } }),
  );
  expect(record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
});
it("a legal acknowledgment outside the response adapter resolves the automatic question", async () => {
  const { questionId, automaticEntryId } = await automaticQuestion();
  const id = await run((tx) =>
    backend.confirmAutomaticEntry(tx, {
      nodeId,
      entryId: automaticEntryId,
      workerPersonId: personId,
      origin,
    }),
  );
  expect(api).toHaveProperty("reconcileAttendanceResponses", expect.any(Function));
  await run((tx) => api.reconcileAttendanceResponses(tx, personId));
  expect(await run((tx) => listPendingAttendanceQuestions(tx, personId))).toEqual([]);
  expect(
    (await suite.db.select().from(attendanceQuestions)).find((q) => q.id === questionId)!
      .resolvedByEntryId,
  ).toBe(id);
});
it("question-anchor failure rolls back human rows, receipt and reminder cancellation", async () => {
  const questionId = await question();
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({ ...payload, questionId });
  const savedQuestion = await suite.db.select().from(attendanceQuestions);
  const savedMail = await suite.db.select().from(attendanceMail);
  const before = await snapshot();
  await suite.db.execute(
    sql`create trigger refuse_question_answer before update on attendance_questions when new.resolved_by_entry_id is not null begin select raise(abort, 'question answer fault'); end`,
  );
  try {
    await expect(send(value)).rejects.toMatchObject({
      message: "question answer fault",
      errcode: 1811,
    });
    expect(await snapshot()).toEqual(before);
    expect(await suite.db.select().from(attendanceQuestions)).toEqual(savedQuestion);
    expect(await suite.db.select().from(attendanceMail)).toEqual(savedMail);
  } finally {
    await suite.db.execute(sql`drop trigger refuse_question_answer`);
  }
});

it("a declined raw-library automatic-time request reopens a previously reconciled question", async () => {
  const { questionId, automaticEntryId } = await automaticQuestion();
  const request = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      correctsEntryId: automaticEntryId,
      actorPersonId: personId,
      at: "2026-01-05T18:00:00Z",
      offsetMinutes: 0,
      reason: "Worked later",
      origin,
    }),
  );
  await run((tx) => api.reconcileAttendanceResponses(tx, personId));
  expect(await run((tx) => listPendingAttendanceQuestions(tx, personId))).toEqual([]);
  await run((tx) =>
    backend.declineCorrection(tx, {
      nodeId,
      correctionId: request,
      actorPersonId: manager,
      origin,
    }),
  );
  await run((tx) => api.reconcileAttendanceResponses(tx, personId));
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => q.id),
  ).toEqual([questionId]);
});
it("a request for one shift never resolves another question on the same day", async () => {
  const first = await question();
  const second = await question(personId, "rota:second");
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  await send(await command({ ...payload, questionId: first }));
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => [
      q.id,
      q.missingKinds,
    ]),
  ).toEqual([[second, ["in", "out"]]]);
});
it("a pending partial answer cannot submit the already supplied kind twice", async () => {
  const questionId = await question();
  const payload = pair();
  if (payload.action !== "request") throw new Error("fixture requires request");
  const value = await command({ ...payload, questionId, changes: [payload.changes[0]!] });
  await send(value);
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => q.missingKinds),
  ).toEqual([["out"]]);
  await refused(
    () => send({ ...value, commandId: newId(), expectedRevision: "old" }),
    "attendance.state_changed",
  );
  await refused(
    () => send({ ...value, commandId: newId(), expectedRevision: "" }),
    "attendance.state_changed",
  );
  const duplicate = { ...value, commandId: newId(), expectedRevision: await revision() };
  await refused(() => send(duplicate), "correction.invalid");
});

it("replay survives closing and reopening a persisted venue copy", async () => {
  const value = await command(pair());
  const result = await send(value);
  const folder = await mkdtemp(join(tmpdir(), "attendance-replay-"));
  try {
    await suite.db.archiveTo(join(folder, "venue.db"));
    const first = await openVenueDatabase(folder);
    try {
      expect(
        await withTransaction(first.venue, (tx) =>
          api.readAttendanceCommand(tx, {
            commandId: value.commandId,
            requestedByPersonId: personId,
          }),
        ),
      ).toEqual({ ...result, replayed: true });
    } finally {
      await first.close();
    }
    const reopened = await openVenueDatabase(folder);
    try {
      const before = reopened.venue.execute(sql`select * from time_entries order by id`).rows;
      expect(
        await withTransaction(reopened.venue, (tx) =>
          api.executeAttendanceCommand(tx, {
            nodeId,
            requestedByPersonId: personId,
            authorizedByPersonId: personId,
            origin,
            command: value,
            now,
          }),
        ),
      ).toEqual({ ...result, replayed: true });
      expect(reopened.venue.execute(sql`select * from time_entries order by id`).rows).toEqual(
        before,
      );
      expect(verifyChain(await readChain(reopened.venue, { nodeId, locationId }))).toEqual({
        ok: true,
      });
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
it("a till decision on another node keeps the selected manager and device origin", async () => {
  const { deviceId } = await seedDevice(suite.db, { locationId });
  const capture = deviceOrigin(deviceId);
  const value = await command(pair());
  const requested = await send(value, personId, personId, capture);
  const earlierNode = nodeId;
  const decisionNode = await seedNode(suite.db, brandLocationId(locationId));
  const result = await send(
    await command({ action: "approve", itemId: value.commandId }),
    personId,
    manager,
    capture,
    decisionNode,
  );
  const rows = (await snapshot()).entries
    .filter((e) => result.entryIds.includes(e.id))
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
  expect(
    rows.map((e) => [
      e.nodeId,
      e.respondsToEntryId,
      e.recordedByPersonId,
      e.capturedBySource,
      e.capturedByDeviceId,
    ]),
  ).toEqual(requested.entryIds.map((id) => [decisionNode, id, manager, "device", deviceId]));
  expect(verifyChain(await readChain(suite.db, { nodeId: earlierNode, locationId }))).toEqual({
    ok: true,
  });
  expect(verifyChain(await readChain(suite.db, { nodeId: decisionNode, locationId }))).toEqual({
    ok: true,
  });
});
it("a decision whose second append fails leaves the whole pair pending", async () => {
  const value = await command(pair());
  await send(value);
  const decision = await command({ action: "approve", itemId: value.commandId });
  await suite.db.execute(
    sql`create trigger refuse_second_approval before insert on time_entries when new.missing_entry_kind = 'out' and new.correction_status = 'approved' begin select raise(abort, 'second approval fault'); end`,
  );
  try {
    const before = await snapshot();
    await expect(send(decision, personId, manager)).rejects.toMatchObject({
      message: "second approval fault",
      errcode: 1811,
    });
    expect(await snapshot()).toEqual(before);
  } finally {
    await suite.db.execute(sql`drop trigger refuse_second_approval`);
  }
  await intact();
});
it("a partially answered legacy pair refuses the old group but retains the remaining singleton", async () => {
  const value = await command(pair());
  const requested = await send(value);
  await run((tx) =>
    backend.declineCorrection(tx, {
      nodeId,
      correctionId: requested.entryIds[1]!,
      actorPersonId: manager,
      origin,
    }),
  );
  const obsolete = await command({ action: "approve", itemId: value.commandId });
  await refused(() => send(obsolete, personId, manager), "correction.not_pending");
  const remaining = await command({ action: "decline", itemId: requested.entryIds[0]! });
  const result = await send(remaining, personId, manager);
  expect(result.entryIds).toHaveLength(1);
  expect((await snapshot()).entries.find((e) => e.id === result.entryIds[0])).toMatchObject({
    respondsToEntryId: requested.entryIds[0],
    correctionStatus: "declined",
  });
  const saved = await snapshot();
  expect(await send(remaining, personId, manager)).toEqual({ ...result, replayed: true });
  expect(await snapshot()).toEqual(saved);
});
it("a worker dispute retains 480 minutes and both original and proposed times", async () => {
  const { automaticEntryId } = await automaticQuestion();
  const value = await command({
    action: "propose",
    personId,
    locationId,
    reason: "Manager's proposed end",
    changes: [
      { target: { entryId: automaticEntryId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 },
    ],
  });
  const requested = await send(value, manager);
  const result = await send(
    await command({
      action: "disagree",
      itemId: requested.entryIds[0]!,
      reason: "I left at the recorded time",
    }),
  );
  const record = await run((tx) =>
    backend.timeRecord(tx, { personId, period: { start: "2026-01-01", end: "2026-02-01" } }),
  );
  expect(record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
  expect(record.entries.find((e) => e.entry.entryId === automaticEntryId)).toMatchObject({
    entry: { eventAt: "2026-01-05T17:00:00.000Z" },
    effective: true,
  });
  expect(record.entries.find((e) => e.entry.entryId === result.entryIds[0])).toMatchObject({
    entry: { eventAt: "2026-01-05T18:00:00.000Z", correctionReason: "I left at the recorded time" },
    disputed: true,
  });
  await intact();
});
it("approval after a frozen 480-minute period adds a live 60-minute impact without changing the closure", async () => {
  const { questionId, automaticEntryId } = await automaticQuestion();
  const frozen = await run((tx) =>
    api.closePayPeriod(tx, {
      nodeId,
      locationId,
      period: { start: "2026-01-01", end: "2026-02-01" },
      clock: { timeZone: "UTC", dayCutover: "04:00", cutoverChanges: [] },
      now: "2026-02-01T04:00:00Z",
      ruleset: { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
      origin,
    }),
  );
  const stored = await suite.db.select().from(api.payPeriodClosures);
  expect(frozen.snapshot.sessions.map((s) => s.workedMinutes)).toEqual([480]);
  expect(
    (await run((tx) => listPendingAttendanceQuestions(tx, personId))).map((q) => q.id),
  ).toEqual([questionId]);
  const requested = await send(
    await command({
      action: "request",
      questionId,
      locationId,
      reason: "Worked another hour",
      changes: [
        { target: { entryId: automaticEntryId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 0 },
      ],
    }),
  );
  await send(
    await command({ action: "approve", itemId: requested.entryIds[0]! }),
    personId,
    manager,
  );
  const record = await run((tx) =>
    backend.timeRecord(tx, { personId, period: { start: "2026-01-01", end: "2026-02-01" } }),
  );
  expect(record.sessions.map((s) => s.workedMinutes)).toEqual([540]);
  expect(record.closedPeriodImpacts).toEqual([
    {
      closureId: frozen.id,
      personId,
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ]);
  expect(await suite.db.select().from(api.payPeriodClosures)).toEqual(stored);
  await intact();
});
