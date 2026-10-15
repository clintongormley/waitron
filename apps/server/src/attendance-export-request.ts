import "./errors.js";
import { AppError } from "@waitron/shared";
import { requireBodyUuid, requirePeriod } from "@waitron/server-kit";
import type { AttendanceExportSelection } from "@waitron/workforce/attendance-contract";

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}
function exactKeys(query: URLSearchParams, required: string[], optional: string[] = []) {
  if (required.some((key) => !query.has(key))) invalid("query");
  for (const key of query.keys())
    if (![...required, ...optional].includes(key) || query.getAll(key).length !== 1)
      invalid("query");
}
export function parseAttendanceExportQuery(
  query: URLSearchParams,
  mode: "own" | "manager",
): { selection: AttendanceExportSelection; personId?: string } {
  exactKeys(
    query,
    ["locationId", "from", "before", "format", "audience", "locale"],
    mode === "manager" ? ["personId"] : [],
  );
  const locationId = requireBodyUuid(query.get("locationId"), "locationId").toLowerCase();
  const from = requirePeriod(query.get("from"), "from"),
    before = requirePeriod(query.get("before"), "before");
  if (from >= before) invalid("range");
  const format = query.get("format");
  if (format !== "csv" && format !== "pdf") invalid("format");
  const audience = query.get("audience");
  if (audience !== "standard" && audience !== "representatives") invalid("audience");
  const locale = query.get("locale");
  if (locale !== "en" && locale !== "es") invalid("locale");
  return {
    selection: { locationId, from, before, format, audience, locale },
    ...(query.has("personId")
      ? { personId: requireBodyUuid(query.get("personId"), "personId").toLowerCase() }
      : {}),
  };
}
export function parseAttendanceExportOptions(query: URLSearchParams): string {
  exactKeys(query, ["locationId"]);
  return requireBodyUuid(query.get("locationId"), "locationId").toLowerCase();
}
