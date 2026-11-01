import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureError, triggerRaised, withTransaction } from "@waitron/db";
import { applyMigrationSet, useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

const PERSON = "33333333-3333-4333-8333-333333333333";
const FISCAL_SET = TEST_MIGRATIONS.find(
  (set) => set.migrationsTable === FISCAL_MIGRATIONS.migrationsTable,
)!;

let directory: string | undefined;
const suite = useVenueDb({
  migrations: [],
  setup: async (db) => {
    directory = await mkdtemp(join(tmpdir(), "waitron-clock-confirmations-upgrade-"));
    await cp(FISCAL_MIGRATIONS.migrationsFolder, directory, { recursive: true });
    const journalPath = join(directory, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter(
      (entry) => entry.tag < "0012_clock_confirmations_staff",
    );
    await writeFile(journalPath, JSON.stringify(journal));
    for (const set of TEST_MIGRATIONS) {
      await applyMigrationSet(
        db,
        set === FISCAL_SET
          ? {
              ...set,
              migrationsFolder: directory,
              appendOnlyTables: set.appendOnlyTables?.filter(
                (table) => table !== "fiscal_conflict_evidence",
              ),
            }
          : set,
      );
    }
  },
});
afterAll(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

async function confirmationRows() {
  return (await suite.db.execute(sql`select * from clock_confirmations order by seq`)).rows;
}

async function confirmationIndexes() {
  return (
    await suite.db.execute(
      sql`select name, sql from sqlite_master where type = 'index' and tbl_name = 'clock_confirmations' order by name`,
    )
  ).rows;
}

it("keeps every confirmation and both append-only triggers across the staff migration", async () => {
  const { nodeId, registroIds } = await seedPendingEnvios(suite.db, { count: 1 });
  const [check] = await withTransaction(suite.db, (tx) =>
    tx
      .insert(clockChecks)
      .values({
        seq: 1,
        nodeId,
        openedAt: new Date("2026-07-21T09:58:00.000Z"),
        reason: "behind_chain",
        detail: { clockAt: "2026-07-21T09:58:00.000Z", heads: {} },
      })
      .returning({ id: clockChecks.id }),
  );
  const base = {
    nodeId,
    boxClockAt: new Date("2026-07-21T10:00:00.000Z"),
    confirmedAt: new Date("2026-07-21T10:00:00.000Z"),
    reason: "behind_chain" as const,
    checkId: null,
    registroId: null,
    recordAt: null,
  };
  await withTransaction(suite.db, (tx) =>
    tx.insert(clockConfirmations).values([
      {
        ...base,
        seq: 1,
        stepMs: -60_000,
        source: "admin",
        personId: PERSON,
        proof: { a: 1 },
        checkId: check!.id,
        registroId: registroIds[0]!,
        recordAt: new Date("2026-07-21T10:30:00.000Z"),
      },
      { ...base, seq: 2, stepMs: 0, source: "devices", personId: null, proof: { d: [1, 2] } },
      { ...base, seq: 3, stepMs: 0, source: "elapsed", personId: null, proof: {} },
    ]),
  );
  const before = await confirmationRows();
  expect(before).toHaveLength(3);
  const indexesBefore = await confirmationIndexes();
  // The three declared indexes and the primary key's automatic one.
  expect(indexesBefore).toHaveLength(4);

  await applyMigrationSet(suite.db, FISCAL_SET);
  expect((await suite.db.execute(sql`select * from fiscal_conflict_evidence`)).rows).toEqual([]);

  expect(await confirmationRows()).toEqual(before);
  expect(await confirmationIndexes()).toEqual(indexesBefore);
  const { rows: triggers } = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'trigger' and tbl_name = 'clock_confirmations' order by name`,
  );
  expect(triggers).toHaveLength(2);
  const update = await captureError(async () =>
    suite.db.execute(sql`update clock_confirmations set step_ms = 5`),
  );
  expect(triggerRaised(update, "clock_confirmations is append-only")).toBe(true);
  const remove = await captureError(async () =>
    suite.db.execute(sql`delete from clock_confirmations`),
  );
  expect(triggerRaised(remove, "clock_confirmations is append-only")).toBe(true);
  expect(await confirmationRows()).toEqual(before);
});
