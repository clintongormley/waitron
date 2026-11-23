import { expect, it } from "vitest";
import { liveBackupQuery } from "./live-backup-query.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { withTransaction } from "./tenancy.js";
import { useVenueDb } from "./testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function all(query: ReturnType<typeof liveBackupQuery>, statement: string, values?: never[]) {
  const rows = [];
  for await (const row of query.rows(statement, values)) rows.push(row);
  return rows;
}

const STATEMENT =
  "select 7 as whole, 1.5 as part, 'text' as words, null as empty, ? as bound, ? as second";

it("reads whole numbers as bigints, as a backup copy's query does, and binds each value in turn", async () => {
  const expected = [{ whole: 7n, part: 1.5, words: "text", empty: null, bound: "a?b", second: 3n }];
  expect(await all(liveBackupQuery(suite.db), STATEMENT, ["a?b", 3] as never[])).toEqual(expected);
  expect(await all(liveBackupQuery(suite.db), "select 2 as alone")).toEqual([{ alone: 2n }]);
  await withTransaction(suite.db, async (tx) => {
    expect(await all(liveBackupQuery(tx), STATEMENT, ["a?b", 3] as never[])).toEqual(expected);
  });
});
