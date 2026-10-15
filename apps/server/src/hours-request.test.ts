import { expect, it } from "vitest";
import * as request from "./hours-request.js";

const id = "3ccccccc-cccc-4ccc-8ccc-cccccccccccc";
function query(raw: string, mode: "own" | "manager" = "own") {
  expect(request).toHaveProperty("parseHoursQuery", expect.any(Function));
  return request.parseHoursQuery(new URLSearchParams(raw), mode);
}
it.each(["week", "month"])("reads the exact own %s scope without inventing a date", (kind) => {
  expect(query(`locationId=${id.toUpperCase()}&kind=${kind}`)).toEqual({
    locationId: id,
    selection: { kind },
  });
  expect(query(`locationId=${id}&kind=${kind}&date=2024-02-29`)).toEqual({
    locationId: id,
    selection: { kind, date: "2024-02-29" },
  });
});
it("accepts only the manager pay-period view", () => {
  expect(query(`locationId=${id}&kind=pay-period&date=2026-01-05`, "manager")).toEqual({
    locationId: id,
    selection: { kind: "pay-period", date: "2026-01-05" },
  });
});
it.each([
  "",
  `locationId=${id}`,
  "locationId=&kind=week",
  "locationId=nope&kind=week",
  `locationId=${id}&kind=`,
  `locationId=${id}&kind=pay-period`,
  `locationId=${id}&kind=weekly`,
  `locationId=${id}&kind=week&date=`,
  `locationId=${id}&kind=month&date=2026-02-30`,
  `locationId=${id}&kind=week&date=2026-1-5`,
  `locationId=${id}&kind=week&date=2026-01-05&date=2026-01-05`,
  `locationId=${id}&kind=week&kind=month`,
  `locationId=${id}&locationId=${id}&kind=week`,
  `locationId=${id}&kind=week&personId=${id}`,
  `locationId=${id}&kind=week&extra=x`,
])("refuses a malformed or widened own hours query %#", (raw) => {
  expect(() => query(raw)).toThrow(expect.objectContaining({ code: "management.request_invalid" }));
});
it.each(["week", "month", ""])("manager refuses %s", (kind) => {
  expect(() => query(`locationId=${id}&kind=${kind}`, "manager")).toThrow(
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
    locationId: id,
    changes: [change],
    reason: "Forgot",
  },
  { ...base, action: "accept", itemId: id },
  { ...base, action: "disagree", itemId: id, reason: "I left at five" },
])("keeps the existing own $action contract", (value) => expect(parse(value)).toEqual(value));
it.each([
  { ...base, action: "approve", itemId: id },
  { ...base, action: "decline", itemId: id },
  { ...base, action: "propose", personId: id, locationId: id, changes: [change], reason: "Check" },
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
