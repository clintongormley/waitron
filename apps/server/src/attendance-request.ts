import "./errors.js";
import { AppError } from "@waitron/shared";
import { requireBodyUuid, requirePeriod } from "@waitron/server-kit";
import type { AttendanceChange, AttendanceCommand } from "@waitron/workforce/attendance-contract";

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}
function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  if (
    Object.keys(value).length !== allowed.length ||
    allowed.some((key) => !Object.hasOwn(value, key))
  )
    invalid(field);
}
function uuid(value: unknown, field: string): string {
  return requireBodyUuid(value, field).toLowerCase();
}
function reason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 500)
    invalid("reason");
  return value.trim();
}
function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    invalid("at");
  requirePeriod(value.slice(0, 10), "at");
  return value;
}
function changes(value: unknown): AttendanceChange[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) invalid("changes");
  const result = value.map((raw: unknown): AttendanceChange => {
    const item = object(raw, "changes");
    keys(item, ["target", "at", "offsetMinutes"], "changes");
    const target = object(item.target, "target");
    let parsed: AttendanceChange["target"];
    if (Object.hasOwn(target, "entryId")) {
      keys(target, ["entryId"], "target");
      parsed = { entryId: uuid(target.entryId, "entryId") };
    } else {
      keys(target, ["missingKind"], "target");
      const kind = target.missingKind;
      if (kind !== "in" && kind !== "out" && kind !== "break_start" && kind !== "break_end")
        invalid("missingKind");
      parsed = { missingKind: kind };
    }
    const offset = item.offsetMinutes;
    if (typeof offset !== "number" || !Number.isInteger(offset) || Math.abs(offset) > 840)
      invalid("offsetMinutes");
    return { target: parsed, at: instant(item.at), offsetMinutes: offset };
  });
  if (result.length === 2) {
    const [first, last] = result as [AttendanceChange, AttendanceChange];
    if (
      !("missingKind" in first.target) ||
      !("missingKind" in last.target) ||
      !(
        (first.target.missingKind === "in" && last.target.missingKind === "out") ||
        (first.target.missingKind === "break_start" && last.target.missingKind === "break_end")
      ) ||
      Date.parse(first.at) >= Date.parse(last.at)
    )
      invalid("changes");
  }
  return result;
}
export function parseAttendanceCommand(
  value: unknown,
  mode: "worker" | "manager",
): AttendanceCommand {
  const body = object(value, "command");
  const commandId = uuid(body.commandId, "commandId");
  if (typeof body.expectedRevision !== "string" || body.expectedRevision.length === 0)
    invalid("expectedRevision");
  const base = { commandId, expectedRevision: body.expectedRevision };
  const action = body.action;
  if (mode === "manager" && action !== "propose" && action !== "approve" && action !== "decline")
    invalid("action");
  if (mode === "worker" && action === "propose") invalid("action");
  if (action === "confirm") {
    keys(body, ["commandId", "expectedRevision", "action", "questionId"], "command");
    return { ...base, action, questionId: uuid(body.questionId, "questionId") };
  }
  if (action === "request" || action === "propose") {
    keys(
      body,
      [
        "commandId",
        "expectedRevision",
        "action",
        action === "request" ? "questionId" : "personId",
        "locationId",
        "changes",
        "reason",
      ],
      "command",
    );
    const common = {
      ...base,
      locationId: uuid(body.locationId, "locationId"),
      changes: changes(body.changes),
      reason: reason(body.reason),
    };
    return action === "request"
      ? {
          ...common,
          action,
          questionId: body.questionId === null ? null : uuid(body.questionId, "questionId"),
        }
      : { ...common, action, personId: uuid(body.personId, "personId") };
  }
  if (
    action === "approve" ||
    action === "decline" ||
    action === "accept" ||
    action === "disagree"
  ) {
    keys(
      body,
      [
        "commandId",
        "expectedRevision",
        "action",
        "itemId",
        ...(action === "disagree" ? ["reason"] : []),
      ],
      "command",
    );
    const common = { ...base, itemId: uuid(body.itemId, "itemId") };
    return action === "disagree"
      ? { ...common, action, reason: reason(body.reason) }
      : { ...common, action };
  }
  return invalid("action");
}

function queryKeys(value: URLSearchParams, allowed: readonly string[]): void {
  if (value.size !== allowed.length || allowed.some((key) => !value.has(key))) invalid("query");
}
export function parseAttendanceDayQuery(
  value: URLSearchParams,
  mode: "worker" | "manager",
): { date: string; locationId: string; personId?: string } {
  queryKeys(
    value,
    mode === "manager" ? ["date", "locationId", "personId"] : ["date", "locationId"],
  );
  const common = {
    date: requirePeriod(value.get("date"), "date"),
    locationId: uuid(value.get("locationId"), "locationId"),
  };
  return mode === "manager"
    ? { ...common, personId: uuid(value.get("personId"), "personId") }
    : common;
}
export function parseAttendanceLocationQuery(value: URLSearchParams): { locationId: string } {
  queryKeys(value, ["locationId"]);
  return { locationId: uuid(value.get("locationId"), "locationId") };
}
