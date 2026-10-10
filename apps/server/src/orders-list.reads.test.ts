import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction } from "@waitron/db";
import { seatedWith, send } from "./testing/bill-venue.js";
import {
  contribute,
  credit,
  departed,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import { listOrders, ordersPageSql, type OrderListFilter } from "./orders-list.js";

// Wrapped before the store opens its connections, so every registration of the matcher counts.
let rankCalls = 0;
const register = DatabaseSync.prototype.function;
vi.spyOn(DatabaseSync.prototype, "function").mockImplementation(function (
  this: DatabaseSync,
  ...args: unknown[]
) {
  const callback = args.at(-1) as (...values: unknown[]) => unknown;
  if (args[0] === "waitron_search_rank")
    args[args.length - 1] = (...values: unknown[]) => {
      rankCalls++;
      return callback(...values);
    };
  return Reflect.apply(register, this, args) as void;
} as typeof register);

let venue: OrderVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
  },
});

const ANY: OrderListFilter = {
  status: "all",
  dates: "any",
  credited: false,
  limit: 50,
  scope: "all",
};

/**
 * Three bills, oldest first, that between them make `listOrders` ask every read: a party's open bill
 * holding a cash payment (payments, refunds, tables, staff), an invoiced bill with a credit note
 * (amounts due, credit notes), and a debt (a departure).
 */
async function oneOfEach(): Promise<void> {
  const party = await seatedWith(venue, "Caña", "Tarta");
  await contribute(venue, party.tabId, "5.00");
  const invoiced = await placedIssuedBill(venue, "Botella tinto");
  await credit(venue, invoiced, "2.00", "-2.42");
  await departed(venue, "Croquetas");
}

async function readsFor(limit: number) {
  return withTransaction(venue.db, async (tx) => {
    const spies = [vi.spyOn(tx, "select"), vi.spyOn(tx, "selectDistinct"), vi.spyOn(tx, "execute")];
    try {
      const page = await listOrders(tx, { ...ANY, limit });
      return {
        statuses: page.rows.map((row) => row.status),
        reads: spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0),
      };
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
}

describe("reads per page", () => {
  it("asks the same seven reads for three rows of every shape as for fifty", async () => {
    for (let n = 0; n < 17; n++) await oneOfEach();
    const three = await readsFor(3);
    expect(three.statuses).toEqual(["left_without_paying", "waiting_for_payment", "open"]);
    expect(three.reads).toBe(7);
    const fifty = await readsFor(50);
    expect(fifty.statuses).toHaveLength(50);
    expect(fifty.reads).toBe(7);
    expect((await readsFor(1)).reads).toBeLessThanOrEqual(7);
  });
});

describe("ranking work", () => {
  it("a word search ranks only the orders its other filters keep", async () => {
    for (const day of ["01", "02", "03", "04"]) {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(`2026-04-${day}T12:00:00.000Z`) });
      try {
        const party = await seatedWith(venue);
        const named = await send(
          venue.app,
          venue.cookie,
          "PUT",
          `/api/parties/${party.partyId}/name`,
          { name: "Quokka", expectedPartyRevision: party.revision },
        );
        expect(named.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    }
    async function ranked(dates: OrderListFilter["dates"]) {
      rankCalls = 0;
      const page = await withTransaction(venue.db, (tx) =>
        listOrders(tx, { ...ANY, dates, search: "quokka" }),
      );
      return { rows: page.rows.length, calls: rankCalls };
    }
    const oneDay = {
      from: "2026-04-04",
      to: "2026-04-04",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    };
    expect(await ranked(oneDay)).toEqual({ rows: 1, calls: 1 });
    // The control: unfiltered by date, all four are ranked, so the count above is the filter's doing.
    expect((await ranked("any")).rows).toBe(4);
    expect((await ranked("any")).calls).toBeGreaterThanOrEqual(4);
  });
});

/**
 * Read, not run, when this plan was written: the spec's receipt (§4.6) is the review's own
 * `EXPLAIN QUERY PLAN` on `node:sqlite`. The planner's wording and choice can change with the SQLite
 * version Node ships and with ANALYZE statistics (none are kept). If a case fails, print the plan in
 * the PR and report it; do not loosen the pattern.
 */
describe("which index a read starts from", () => {
  async function plan(filter: Partial<OrderListFilter>): Promise<string> {
    return withTransaction(venue.db, async (tx) => {
      const { rows } = await tx.execute<{ detail: string }>(
        sql`explain query plan ${ordersPageSql({ ...ANY, ...filter })}`,
      );
      return rows.map((row) => row.detail).join("\n");
    });
  }

  it("Unpaid at any date reads bills through the status index", async () => {
    expect(await plan({ status: "unpaid" })).toMatch(/working_orders_tenant_status_idx/);
  });

  it("a session without report.view reads unfinished bills and today's finished bills", async () => {
    expect(
      await plan({
        status: "all",
        scope: {
          today: {
            from: "2026-10-02",
            to: "2026-10-02",
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
          },
        },
      }),
    ).toMatch(/working_orders_(tenant_status|opened_at)_idx/);
  });

  it("a date range reads bills through the opened-at index", async () => {
    expect(
      await plan({
        dates: {
          from: "2026-03-01",
          to: "2026-03-02",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
      }),
    ).toMatch(/working_orders_opened_at_idx/);
  });

  // The control: if this one also names an index, the two above prove nothing.
  it("All at any date reads every bill, through neither index", async () => {
    expect(await plan({ status: "all" })).not.toMatch(
      /working_orders_(tenant_status|opened_at)_idx/,
    );
  });
});
