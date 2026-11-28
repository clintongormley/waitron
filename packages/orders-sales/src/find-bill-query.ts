import { AppError, isUuid } from "@waitron/shared";
import { validateFindBillRange } from "./find-bill-dates.js";
import type {
  BillsQuery,
  FindBillDates,
  FindBillQuery,
  TransactionsQuery,
} from "./find-bill-types.js";

export const FILTER_TEXT_MAX = 100;

const common = ["q", "page", "staffId"];
const billSorts = ["openedAt", "tableName", "zone", "staff", "items", "total", "paid", "state"];
function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

function checkKeys(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalid(key);
  }
}
function choice<const T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = params.get(key);
  if (value === null) return undefined;
  if (!allowed.includes(value as T)) invalid(key);
  return value as T;
}
function uuid(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  if (value === null) return undefined;
  if (!isUuid(value)) invalid(key);
  return value.toLowerCase();
}
function base(params: URLSearchParams): FindBillQuery {
  const q = params.get("q") ?? "";
  if (q.trim().length > FILTER_TEXT_MAX) invalid("q");
  const rawPage = params.get("page");
  const page = rawPage === null ? 0 : Number(rawPage);
  if ((rawPage !== null && !/^\d+$/.test(rawPage)) || !Number.isSafeInteger(page * 50))
    invalid("page");
  const staffId = uuid(params, "staffId");
  return {
    q: q.trim() === "" ? "" : q.trimStart(),
    page,
    ...(staffId === undefined ? {} : { staffId }),
  };
}
export function parseBillsQuery(params: URLSearchParams): BillsQuery {
  checkKeys(params, [...common, "sort", "direction", "owed", "counter"]);
  const owed = choice(params, "owed", ["true"]);
  const counter = choice(params, "counter", ["true"]);
  return {
    ...base(params),
    sort: {
      key: choice(params, "sort", billSorts) ?? "openedAt",
      direction: choice(params, "direction", ["ascending", "descending"]) ?? "descending",
    },
    ...(owed === undefined ? {} : { owed: true }),
    ...(counter === undefined ? {} : { counter: true }),
  };
}
export function parseTransactionsQuery(params: URLSearchParams): TransactionsQuery {
  checkKeys(params, [...common, "preset", "from", "to", "type"]);
  const preset =
    choice(params, "preset", [
      "today",
      "yesterday",
      "business-day",
      "last-7-days",
      "this-month",
      "custom",
      "any",
    ]) ?? "today";
  let dates: FindBillDates;
  if (preset === "custom") {
    const from = params.get("from");
    const to = params.get("to");
    if (from === null) invalid("from");
    if (to === null) invalid("to");
    validateFindBillRange(from, to);
    dates = { preset, from, to };
  } else {
    if (params.has("from")) invalid("from");
    if (params.has("to")) invalid("to");
    dates = { preset };
  }
  const type = choice(params, "type", [
    "sale",
    "full-invoice",
    "correction",
    "full-correction",
    "replacement",
    "refund",
    "corrective",
  ]);
  return {
    ...base(params),
    dates,
    ...(type === undefined ? {} : { type }),
  };
}
