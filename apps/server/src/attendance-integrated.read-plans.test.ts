import { seedPersons } from "@waitron/identity/test/person-rows.js";
import type { Query } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, newId, withTransaction, type Transaction } from "@waitron/db";
import { seedNode, seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { recordAttendanceFact } from "./attendance-capture.js";
import { beginIntegratedAttendance } from "./attendance-integrated.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, WORKFORCE_MIGRATIONS, PAYMENTS_MIGRATIONS],
});

// Every statement, raw or built, reaches SQLite through the session's `prepareQuery`.
type Session = {
  prepareQuery(query: Query, ...rest: unknown[]): { all(): unknown };
};

function sessionOf(tx: Transaction): Session {
  return (tx as unknown as { session: Session }).session;
}

const PAYMENTS_BY_ORDER = /from "?payments"?\b.*working_order_id"? = \?/s;

/** The plan of the one statement `read` sends that reads payments by working order. */
async function planOf(read: (tx: Transaction) => Promise<unknown>): Promise<string[]> {
  return withTransaction(suite.db, async (tx) => {
    const session = sessionOf(tx);
    const prepare = vi.spyOn(session, "prepareQuery");
    let sent: Query[];
    try {
      await read(tx);
      sent = prepare.mock.calls
        .map(([query]) => query)
        .filter((query) => PAYMENTS_BY_ORDER.test(query.sql));
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

it("reads the order's earlier payments through the working-order index", async () => {
  await seedVenue(suite.db, {
    name: "Madrid",
    timeZone: "Europe/Madrid",
    invoiceLocales: ["es"],
    operationDescription: "Restaurant",
  });
  const nodeId = await seedNode(suite.db);
  const [person] = await seedPersons(suite.db, {
    displayName: "Collector",
    pinHash: "scrypt$00$00",
  });
  const orderId = newId();
  await seedWorkingOrder(suite.db, { id: orderId, source: "dashboard", nodeId, orderNumber: 1 });
  const plan = await planOf((tx) =>
    beginIntegratedAttendance(
      tx,
      recordAttendanceFact,
      { id: orderId, provider: "fake", personId: person!.id },
      () => new Date("2026-01-05T11:00:00Z"),
    ),
  );
  expect(plan).toEqual([
    "SEARCH payments USING INDEX payments_working_order_idx (working_order_id=?)",
  ]);
});
