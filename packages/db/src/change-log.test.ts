import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import { installChangeFeed } from "./change-feed.js";
import { subscribeToChanges } from "./change-log.js";
import { CORE_CHANGE_SOURCES } from "./classification.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "./tenancy.js";
import type { Transaction } from "./client.js";
import { asAppUser } from "./testing/roles.js";
import { useVenueDb } from "./testing/venue-db.js";

// `locations` is a change source the application role may INSERT into (baseline migration), so one
// fixture table serves both the ordering cases and the grant case. `operation_description` is
// Spanish test DATA, not a schema identifier — the same shape the sibling join-requests and
// dining-table suites use.
async function insertLocation(tx: Transaction, name: string): Promise<string> {
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into locations (name, invoice_locales, operation_description)
    values (${name}, array['es'], 'Hostelería') returning id`);
  return inserted.rows[0]!.id;
}

describe("the change log", () => {
  // PGlite rather than a container: nothing here crosses a connection any more. The change trigger
  // writes a row in the caller's own transaction and `withTransaction` reads it back on the same
  // connection, so the one thing real PostgreSQL was needed for — a notification travelling to a
  // second backend — is gone. The application-role case still bites, because `asAppUser` makes the
  // session assume the non-owner role (CLAUDE.md §4).
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

  // The three letters themselves — SELECT, INSERT, DELETE and not UPDATE — are pinned once for
  // every table in the workspace by `packages/fiscal-verifactu/src/privileges.expected.ts`
  // (`change_log: "SID"`), read back from the live catalogue by its `privileges.test.ts`. This case
  // exercises all three through the real path instead, under the non-owner role.
  it("lets the application role write a change-fed row and drain what the trigger wrote", async () => {
    const seen = collect();
    let id = "";
    await withTransaction(suite.db, async (tx) => {
      await asAppUser(tx);
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
