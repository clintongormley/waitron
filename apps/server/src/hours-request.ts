import "./errors.js";
import { AppError } from "@waitron/shared";
import { requireBodyUuid, requirePeriod } from "@waitron/server-kit";
import type { HoursSelection, OwnAttendanceCommand } from "@waitron/workforce/attendance-contract";
import { parseAttendanceCommand } from "./attendance-request.js";

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}
export function parseHoursQuery(
  query: URLSearchParams,
  mode: "own" | "manager",
): { locationId: string; selection: HoursSelection } {
  const keys = query.has("date") ? ["locationId", "kind", "date"] : ["locationId", "kind"];
  if (query.size !== keys.length || keys.some((key) => !query.has(key))) invalid("query");
  const locationId = requireBodyUuid(query.get("locationId"), "locationId").toLowerCase();
  const kind = query.get("kind");
  if (mode === "manager" ? kind !== "pay-period" : kind !== "week" && kind !== "month")
    invalid("kind");
  const selection: HoursSelection = { kind: kind as HoursSelection["kind"] };
  if (query.has("date")) selection.date = requirePeriod(query.get("date"), "date");
  return { locationId, selection };
}
export function parseOwnAttendanceCommand(value: unknown): OwnAttendanceCommand {
  const command = parseAttendanceCommand(value, "worker");
  if (command.action === "approve" || command.action === "decline") invalid("action");
  return command as OwnAttendanceCommand;
}
