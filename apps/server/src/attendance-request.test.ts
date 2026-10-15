import { expect, it } from "vitest";
import * as request from "./attendance-request.js";
import type { AttendanceCommand } from "@waitron/workforce/attendance-contract";

const commandId = "1aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const questionId = "2bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const locationId = "3ccccccc-cccc-4ccc-8ccc-cccccccccccc";
const personId = "4ddddddd-dddd-4ddd-8ddd-dddddddddddd";
const itemId = "5eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const revision = "r-opaque-revision";
const base = { commandId, expectedRevision: revision };
const change = { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 };
const workerRequest = {
  ...base,
  action: "request",
  questionId: null,
  locationId,
  changes: [change],
  reason: "Forgot",
};
function single<T>(values: readonly T[]): [T][] {
  return values.map((value) => [value]);
}
function parse(value: unknown, mode: "worker" | "manager" = "worker"): AttendanceCommand {
  expect(request).toHaveProperty("parseAttendanceCommand", expect.any(Function));
  return request.parseAttendanceCommand(value, mode);
}
function invalid(value: unknown, mode: "worker" | "manager" = "worker") {
  expect(() => parse(value, mode)).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
}

it.each(
  single([
    { ...base, action: "confirm", questionId },
    workerRequest,
    { ...base, action: "accept", itemId },
    { ...base, action: "disagree", itemId, reason: "Not my time" },
    { ...base, action: "approve", itemId },
    { ...base, action: "decline", itemId },
  ]),
)("parses worker action $action without accepting attribution", (value) => {
  expect(parse(value)).toEqual(value);
});
it.each(
  single([
    { ...base, action: "propose", personId, locationId, changes: [change], reason: "Please check" },
    { ...base, action: "approve", itemId },
    { ...base, action: "decline", itemId },
  ]),
)("parses manager action $action", (value) => {
  expect(parse(value, "manager")).toEqual(value);
});
it("normalizes UUID spellings and trims the reason without changing the chosen instant or offset", () => {
  expect(
    parse({
      ...workerRequest,
      commandId: commandId.toUpperCase(),
      locationId: locationId.toUpperCase(),
      questionId: questionId.toUpperCase(),
      changes: [
        {
          target: { entryId: itemId.toUpperCase() },
          at: "2026-10-25T02:30:00+02:00",
          offsetMinutes: 120,
        },
      ],
      reason: "  Earlier repeated hour  ",
    }),
  ).toEqual({
    ...workerRequest,
    questionId,
    changes: [{ target: { entryId: itemId }, at: "2026-10-25T02:30:00+02:00", offsetMinutes: 120 }],
    reason: "Earlier repeated hour",
  });
});
it.each(
  single([
    "actorPersonId",
    "requestedByPersonId",
    "authorizedByPersonId",
    "nodeId",
    "origin",
    "recordedAt",
    "personId",
    "override",
    "unexpected",
  ]),
)("refuses forged or extra %s", (key) => invalid({ ...workerRequest, [key]: personId }));
it.each(
  single([
    null,
    [],
    "request",
    7,
    true,
    {},
    { ...workerRequest, action: ["request"] },
    { ...workerRequest, action: null },
    { ...workerRequest, action: "propose", personId },
    { ...workerRequest, action: "approve" },
  ]),
)("refuses a malformed worker envelope %#", (value) => invalid(value));
it.each(single(["confirm", "request", "accept", "disagree"]))(
  "manager mode refuses worker action %s",
  (action) =>
    invalid(
      action === "request"
        ? workerRequest
        : action === "confirm"
          ? { ...base, action, questionId }
          : { ...base, action, itemId, ...(action === "disagree" ? { reason: "No" } : {}) },
      "manager",
    ),
);
it.each(single([undefined, null, [], 12, "", "not-a-uuid"]))(
  "requires a command UUID %#",
  (command) => invalid({ ...workerRequest, commandId: command }),
);
it.each(single([undefined, null, [], 12, ""]))(
  "requires an opaque revision %#",
  (expectedRevision) => invalid({ ...workerRequest, expectedRevision }),
);
it.each(single([undefined, null, [], 12, "", "not-a-uuid"]))(
  "requires a location UUID %#",
  (location) => invalid({ ...workerRequest, locationId: location }),
);
it.each(single([undefined, [], "", "not-a-uuid"]))(
  "requires explicit null or UUID question %#",
  (question) => invalid({ ...workerRequest, questionId: question }),
);
it.each(single([null, [], "", "not-a-uuid"]))("requires an item UUID %#", (item) =>
  invalid({ ...base, action: "accept", itemId: item }),
);
it.each(single([null, [], 12, "", "  ", "a".repeat(501)]))(
  "refuses an invalid reason %#",
  (reason) => invalid({ ...workerRequest, reason }),
);
it.each(single([null, [], 12, "", "  ", "a".repeat(501)]))(
  "disagreement requires a reason %#",
  (reason) => invalid({ ...base, action: "disagree", itemId, reason }),
);
it("allows the full 500-character reason", () =>
  expect(parse({ ...workerRequest, reason: "a".repeat(500) }).action).toBe("request"));
it.each(single([null, {}, "in", [], [change, change, change]]))(
  "refuses an invalid change array %#",
  (changes) => invalid({ ...workerRequest, changes }),
);
it.each(
  single([
    null,
    [],
    {},
    { ...change, target: null },
    { ...change, target: [] },
    { ...change, target: {} },
    { ...change, target: { missingKind: ["in"] } },
    { ...change, target: { missingKind: "clock-in" } },
    { ...change, target: { missingKind: "in", entryId: itemId } },
    { ...change, target: { entryId: itemId, other: true } },
    { ...change, target: { entryId: null } },
    { ...change, recordedByPersonId: personId },
  ]),
)("refuses a malformed or forged change %#", (value) =>
  invalid({ ...workerRequest, changes: [value] }),
);
it.each(
  single([
    null,
    [],
    "2026-02-30T09:00:00Z",
    "2026-01-05",
    "2026-01-05T09:00:00",
    "2026-01-05T25:00:00Z",
    "2026-01-05T09:00:00+24:00",
  ]),
)("refuses an impossible or ambiguous instant %#", (at) =>
  invalid({ ...workerRequest, changes: [{ ...change, at }] }),
);
it.each(single([null, [], "60", 0.5, 841, -841, Number.NaN, Number.POSITIVE_INFINITY]))(
  "refuses an invalid offset %#",
  (offsetMinutes) => invalid({ ...workerRequest, changes: [{ ...change, offsetMinutes }] }),
);
it.each(single([-840, 0, 840]))("retains the valid offset %s", (offsetMinutes) =>
  expect(parse({ ...workerRequest, changes: [{ ...change, offsetMinutes }] })).toMatchObject({
    changes: [{ offsetMinutes }],
  }),
);
it.each(
  single([
    ["in", "out"],
    ["break_start", "break_end"],
  ]),
)("allows chronological complementary missing pair %#", ([start, end]) => {
  const value = {
    ...workerRequest,
    changes: [
      { ...change, target: { missingKind: start } },
      { ...change, at: "2026-01-05T17:00:00Z", target: { missingKind: end } },
    ],
  };
  expect(parse(value)).toEqual(value);
});
it.each(
  single([
    [
      { ...change, target: { missingKind: "in" } },
      { ...change, at: "2026-01-05T17:00:00Z", target: { missingKind: "in" } },
    ],
    [
      { ...change, target: { missingKind: "out" } },
      { ...change, at: "2026-01-05T17:00:00Z", target: { missingKind: "in" } },
    ],
    [
      { ...change, target: { missingKind: "in" } },
      { ...change, at: "2026-01-05T17:00:00Z", target: { missingKind: "break_end" } },
    ],
    [
      { ...change, target: { entryId: itemId } },
      { ...change, at: "2026-01-05T17:00:00Z", target: { missingKind: "out" } },
    ],
    [
      { ...change, target: { entryId: itemId } },
      { ...change, at: "2026-01-05T17:00:00Z", target: { entryId: questionId } },
    ],
    [change, { ...change, target: { missingKind: "out" } }],
    [change, { ...change, at: "2026-01-05T08:00:00Z", target: { missingKind: "out" } }],
  ]),
)("refuses duplicate, mixed or unordered pair %#", (changes) =>
  invalid({ ...workerRequest, changes }),
);
it("orders repeated-hour choices by their instants without guessing the offset", () => {
  const value = {
    ...workerRequest,
    changes: [
      { target: { missingKind: "in" }, at: "2026-10-25T02:30:00+02:00", offsetMinutes: 120 },
      { target: { missingKind: "out" }, at: "2026-10-25T02:15:00+01:00", offsetMinutes: 60 },
    ],
  };
  expect(parse(value)).toEqual(value);
  invalid({ ...value, changes: [...value.changes].reverse() });
});

function query(value: string, mode: "worker" | "manager" = "worker") {
  expect(request).toHaveProperty("parseAttendanceDayQuery", expect.any(Function));
  return request.parseAttendanceDayQuery(new URLSearchParams(value), mode);
}
it("parses exact worker and manager day scopes with normalized identifiers", () => {
  expect(query(`date=2026-02-28&locationId=${locationId.toUpperCase()}`)).toEqual({
    date: "2026-02-28",
    locationId,
  });
  expect(query(`date=2026-02-28&locationId=${locationId}&personId=${personId}`, "manager")).toEqual(
    { date: "2026-02-28", locationId, personId },
  );
});
it.each(
  single([
    "",
    `date=2026-02-30&locationId=${locationId}`,
    `date=2026-2-8&locationId=${locationId}`,
    `date=2026-02-28&locationId=`,
    `date=2026-02-28&locationId=nope`,
    `date=2026-02-28&locationId=${locationId}&personId=${personId}`,
    `date=2026-02-28&locationId=${locationId}&date=2026-02-28`,
    `date=2026-02-28&locationId=${locationId}&locationId=${locationId}`,
    `date=2026-02-28&locationId=${locationId}&nodeId=${personId}`,
  ]),
)("refuses a malformed or widened worker day scope %#", (value) => {
  expect(() => query(value)).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
});
it.each(
  single([
    `date=2026-02-28&locationId=${locationId}`,
    `date=2026-02-28&locationId=${locationId}&personId=`,
    `date=2026-02-28&locationId=${locationId}&personId=nope`,
    `date=2026-02-28&locationId=${locationId}&personId=${personId}&personId=${personId}`,
  ]),
)("refuses an absent or duplicated manager subject %#", (value) => {
  expect(() => query(value, "manager")).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
});
it("requires an exact location-only scope for a manager queue", () => {
  expect(request).toHaveProperty("parseAttendanceLocationQuery", expect.any(Function));
  expect(
    request.parseAttendanceLocationQuery(
      new URLSearchParams(`locationId=${locationId.toUpperCase()}`),
    ),
  ).toEqual({ locationId });
  for (const value of [
    "",
    `locationId=${locationId}&personId=${personId}`,
    `locationId=${locationId}&locationId=${locationId}`,
  ]) {
    expect(() => request.parseAttendanceLocationQuery(new URLSearchParams(value))).toThrow(
      expect.objectContaining({ code: "management.request_invalid" }),
    );
  }
});

it.each(single([null, [], "", "not-a-uuid"]))(
  "requires a manager proposal subject %#",
  (person) => {
    invalid(
      {
        ...base,
        action: "propose",
        personId: person,
        locationId,
        changes: [change],
        reason: "Check time",
      },
      "manager",
    );
  },
);
it("does not accept null for a confirmation target", () =>
  invalid({ ...base, action: "confirm", questionId: null }));
it("does not allow an extra field to replace a required field", () => {
  invalid({
    ...base,
    action: "request",
    locationId,
    changes: [change],
    reason: "Forgot",
    actorPersonId: personId,
  });
  expect(() => query(`date=2026-02-28&actorPersonId=${personId}`)).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
});
it.each(
  single([
    { ...base, action: "confirm", questionId },
    { ...base, action: "accept", itemId },
    { ...base, action: "disagree", itemId, reason: "No" },
    { ...base, action: "approve", itemId },
    { ...base, action: "decline", itemId },
  ]),
)("refuses attribution on every response action %#", (value) =>
  invalid({ ...value, actorPersonId: personId }),
);
it("refuses an unparseable month even with a timestamp-shaped value", () =>
  invalid({ ...workerRequest, changes: [{ ...change, at: "2026-13-05T09:00:00Z" }] }));
it("worker mode refuses a well-formed manager proposal", () =>
  invalid({
    ...base,
    action: "propose",
    personId,
    locationId,
    changes: [change],
    reason: "Check time",
  }));
