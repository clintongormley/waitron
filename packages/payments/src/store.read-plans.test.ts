import type { Query } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  findCapturedPaymentForWorkingOrder,
  findCapturedPaymentForWorkingOrderAnyProvider,
} from "./store.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

// Every statement, raw or built, reaches SQLite through the session's `prepareQuery`.
type Session = {
  prepareQuery(query: Query, ...rest: unknown[]): { all(): unknown };
};

function sessionOf(tx: Transaction): Session {
  return (tx as unknown as { session: Session }).session;
}

const PLAN = [
  "SEARCH payments USING INDEX payments_working_order_idx (working_order_id=?)",
  "USE TEMP B-TREE FOR ORDER BY",
];

const BY_ORDER = /working_order_id"? = \?/;

/** The plan of the one statement `read` sends that filters by working order. */
async function planOf(read: (tx: Transaction) => Promise<unknown>): Promise<string[]> {
  return withTransaction(suite.db, async (tx) => {
    const session = sessionOf(tx);
    const prepare = vi.spyOn(session, "prepareQuery");
    let sent: Query[];
    try {
      await read(tx);
      sent = prepare.mock.calls.map(([query]) => query).filter((query) => BY_ORDER.test(query.sql));
    } finally {
      prepare.mockRestore();
    }
    expect(sent).toHaveLength(1);
    const [query] = sent;
    const rows = session
      .prepareQuery(
        { sql: `explain query plan ${query!.sql}`, params: query!.params },
        undefined,
        "all",
        false,
      )
      .all() as { detail: string }[];
    return rows.map((row) => row.detail);
  });
}

describe("reads of a working order's captured payment", () => {
  it("finds one provider's captured payment through the working-order index", async () => {
    const plan = await planOf((tx) =>
      findCapturedPaymentForWorkingOrder(tx, { provider: "stripe", workingOrderId: "o1" }),
    );
    expect(plan).toEqual(PLAN);
  });

  it("finds any provider's captured payment through the working-order index", async () => {
    const plan = await planOf((tx) =>
      findCapturedPaymentForWorkingOrderAnyProvider(tx, { workingOrderId: "o1" }),
    );
    expect(plan).toEqual(PLAN);
  });
});
