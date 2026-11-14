import { expect, it } from "vitest";
import * as request from "./hours-request.js";

const id = "3ccccccc-cccc-4ccc-8ccc-cccccccccccc";
function query(raw: string, mode: "own" | "manager" = "own") {
  expect(request).toHaveProperty("parseHoursQuery", expect.any(Function));
  return request.parseHoursQuery(new URLSearchParams(raw), mode);
}
it.each(["week", "month"])("reads the exact own %s scope without inventing a date", (kind) => {
  expect(query(`kind=${kind}`)).toEqual({ selection: { kind } });
  expect(query(`kind=${kind}&date=2024-02-29`)).toEqual({
    selection: { kind, date: "2024-02-29" },
  });
  expect(() => query(`extra=${id}&kind=${kind}`)).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
});
it("accepts only the manager pay-period view", () => {
  expect(query(`kind=pay-period&date=2026-01-05`, "manager")).toEqual({
    selection: { kind: "pay-period", date: "2026-01-05" },
  });
});
it.each([
  "",
  `extra=${id}`,
  "extra=&kind=week",
  "extra=nope&kind=week",
  `kind=`,
  `kind=pay-period`,
  `kind=weekly`,
  `kind=week&date=`,
  `kind=month&date=2026-02-30`,
  `kind=week&date=2026-1-5`,
  `kind=week&date=2026-01-05&date=2026-01-05`,
  `kind=week&kind=month`,
  `extra=${id}&extra=${id}&kind=week`,
  `kind=week&personId=${id}`,
  `kind=week&extra=x`,
])("refuses a malformed or widened own hours query %#", (raw) => {
  expect(() => query(raw)).toThrow(expect.objectContaining({ code: "management.request_invalid" }));
});
it.each(["week", "month", ""])("manager refuses %s", (kind) => {
  expect(() => query(`kind=${kind}`, "manager")).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
});
function parse(value: unknown) {
  expect(request).toHaveProperty("parseOwnAttendanceCommand", expect.any(Function));
  return request.parseOwnAttendanceCommand(value);
}
const base = { commandId: id, expectedRevision: "revision" };
const change = { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 0 };
it.each([
  { ...base, action: "confirm", questionId: id },
  {
    ...base,
    action: "request",
    questionId: null,
    changes: [change],
    reason: "Forgot",
  },
  { ...base, action: "accept", itemId: id },
  { ...base, action: "disagree", itemId: id, reason: "I left at five" },
])("keeps the existing own $action contract", (value) => expect(parse(value)).toEqual(value));
it.each([
  { ...base, action: "approve", itemId: id },
  { ...base, action: "decline", itemId: id },
  { ...base, action: "propose", personId: id, changes: [change], reason: "Check" },
  { ...base, action: "confirm", questionId: id, override: { personId: id, pin: "1234" } },
  { ...base, action: "confirm", questionId: id, personId: id },
  { ...base, action: "accept", itemId: id, authorizedByPersonId: id },
  { ...base, action: "disagree", itemId: id, reason: "" },
  null,
])("refuses manager authority, attribution or malformed own command %#", (value) => {
  expect(() => parse(value)).toThrow(
    expect.objectContaining({ code: "management.request_invalid" }),
  );
});
