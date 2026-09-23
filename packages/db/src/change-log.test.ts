import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import { installChangeFeed } from "./change-feed.js";
import { subscribeToChanges } from "./change-log.js";
import { CORE_CHANGE_SOURCES } from "./classification.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "./tenancy.js";
import type { Transaction } from "./client.js";
import { useVenueDb } from "./testing/venue-db.js";

// `locations` is a change source, so one fixture table serves every case here.
// `operation_description` is Spanish test DATA, not a schema identifier — the same shape the
// sibling join-requests and dining-table suites use.
//
// Two things the statement carries that the PostgreSQL one did not. The id is supplied here,
// because `id` columns take their default from a JavaScript call now (`newId`,
// `./schema/columns.ts`) and raw SQL never reaches it. And `invoice_locales` is one TEXT column
// holding a JSON array, checked by `locations_invoice_locales_len`, where it used to be `text[]`.
async function insertLocation(tx: Transaction, name: string): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    insert into locations (id, name, invoice_locales, operation_description)
    values (${id}, ${name}, '["es"]', 'Hostelería')`);
  return id;
}

describe("the change log", () => {
  // One venue file and one handle. The change triggers write their row in the caller's own
  // transaction and `withTransaction` reads it back on the same connection, so nothing here
  // crosses a connection and there is no second session to keep in the dark.
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS],
    setup: (db) => installChangeFeed(db, CORE_CHANGE_SOURCES),
  });

  const unsubscribes: (() => void)[] = [];
  afterEach(() => {
    while (unsubscribes.length > 0) unsubscribes.pop()!();
  });

  /** Subscribes for the duration of one test and returns the list the listener appends to. */
  function collect(): ResourceChange[] {
    const seen: ResourceChange[] = [];
    unsubscribes.push(subscribeToChanges((change) => seen.push(change)));
    return seen;
  }

  it("publishes a change only after the transaction commits", async () => {
    const seen = collect();
    let id = "";
    await withTransaction(suite.db, async (tx) => {
      id = await insertLocation(tx, "Committed venue");
      // Still open: a listener that had already seen this would be reporting a change that the
      // rollback case below proves may never happen.
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual([{ resources: [{ type: "locations", id }] }]);
  });

  it("publishes nothing when the transaction rolls back", async () => {
    const seen = collect();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await insertLocation(tx, "Rolled-back venue");
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    expect(seen).toEqual([]);
  });

  // THIS CASE NO LONGER SEPARATES ANYTHING. It was the grant case, and what it proved was that the
  // non-owner role held SELECT, INSERT and DELETE on `change_log`. This engine has no roles, so what
  // remains is the first case again under another name.
  it("lets the application role write a change-fed row and drain what the trigger wrote", async () => {
    const seen = collect();
    let id = "";
    await withTransaction(suite.db, async (tx) => {
      id = await insertLocation(tx, "App-role venue");
    });
    expect(seen).toEqual([{ resources: [{ type: "locations", id }] }]);
  });

  it("stops delivering to a listener that has unsubscribed", async () => {
    const seen = collect();
    const dropped: ResourceChange[] = [];
    const unsubscribe = subscribeToChanges((change) => dropped.push(change));
    unsubscribe();
    await withTransaction(suite.db, async (tx) => {
      await insertLocation(tx, "Unsubscribed venue");
    });
    // `seen` is the control: the change WAS delivered, to the listener still registered.
    expect(seen).toHaveLength(1);
    expect(dropped).toEqual([]);
  });
});
