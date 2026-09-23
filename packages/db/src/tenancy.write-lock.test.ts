import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceChange } from "@waitron/shared";
import { openVenueStore } from "@waitron/store";
import { subscribeToChanges } from "./change-log.js";
import type { Transaction } from "./client.js";
import * as schema from "./schema/index.js";
import { withTransaction } from "./tenancy.js";

/**
 * `withTransaction` against a real SQLite store, built here rather than through `useVenueDb`.
 *
 * That is a deliberate shape, not a leftover: `useVenueDb`'s job is to APPLY MIGRATION SETS — the
 * option is required — and publish one database for the whole file, and this suite wants neither. It
 * wants a bare store with two hand-written tables, because what is under test is the helper and not
 * the schema, and a fresh store per case so the queue it exercises starts with nothing in flight.
 * `change_log` here happens to have the same two columns the core set declares
 * (`packages/db/drizzle/0000_baseline.sql:686-689`); `probe` is this suite's own. `tenancy.test.ts`
 * beside this file went the other way — its cases are about the real schema's constraints, so it is
 * on `useVenueDb`.
 *
 * Its teardown closes every store it opened and guards the pop, which is what CLAUDE.md §4 and
 * `scripts/guarded-teardowns.test.ts` ask of a suite that builds its own resource.
 */
const open = async () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-tenancy-"));
  const store = await openVenueStore({
    directory,
    venueSchema: schema,
    nodeSchema: schema,
  });
  store.venue.run(sql`create table change_log (id text primary key, payload text not null)`);
  store.venue.run(sql`create table probe (id integer primary key, label text)`);
  opened.push(store);
  return store.venue;
};

const opened: { close: () => Promise<void> }[] = [];
const unsubscribes: (() => void)[] = [];

afterEach(async () => {
  while (unsubscribes.length > 0) unsubscribes.pop()!();
  while (opened.length > 0) await opened.pop()!.close();
});

const listen = () => {
  const seen: ResourceChange[] = [];
  unsubscribes.push(subscribeToChanges((change) => seen.push(change)));
  return seen;
};

const labels = (db: Awaited<ReturnType<typeof open>>) =>
  db.all<{ label: string }>(sql`select label from probe order by label`).map((row) => row.label);

const logChange = (db: Transaction, id: string, change: ResourceChange) =>
  db.run(sql`insert into change_log (id, payload) values (${id}, ${JSON.stringify(change)})`);

const aChange = (resource: string): ResourceChange => ({ resource }) as unknown as ResourceChange;

describe("withTransaction on the write queue", () => {
  it("keeps a failed transaction's writes out of the database", async () => {
    const db = await open();
    await expect(
      withTransaction(db, async (tx) => {
        tx.run(sql`insert into probe (label) values ('kept?')`);
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    expect(labels(db)).toEqual([]);
  });

  it("commits what the caller wrote", async () => {
    const db = await open();
    const result = await withTransaction(db, async (tx) => {
      tx.run(sql`insert into probe (label) values ('written')`);
      return "returned";
    });
    expect(result).toBe("returned");
    expect(labels(db)).toEqual(["written"]);
  });

  it("runs two overlapping transactions one after the other", async () => {
    const db = await open();
    const write = (label: string, fail: boolean) =>
      withTransaction(db, async (tx) => {
        tx.run(sql`insert into probe (label) values (${label})`);
        await new Promise((resolve) => setImmediate(resolve));
        if (fail) throw new Error("deliberate");
      });

    await Promise.allSettled([write("A", true), write("B", false)]);

    // Without the queue the two share the one write connection: B's `begin` is refused inside A's
    // open transaction, and A's rollback then takes its own row, leaving the table empty. RE-RUN
    // 2026-09-23 against the read-connection routing, by replacing the queue's `tail` with an
    // already-resolved promise: `expected [] to deeply equal [ 'B' ]`, unchanged.
    expect(labels(db)).toEqual(["B"]);
  });

  it("hands a logged change to a listener as the object that was written", async () => {
    const db = await open();
    const seen = listen();
    await withTransaction(db, async (tx) => {
      logChange(tx, "c1", aChange("products"));
    });
    // The payload column is TEXT on this engine, so a change arrives as a JSON string unless the
    // drain parses it — a listener would otherwise receive a string where it expects an object.
    expect(seen).toEqual([aChange("products")]);
    expect(db.all(sql`select id from change_log`)).toEqual([]);
  });

  it("delivers a change only once the commit has returned", async () => {
    const db = await open();
    const seen = listen();
    let seenDuring = -1;
    await withTransaction(db, async (tx) => {
      logChange(tx, "c1", aChange("products"));
      seenDuring = seen.length;
    });
    expect(seenDuring).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it("tells no listener about a change a rollback took away", async () => {
    const db = await open();
    const seen = listen();
    await expect(
      withTransaction(db, async (tx) => {
        logChange(tx, "c1", aChange("products"));
        throw new Error("deliberate");
      }),
    ).rejects.toThrow("deliberate");
    expect(seen).toEqual([]);
    expect(db.all(sql`select id from change_log`)).toEqual([]);
  });
});
