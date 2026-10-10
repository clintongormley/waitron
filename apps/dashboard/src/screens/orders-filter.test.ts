import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORDERS_FILTER,
  readOrdersFilter,
  withStatus,
  writeOrdersFilter,
  type OrdersFilter,
} from "./orders-filter.js";

const reader = (values: Record<string, string>) => (key: string) => values[key] ?? null;

describe("orders filter in the address", () => {
  it("round-trips each chosen filter", () => {
    const filter: OrdersFilter = {
      status: "paid",
      from: "2026-09-01",
      to: "2026-09-30",
      anyDate: false,
      credited: true,
      staff: "1b4e28ba-2fa1-41d2-883f-0016d3cca427",
      table: "Mesa 5",
      q: "A/12",
    };
    const written = writeOrdersFilter(filter);
    expect(written.staff).toBe(filter.staff);
    expect(readOrdersFilter(reader({ staff: filter.staff! })).staff).toBe(filter.staff);
    expect(
      readOrdersFilter(
        reader(
          Object.fromEntries(Object.entries(written).filter(([, v]) => v !== null)) as Record<
            string,
            string
          >,
        ),
      ),
    ).toEqual(filter);
  });

  it("keeps the plain address for today's all-status view", () => {
    expect(Object.values(writeOrdersFilter(DEFAULT_ORDERS_FILTER)).every((v) => v === null)).toBe(
      true,
    );
  });

  it("drops invalid status, dates and staff from an address", () => {
    expect(
      readOrdersFilter(
        reader({ status: "bogus", from: "2026-13-01", to: "2026-09-02", staff: "x" }),
      ),
    ).toEqual(DEFAULT_ORDERS_FILTER);
  });

  it("keeps a date range when switching to Unpaid", () => {
    const dated = { ...DEFAULT_ORDERS_FILTER, from: "2026-09-01", to: "2026-09-02" };
    expect(withStatus(dated, "unpaid")).toEqual({ ...dated, status: "unpaid" });
  });

  it("keeps a search's trailing space from an address and drops a blank one", () => {
    expect(readOrdersFilter(reader({ q: "gin " })).q).toBe("gin ");
    expect(readOrdersFilter(reader({ q: "   " })).q).toBeUndefined();
    expect(readOrdersFilter(reader({ q: `${"x".repeat(100)} ` })).q).toBe(`${"x".repeat(100)} `);
  });

  it("accepts Paid for staff because the server limits older finished bills", () => {
    expect(readOrdersFilter(reader({ status: "paid" })).status).toBe("paid");
  });
});
