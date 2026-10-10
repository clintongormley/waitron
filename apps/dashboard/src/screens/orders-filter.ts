import { ORDER_STATUS_FILTERS, type OrderStatusFilter, type OrdersQuery } from "../api/client.js";

export type OrdersFilter = OrdersQuery;
export const DEFAULT_ORDERS_FILTER: OrdersFilter = {
  status: "all",
  anyDate: false,
  credited: false,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const realDay = (value: string | null): value is string => {
  if (value === null || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

/** A malformed link falls back to a filter the server can read. */
export function readOrdersFilter(read: (key: string) => string | null): OrdersFilter {
  const status = read("status");
  const from = read("from");
  const to = read("to");
  const staff = read("staff");
  // A search keeps its trailing space, which finishes the last word.
  const text = (key: string) => {
    const raw = read(key) ?? undefined;
    const value = raw?.trim();
    if (value === undefined || value === "" || value.length > 100) return undefined;
    return key === "q" ? raw : value;
  };
  return {
    status: (ORDER_STATUS_FILTERS as readonly string[]).includes(status ?? "")
      ? (status as OrderStatusFilter)
      : "all",
    ...(realDay(from) && realDay(to) && from <= to ? { from, to } : {}),
    anyDate: read("dates") === "any",
    credited: read("credited") === "yes",
    ...(staff !== null && UUID.test(staff) ? { staff } : {}),
    ...(text("table") === undefined ? {} : { table: text("table") }),
    ...(text("q") === undefined ? {} : { q: text("q") }),
  };
}

export function writeOrdersFilter(filter: OrdersFilter): Record<string, string | null> {
  return {
    status: filter.status === "all" ? null : filter.status,
    from: filter.anyDate ? null : (filter.from ?? null),
    to: filter.anyDate ? null : (filter.to ?? null),
    dates: filter.anyDate ? "any" : null,
    credited: filter.credited ? "yes" : null,
    staff: filter.staff ?? null,
    table: filter.table ?? null,
    q: filter.q ?? null,
  };
}

/** Choosing a status preserves the range a person chose. */
export function withStatus(filter: OrdersFilter, status: OrderStatusFilter): OrdersFilter {
  return { ...filter, status };
}
