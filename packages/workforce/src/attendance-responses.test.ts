import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { seedLocation } from "../test/fixtures.js";
import { WorkforceBackend } from "./clocking.js";
import { readChain } from "./chain.js";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import type { TimeEntryRecord } from "./projection.js";
import * as api from "./index.js";
import { correctionGroupCanApply } from "./corrections.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend();
const origin = jobOrigin("dashboard");
let personId: string, managerId: string, locationId: string, nodeId: string;
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
beforeEach(async () => {
  await seedTenant(suite.db);
  locationId = await seedLocation(suite.db);
  nodeId = await seedNode(suite.db, brandLocationId(locationId));
  const rows = await suite.db
    .insert(persons)
    .values([
      { displayName: "Ana", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Bea", pinHash: "scrypt$00$00", role: "manager" },
    ])
    .returning({ id: persons.id });
  [personId, managerId] = rows.map((r) => r.id) as [string, string];
});
async function completedDay() {
  const input = { nodeId, personId, locationId, offsetMinutes: 0, origin };
  await run((tx) => backend.clockIn(tx, { ...input, at: "2026-01-05T09:00:00Z" }));
  await run((tx) => backend.clockOut(tx, { ...input, at: "2026-01-05T17:00:00Z" }));
}
const missing = (missingEntryKind: "in" | "out", at: string) => ({
  nodeId,
  personId,
  locationId,
  missingEntryKind,
  at,
  offsetMinutes: 0,
  actorPersonId: personId,
  reason: "Forgot to record my shift",
  origin,
});

describe("missing-entry counterpart eligibility", () => {
  it("declined counterpart cannot justify a new missing end", async () => {
    await completedDay();
    const start = await run((tx) =>
      backend.requestCorrection(tx, missing("in", "2026-01-06T09:00:00Z")),
    );
    await run((tx) =>
      backend.declineCorrection(tx, {
        nodeId,
        correctionId: start,
        actorPersonId: managerId,
        origin,
      }),
    );
    const before = await run((tx) => readChain(tx, { nodeId, locationId }));
    await expect(
      run((tx) => backend.requestCorrection(tx, missing("out", "2026-01-06T17:00:00Z"))),
    ).rejects.toMatchObject({ code: "correction.invalid" });
    expect(await run((tx) => readChain(tx, { nodeId, locationId }))).toEqual(before);
  });
  it("a still-pending counterpart permits the complementary missing end", async () => {
    await completedDay();
    const start = await run((tx) =>
      backend.requestCorrection(tx, missing("in", "2026-01-06T09:00:00Z")),
    );
    const end = await run((tx) =>
      backend.requestCorrection(tx, missing("out", "2026-01-06T17:00:00Z")),
    );
    expect(start).not.toBe(end);
    const record = await run((tx) =>
      backend.timeRecord(tx, {
        personId,
        period: { start: "2026-01-05", end: "2026-01-07" },
      }),
    );
    expect(record.sessions.map((s) => s.workedMinutes)).toEqual([480]);
    expect(
      record.entries
        .filter((e) => e.entry.correctionStatus === "requested")
        .map((e) => e.entry.entryId),
    ).toEqual([start, end]);
  });
});

const fact = (
  entryId: string,
  entryKind: TimeEntryRecord["entryKind"],
  eventAt: string,
  overrides: Partial<TimeEntryRecord> = {},
): TimeEntryRecord => ({
  entryId,
  entryKind,
  eventAt,
  recordedAt: "2026-01-07T12:00:00.000Z",
  offsetMinutes: 0,
  personId: "worker",
  locationId: "venue",
  nodeId: "node-a",
  sequenceNo: 1,
  recordedByPersonId: "worker",
  origin,
  extension: {
    authorKind: "worker",
    direction: null,
    missingEntryKind: null,
    respondsToEntryId: null,
    payPeriodClosureId: null,
  },
  ...overrides,
});
const originalIn = fact("in", "in", "2026-01-05T09:00:00.000Z");
const originalOut = fact("out", "out", "2026-01-05T17:00:00.000Z", { sequenceNo: 2 });
const requested = (
  entryId = "request",
  overrides: Partial<TimeEntryRecord> = {},
): TimeEntryRecord =>
  fact(entryId, "correction", "2026-01-05T18:00:00.000Z", {
    sequenceNo: 3,
    correctsEntryId: "out",
    correctionStatus: "requested",
    correctionReason: "Worked later",
    correctionActorId: "worker",
    extension: {
      authorKind: "worker",
      direction: "worker_request",
      missingEntryKind: null,
      respondsToEntryId: null,
      payPeriodClosureId: null,
    },
    ...overrides,
  });
const answered = (
  request: TimeEntryRecord,
  status: "approved" | "declined" | "disputed" = "approved",
  overrides: Partial<TimeEntryRecord> = {},
): TimeEntryRecord => ({
  ...request,
  entryId: "answer",
  correctionStatus: status,
  sequenceNo: 4,
  recordedByPersonId: "manager",
  extension: { ...request.extension!, authorKind: "manager", respondsToEntryId: request.entryId },
  ...overrides,
});
const missingRequest = (id: string, kind: "in" | "out" | "break_start" | "break_end", at: string) =>
  requested(id, {
    eventAt: at,
    correctsEntryId: null,
    extension: {
      authorKind: "worker",
      direction: "worker_request",
      missingEntryKind: kind,
      respondsToEntryId: null,
      payPeriodClosureId: null,
    },
  });
const bundle = (requests: TimeEntryRecord[]) => ({
  id: "command",
  requestedByPersonId: "worker",
  authorizedByPersonId: "worker",
  personId: "worker",
  locationId: "venue",
  questionId: null,
  action: "request",
  input: {
    action: "request",
    questionId: null,
    locationId: "venue",
    changes: requests.map((r) => ({
      target: { missingKind: r.extension!.missingEntryKind },
      at: r.eventAt,
      offsetMinutes: r.offsetMinutes,
    })),
    reason: "Worked later",
  },
  entryIds: requests.map((r) => r.entryId),
  createdAt: "2026-01-07T12:00:00.000Z",
});
const project = (entries: readonly TimeEntryRecord[], commands: readonly unknown[] = []) =>
  (
    api as unknown as {
      projectCorrectionItems?: (
        rows: readonly TimeEntryRecord[],
        receipts: readonly unknown[],
      ) => unknown;
    }
  ).projectCorrectionItems?.(entries, commands);

describe("actionable correction projection", () => {
  it("keeps a pending worker request with original and proposed facts", () => {
    const req = requested();
    expect(project([originalIn, originalOut, req])).toEqual([
      {
        id: "request",
        requestEntryIds: ["request"],
        personId: "worker",
        locationId: "venue",
        direction: "worker_request",
        status: "waiting-manager",
        readyToApply: true,
        responseEntryIds: [],
        changes: [{ target: { entryId: "out" }, at: "2026-01-05T18:00:00.000Z", offsetMinutes: 0 }],
        reason: "Worked later",
        requestedByPersonId: "worker",
        selfApproved: false,
        history: [originalOut, req],
      },
    ]);
  });
  it.each(["approved", "declined", "disputed"] as const)(
    "answered requested row is %s history",
    (status) => {
      const req = requested();
      expect(project([originalIn, originalOut, req, answered(req, status)])).toMatchObject([
        {
          id: "request",
          status,
          readyToApply: false,
          responseEntryIds: ["answer"],
          history: [originalOut, req, answered(req, status)],
        },
      ]);
    },
  );
  it("competing target is overtaken", () => {
    const req = requested();
    const rival = requested("rival");
    expect(project([originalIn, originalOut, req, rival, answered(rival)])).toMatchObject([
      { id: "request", status: "overtaken", readyToApply: false },
      { id: "rival", status: "approved", readyToApply: false },
    ]);
  });
  it("correction of approved correction remains actionable", () => {
    const req = requested();
    const answer = answered(req);
    const next = requested("next", {
      correctsEntryId: "answer",
      sequenceNo: 5,
      eventAt: "2026-01-05T19:00:00.000Z",
    });
    expect(project([originalIn, originalOut, req, answer, next])).toMatchObject([
      { id: "request", status: "approved" },
      {
        id: "next",
        status: "waiting-manager",
        readyToApply: true,
        history: [originalOut, req, answer, next],
      },
    ]);
  });
  it("later-node response wins independently of event date and input order", () => {
    const req = requested();
    const older = answered(req, "declined", {
      entryId: "older",
      eventAt: "2026-01-09T18:00:00.000Z",
    });
    const newer = answered(req, "approved", {
      entryId: "newer",
      nodeId: "node-b",
      sequenceNo: 1,
      eventAt: "2026-01-05T18:00:00.000Z",
    });
    expect(project([newer, req, originalOut, older, originalIn])).toMatchObject([
      {
        status: "approved",
        responseEntryIds: ["older", "newer"],
      },
    ]);
  });
  it("keeps a pending manager proposal for the worker", () => {
    const req = requested("proposal", {
      recordedByPersonId: "manager",
      extension: {
        ...requested().extension!,
        authorKind: "manager",
        direction: "manager_proposal",
      },
    });
    expect(project([originalIn, originalOut, req])).toMatchObject([
      {
        status: "waiting-worker",
        readyToApply: true,
        requestedByPersonId: "manager",
        direction: "manager_proposal",
      },
    ]);
  });
  it("retains stored self approval on its terminal item", () => {
    const req = requested();
    const response = answered(req, "approved", {
      extension: { ...answered(req).extension!, selfApproved: true },
    });
    expect(project([originalIn, originalOut, req, response])).toMatchObject([
      { selfApproved: true },
    ]);
  });
  it("paired missing item retains both ids and is ready before a later completed shift", () => {
    const start = missingRequest("missing-in", "in", "2026-01-04T09:00:00.000Z");
    const end = missingRequest("missing-out", "out", "2026-01-04T17:00:00.000Z");
    expect(project([originalIn, originalOut, start, end], [bundle([start, end])])).toMatchObject([
      {
        id: "command",
        requestEntryIds: ["missing-in", "missing-out"],
        status: "waiting-manager",
        readyToApply: true,
        history: [start, end],
      },
    ]);
  });
  it("historical missing break pair before a later break is ready", () => {
    const start = missingRequest("missing-break", "break_start", "2026-01-05T11:00:00.000Z");
    const end = missingRequest("missing-return", "break_end", "2026-01-05T11:30:00.000Z");
    const later = fact("later-break", "break_start", "2026-01-05T14:00:00.000Z");
    const returned = fact("later-return", "break_end", "2026-01-05T14:30:00.000Z");
    expect(
      project([originalIn, originalOut, later, returned, start, end], [bundle([start, end])]),
    ).toMatchObject([{ id: "command", readyToApply: true }]);
  });
  it("overlapping historical pair is not ready", () => {
    const start = missingRequest("missing-in", "in", "2026-01-05T10:00:00.000Z");
    const end = missingRequest("missing-out", "out", "2026-01-05T16:00:00.000Z");
    expect(project([originalIn, originalOut, start, end], [bundle([start, end])])).toMatchObject([
      { id: "command", readyToApply: false, status: "waiting-manager" },
    ]);
  });
  it("partial legacy pair exposes terminal and remaining singleton items", () => {
    const start = missingRequest("missing-in", "in", "2026-01-04T09:00:00.000Z");
    const end = missingRequest("missing-out", "out", "2026-01-04T17:00:00.000Z");
    expect(
      project([originalIn, originalOut, start, end, answered(start)], [bundle([start, end])]),
    ).toMatchObject([
      { id: "missing-in", status: "approved" },
      { id: "missing-out", status: "waiting-manager", readyToApply: true },
    ]);
  });
  it("missing out alone is not ready but remains waiting for a manager", () => {
    const end = missingRequest("missing-out", "out", "2026-01-04T17:00:00.000Z");
    expect(project([originalIn, originalOut, end])).toMatchObject([
      {
        id: "missing-out",
        status: "waiting-manager",
        readyToApply: false,
      },
    ]);
  });
  it("ignores unrelated subject responses and retains inputs unchanged", () => {
    const req = requested();
    const other = answered(req, "approved", { personId: "other", locationId: "elsewhere" });
    const entries = [other, req, originalOut, originalIn];
    const before = structuredClone(entries);
    expect(project(entries)).toMatchObject([
      {
        id: "request",
        status: "waiting-manager",
        readyToApply: true,
        responseEntryIds: [],
        history: [originalOut, req],
      },
    ]);
    expect(entries).toEqual(before);
  });
});

describe("complete correction group boundaries", () => {
  it("keeps a full terminal bundle together with each response id", () => {
    const start = missingRequest("missing-in", "in", "2026-01-04T09:00:00.000Z");
    const end = missingRequest("missing-out", "out", "2026-01-04T17:00:00.000Z");
    const a = answered(start, "approved", { entryId: "response-in" });
    const b = answered(end, "approved", { entryId: "response-out" });
    expect(
      project([originalIn, originalOut, start, end, a, b], [bundle([start, end])]),
    ).toMatchObject([
      {
        id: "command",
        status: "approved",
        readyToApply: false,
        responseEntryIds: ["response-in", "response-out"],
      },
    ]);
  });
  it.each([
    "decision",
    "single",
    "duplicate",
    "missing",
    "person",
    "location",
    "assigned",
  ] as const)("does not invent a bundle from an inapplicable %s receipt", (kind) => {
    const start = missingRequest("missing-in", "in", "2026-01-04T09:00:00.000Z");
    const end = missingRequest("missing-out", "out", "2026-01-04T17:00:00.000Z");
    const command = bundle([start, end]);
    if (kind === "decision") command.action = "approve";
    if (kind === "single") command.entryIds = [start.entryId];
    if (kind === "duplicate") command.entryIds = [start.entryId, start.entryId];
    if (kind === "missing") command.entryIds = [start.entryId, "absent"];
    if (kind === "person") command.personId = "another";
    if (kind === "location") command.locationId = "another";
    const commands =
      kind === "assigned" ? [command, { ...command, id: "duplicate-command" }] : [command];
    const result = project([originalIn, originalOut, start, end], commands);
    if (kind === "assigned") expect(result).toMatchObject([{ id: "command" }]);
    else expect(result).toMatchObject([{ id: "missing-in" }, { id: "missing-out" }]);
  });
  it.each([
    "empty",
    "three",
    "duplicate",
    "ordinary",
    "approved",
    "subject",
    "location",
    "direction",
    "answered",
    "mixed",
    "same-time",
    "invalid-pair",
    "missing-target",
    "missing-kind",
  ] as const)("refuses an inapplicable %s group without altering history", (kind) => {
    const req = requested();
    const entries = [originalIn, originalOut, req];
    let requests: TimeEntryRecord[] = [req];
    if (kind === "empty") requests = [];
    if (kind === "three") requests = [req, requested("two"), requested("three")];
    if (kind === "duplicate") requests = [req, req];
    if (kind === "ordinary") requests = [originalOut];
    if (kind === "approved") requests = [answered(req)];
    if (kind === "subject") requests = [req, requested("two", { personId: "other" })];
    if (kind === "location") requests = [req, requested("two", { locationId: "other" })];
    if (kind === "direction")
      requests = [
        req,
        requested("two", {
          extension: { ...req.extension!, direction: "manager_proposal" },
        }),
      ];
    if (kind === "answered") entries.push(answered(req));
    if (kind === "mixed")
      requests = [req, missingRequest("extra", "out", "2026-01-06T17:00:00.000Z")];
    if (kind === "same-time")
      requests = [
        missingRequest("one", "in", "2026-01-04T09:00:00.000Z"),
        missingRequest("two", "out", "2026-01-04T09:00:00.000Z"),
      ];
    if (kind === "invalid-pair")
      requests = [
        missingRequest("one", "in", "2026-01-04T09:00:00.000Z"),
        missingRequest("two", "break_end", "2026-01-04T17:00:00.000Z"),
      ];
    if (kind === "missing-target") requests = [requested("one", { correctsEntryId: "absent" })];
    if (kind === "missing-kind") requests = [requested("one", { correctsEntryId: null })];
    const before = structuredClone(entries);
    expect(correctionGroupCanApply(entries, requests)).toBe(false);
    expect(entries).toEqual(before);
  });
});
