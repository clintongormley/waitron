import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodeId } from "@waitron/shared";
import { openBackupQuery } from "@waitron/store";
import type { BackupQuery } from "@waitron/store";
import type { DailyCloseSnapshot } from "./close-types.js";
import { computeCloseEntryHash, recordDailyClose, verifyBackupCloseHistory } from "./index.js";

const before = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const after = useVenueDb({ migrations: [CORE_MIGRATIONS] });

beforeEach(() => {
  for (const db of [before.db, after.db]) {
    db.run(sql`insert into tenants (id, country, tax_id, legal_name, created_at)
      values (1, 'GB', 'fixture-id', 'Fixture company', '2026-10-20T00:00:00Z')`);
    db.run(sql`insert into locations (id, name, invoice_locales, operation_description, time_zone)
      values ('bbbbbbbb-0000-4000-8000-000000000001', 'Fixture venue', '["en"]', 'Restaurant', 'UTC')`);
    db.run(sql`insert into nodes (id, location_id, name, created_at)
      values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Source node', '2026-10-20T00:00:00Z'),
             ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'Other node', '2026-10-20T00:00:00Z')`);
  }
});

async function recordedHistory() {
  for (const node of [
    "aaaaaaaa-0000-4000-8000-000000000001",
    "aaaaaaaa-0000-4000-8000-000000000002",
  ]) {
    // Deliberately not calendar order: only sequence orders the chain.
    for (const day of ["2026-10-12", "2026-10-10", "2026-10-11", "2026-10-13"]) {
      await withTransaction(before.db, (tx) =>
        recordDailyClose(tx, {
          nodeId: nodeId(node),
          businessDay: day,
          timeZone: "UTC",
          closedBy: "actor",
          cashCounts: [],
        }),
      );
    }
  }
  for (const row of before.db.all<Record<string, string | number>>(
    sql`select * from daily_closes`,
  )) {
    after.db.run(sql`insert into daily_closes
      (id, node_id, business_day, sequence_no, prev_entry_hash, entry_hash, closed_at, closed_by, snapshot)
      values (${row.id}, ${row.node_id}, ${row.business_day}, ${row.sequence_no},
        ${row.prev_entry_hash}, ${row.entry_hash}, ${row.closed_at}, ${row.closed_by}, ${row.snapshot})`);
  }
  for (const row of before.db.all<Record<string, string | number>>(
    sql`select * from daily_close_chain`,
  )) {
    after.db.run(sql`insert into daily_close_chain (node_id, sequence_no, last_entry_hash)
      values (${row.node_id}, ${row.sequence_no}, ${row.last_entry_hash})`);
  }
}

async function queries<T>(body: (a: BackupQuery, b: BackupQuery) => Promise<T>): Promise<T> {
  const path = (db: Database) =>
    db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
  const a = await openBackupQuery(path(before.db));
  try {
    const b = await openBackupQuery(path(after.db));
    try {
      return await body(a.query, b.query);
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}
const verify = () => queries(verifyBackupCloseHistory);

async function damage(db: Database, statement: ReturnType<typeof sql>) {
  await db.transaction(async (tx) => {
    const triggers = db.all<{ name: string; sql: string }>(sql`
      select name, sql from sqlite_schema where type = 'trigger' and tbl_name = 'daily_closes'`);
    expect(triggers.map((t) => t.name).sort()).toEqual([
      "daily_closes_append_only_delete",
      "daily_closes_append_only_update",
    ]);
    tx.run(sql`drop trigger daily_closes_append_only_delete`);
    tx.run(sql`drop trigger daily_closes_append_only_update`);
    tx.run(statement);
    for (const trigger of triggers) tx.run(sql.raw(trigger.sql));
  });
}

async function withoutEmptyTables(
  db: Database,
  tables: readonly ("daily_closes" | "daily_close_chain")[],
  body: () => Promise<void>,
) {
  const definitions = db
    .all<{ sql: string; tbl_name: string }>(
      sql`
    select sql, tbl_name from sqlite_schema where sql is not null
      and tbl_name in ('daily_closes', 'daily_close_chain')
      order by case type when 'table' then 0 else 1 end, name`,
    )
    .filter((row) => tables.includes(row.tbl_name as (typeof tables)[number]));
  try {
    for (const table of tables)
      db.run(
        table === "daily_closes" ? sql`drop table daily_closes` : sql`drop table daily_close_chain`,
      );
    await body();
  } finally {
    // useVenueDb retains the initial reset recipe, including these tables and triggers.
    for (const definition of definitions) db.run(sql.raw(definition.sql));
  }
}

describe("captured daily-close history", () => {
  it("checks all nodes with genuine recorded history and writes no rows", async () => {
    await recordedHistory();
    expect(await verify()).toBe(true);
    expect(before.db.all(sql`select * from daily_close_chain order by node_id`)).toEqual(
      after.db.all(sql`select * from daily_close_chain order by node_id`),
    );
    await damage(
      before.db,
      sql`update daily_closes set closed_by = 'changed'
      where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    );
    await damage(
      after.db,
      sql`update daily_closes set closed_by = 'changed'
      where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    );
    expect(await verify()).toBe(false);
  });

  it("accepts honestly empty history without creating a head", async () => {
    expect(await verify()).toBe(true);
    expect(before.db.all(sql`select * from daily_close_chain`)).toEqual([]);
    expect(after.db.all(sql`select * from daily_close_chain`)).toEqual([]);
  });

  it("accepts an explicitly empty head but never a nonempty orphan head", async () => {
    for (const db of [before.db, after.db])
      db.run(
        sql`insert into daily_close_chain values ('aaaaaaaa-0000-4000-8000-000000000002', 0, '')`,
      );
    expect(await verify()).toBe(true);
    for (const db of [before.db, after.db])
      db.run(sql`update daily_close_chain set sequence_no = 1, last_entry_hash = 'lost'`);
    expect(await verify()).toBe(false);
  });

  it.each([
    [
      "middle snapshot",
      sql`update daily_closes set snapshot = json_set(snapshot, '$.cashReconciliation.nodeVariance', '99.00') where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    ],
    [
      "middle hash",
      sql`update daily_closes set entry_hash = 'changed' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    ],
    [
      "middle deletion",
      sql`delete from daily_closes where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    ],
    [
      "deleted tail",
      sql`delete from daily_closes where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 4`,
    ],
    [
      "empty chain with captured head",
      sql`delete from daily_closes where node_id = 'aaaaaaaa-0000-4000-8000-000000000002'`,
    ],
    [
      "missing head",
      sql`delete from daily_close_chain where node_id = 'aaaaaaaa-0000-4000-8000-000000000002'`,
    ],
    [
      "wrong head hash",
      sql`update daily_close_chain set last_entry_hash = 'changed' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002'`,
    ],
    [
      "wrong head sequence",
      sql`update daily_close_chain set sequence_no = 3 where node_id = 'aaaaaaaa-0000-4000-8000-000000000002'`,
    ],
    [
      "genesis",
      sql`update daily_closes set prev_entry_hash = 'changed' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 1`,
    ],
    [
      "later predecessor",
      sql`update daily_closes set prev_entry_hash = 'changed' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 3`,
    ],
    [
      "malformed snapshot JSON",
      sql`update daily_closes set snapshot = '{' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    ],
    [
      "snapshot shape",
      sql`update daily_closes set snapshot = '{}' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    ],
    [
      "invalid timestamp",
      sql`update daily_closes set closed_at = 'invalid' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    ],
  ])("rejects %s even when preserved identically on both sides", async (_name, statement) => {
    await recordedHistory();
    expect(await verify()).toBe(true);
    await damage(before.db, statement);
    await damage(after.db, statement);
    expect(await verify()).toBe(false);
  });

  it.each(["before", "after"])("rejects independent damage in %s", async (side) => {
    await recordedHistory();
    expect(await verify()).toBe(true);
    await damage(
      side === "before" ? before.db : after.db,
      sql`update daily_closes set closed_by = 'changed' where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
    );
    expect(await verify()).toBe(false);
  });

  it("rejects target tail loss even with a matching shortened target head", async () => {
    await recordedHistory();
    expect(await verify()).toBe(true);
    await damage(
      after.db,
      sql`delete from daily_closes where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 4`,
    );
    after.db.run(sql`update daily_close_chain set sequence_no = 3,
      last_entry_hash = (select entry_hash from daily_closes where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 3)
      where node_id = 'aaaaaaaa-0000-4000-8000-000000000002'`);
    expect(await verify()).toBe(false);
  });

  it("rejects an independently valid replacement history after migration", async () => {
    await recordedHistory();
    const node = "aaaaaaaa-0000-4000-8000-000000000002";
    const rows = after.db.all<Record<string, string | number>>(sql`
      select * from daily_closes where node_id = ${node} order by sequence_no`);
    let previous = "";
    for (const row of rows) {
      const actor = row.sequence_no === 2 ? "replacement actor" : String(row.closed_by);
      const hash = computeCloseEntryHash(
        {
          nodeId: node,
          sequenceNo: Number(row.sequence_no),
          businessDay: String(row.business_day),
          closedAt: String(row.closed_at),
          closedBy: actor,
          snapshot: JSON.parse(String(row.snapshot)) as DailyCloseSnapshot,
        },
        previous,
      );
      await damage(
        after.db,
        sql`update daily_closes set closed_by = ${actor},
        prev_entry_hash = ${previous}, entry_hash = ${hash} where id = ${row.id}`,
      );
      previous = hash;
    }
    after.db.run(
      sql`update daily_close_chain set last_entry_hash = ${previous} where node_id = ${node}`,
    );
    await queries(async (a, b) => {
      expect(await verifyBackupCloseHistory(a, a)).toBe(true);
      expect(await verifyBackupCloseHistory(b, b)).toBe(true);
      expect(await verifyBackupCloseHistory(a, b)).toBe(false);
    });
  });

  it("accepts a predecessor without either close table only when migrated history stays empty", async () => {
    await withoutEmptyTables(before.db, ["daily_closes", "daily_close_chain"], async () => {
      expect(await verify()).toBe(true);
      after.db.run(
        sql`insert into daily_close_chain values ('aaaaaaaa-0000-4000-8000-000000000001', 0, '')`,
      );
      expect(await verify()).toBe(false);
    });
  });

  it.each(["daily_closes", "daily_close_chain"] as const)(
    "refuses a partial source schema missing %s",
    async (table) => {
      await withoutEmptyTables(before.db, [table], async () => {
        expect(await verify()).toBe(false);
      });
    },
  );

  it("refuses a target that drops both captured history tables", async () => {
    await withoutEmptyTables(after.db, ["daily_closes", "daily_close_chain"], async () => {
      expect(await verify()).toBe(false);
    });
  });

  it.each([
    "null",
    "[]",
    "false",
    '{"close":{}}',
    '{"close":{},"cashReconciliation":null}',
    '{"close":{},"cashReconciliation":{"byDevice":[],"nodeVariance":0}}',
    '{"close":{},"cashReconciliation":{"byDevice":null,"nodeVariance":"0.00"}}',
    '{"close":{},"cashReconciliation":{"byDevice":[null],"nodeVariance":"0.00"}}',
    '{"close":{},"cashReconciliation":{"byDevice":[{}],"nodeVariance":"0.00"}}',
  ])("refuses an unhashable captured snapshot: %s", async (encoded) => {
    await recordedHistory();
    for (const db of [before.db, after.db])
      await damage(
        db,
        sql`update daily_closes set snapshot = ${encoded}
      where node_id = 'aaaaaaaa-0000-4000-8000-000000000002' and sequence_no = 2`,
      );
    expect(await verify()).toBe(false);
  });

  it.each([
    ["non-text snapshot", sql`update daily_closes set snapshot = x'00ff' where sequence_no = 2`],
    ["non-text date", sql`update daily_closes set business_day = x'00ff' where sequence_no = 2`],
    ["non-text actor", sql`update daily_closes set closed_by = x'00ff' where sequence_no = 2`],
    ["non-text timestamp", sql`update daily_closes set closed_at = x'00ff' where sequence_no = 2`],
    ["fractional sequence", sql`update daily_closes set sequence_no = 2.5 where sequence_no = 2`],
    ["unsafe sequence", sql`update daily_close_chain set sequence_no = 9007199254740992`],
    ["text sequence", sql`update daily_close_chain set sequence_no = 'unknown'`],
    ["negative sequence", sql`update daily_close_chain set sequence_no = -1`],
  ])("refuses captured SQLite type damage: %s", async (_label, statement) => {
    await recordedHistory();
    for (const db of [before.db, after.db]) await damage(db, statement);
    expect(await verify()).toBe(false);
  });

  it("leaves unexpected query failures unavailable instead of claiming invalid data", async () => {
    await queries(async (a, b) => {
      const unavailable: BackupQuery = {
        rows: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw new Error("Fixture read failed");
            },
          }),
        }),
      };
      await expect(verifyBackupCloseHistory(unavailable, b)).rejects.toThrow("Fixture read failed");
      await expect(verifyBackupCloseHistory(a, unavailable)).rejects.toThrow("Fixture read failed");
    });
  });
});
