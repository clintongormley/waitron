import { AppError, isUuid } from "@waitron/shared";
import { validateFindBillRange } from "./find-bill-dates.js";
import type {
  BillsQuery,
  FindBillDates,
  FindBillQuery,
  TransactionsQuery,
} from "./find-bill-types.js";
import "./errors.js";

const common = ["q", "page", "sort", "direction", "staffId"];
const billSorts = ["openedAt", "tableName", "zone", "staff", "items", "total", "paid", "state"];
const transactionSorts = ["when", "invoice", "type", "tableName", "method", "staff", "amount"];
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
function base(
  params: URLSearchParams,
  sorts: readonly string[],
  defaultSort: string,
): FindBillQuery {
  const q = params.get("q") ?? "";
  if (q.trim().length > 100) invalid("q");
  const rawPage = params.get("page");
  const page = rawPage === null ? 0 : Number(rawPage);
  if ((rawPage !== null && !/^\d+$/.test(rawPage)) || !Number.isSafeInteger(page * 50))
    invalid("page");
  const staffId = uuid(params, "staffId");
  return {
    q: q.trim() === "" ? "" : q.trimStart(),
    page,
    sort: {
      key: choice(params, "sort", sorts) ?? defaultSort,
      direction: choice(params, "direction", ["ascending", "descending"]) ?? "descending",
    },
    ...(staffId === undefined ? {} : { staffId }),
  };
}
export function parseBillsQuery(params: URLSearchParams): BillsQuery {
  checkKeys(params, [...common, "zoneId", "state"]);
  const zoneId = uuid(params, "zoneId");
  const state = choice(params, "state", ["unpaid", "held", "part-paid", "paid-not-handed-over"]);
  return {
    ...base(params, billSorts, "openedAt"),
    ...(zoneId === undefined ? {} : { zoneId }),
    ...(state === undefined ? {} : { state }),
  };
}
export function parseTransactionsQuery(params: URLSearchParams): TransactionsQuery {
  checkKeys(params, [...common, "preset", "from", "to", "method", "type"]);
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
  const method = choice(params, "method", ["cash", "card", "voucher", "transfer", "other"]);
  const type = choice(params, "type", ["sale", "full-invoice", "correction", "refund"]);
  return {
    ...base(params, transactionSorts, "when"),
    dates,
    ...(method === undefined ? {} : { method }),
    ...(type === undefined ? {} : { type }),
  };
}
