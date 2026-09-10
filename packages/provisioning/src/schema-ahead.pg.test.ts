// Real PostgreSQL. PGlite is a false pass here twice over: every connection is a superuser, and the
// journal semantics under test are drizzle's against real Postgres (CLAUDE.md §4).
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { withDatabase } from "./instance-apply.js";
import { assertNotAhead, findAheadSets } from "./schema-ahead.js";
import { startBarePostgres, type RealPostgres } from "./testing/postgres.js";

const DATABASE = "waitron_ahead_suite";
const CORE = manifestSets().find((set) => set.name === "core")!;
/** Above every shipped migration's `folderMillis`, which is what makes the re-migrate a no-op. */
const AHEAD_WHEN = 9_999_999_999_999;

describe("an ahead database", () => {
  let pg: RealPostgres;
  let admin: Database;
  let target: Database;
  let targetUri: string;

  beforeAll(async () => {
    pg = await startBarePostgres();
    admin = await createPostgresDb(pg.uri);
    await admin.execute(sql.raw(`create database "${DATABASE}"`));
    targetUri = withDatabase(pg.uri, DATABASE);
    await applyMigrations(targetUri, migrationOptionsFor(manifestSets(), null));
    target = await createPostgresDb(targetUri);
  }, 180_000);

  afterAll(async () => {
    // Guarded: an earlier step may have thrown before the handle was assigned.
    if (target !== undefined) await target.close();
    if (admin !== undefined) await admin.close();
    if (pg !== undefined) await pg.stop();
  });

  /** The journal's row count for `core`, which is what a re-migrate would change if it applied anything. */
  async function coreJournalRows(): Promise<number> {
    const result = await target.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(CORE.table)}`,
    );
    return result.rows[0]!.n;
  }

  // The NEGATIVE CONTROL runs first, and it is what makes the next test a probe rather than a
  // measurement where both answers look alike: a freshly migrated database must be accepted.
  it("is not reported for a database this image migrated itself", async () => {
    expect(await findAheadSets(target, manifestSets(), null)).toEqual([]);
    await expect(assertNotAhead(target, manifestSets(), null)).resolves.toBeUndefined();
  });

  it("is named, with its set and the unknown hash, once a newer image's migration is recorded", async () => {
    // The shape a branch image leaves behind: a journal row whose hash this image ships no file for.
    // Written directly rather than by running a synthetic migration, because the row IS the artefact
    // the check reads — and drizzle records nothing else about a migration.
    const unknown = "f".repeat(64);
    // The table name reaches SQL as an identifier (Postgres binds no placeholder for one), but the
    // VALUES are bound — CLAUDE.md §3 forbids concatenating them and explicitly rejects "the callers
    // only pass safe values" as a defence.
    await target.execute(
      sql`insert into ${sql.identifier(CORE.table)} ("hash", "created_at")
          values (${unknown}, ${AHEAD_WHEN})`,
    );

    expect(await findAheadSets(target, manifestSets(), null)).toEqual([
      { set: "core", unknownMigrations: [unknown] },
    ]);
    await expect(assertNotAhead(target, manifestSets(), null)).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "core", unknownMigrations: [unknown] },
    });
  });

  it("is still ahead after a re-migrate, because drizzle applies and reports nothing", async () => {
    // The mechanism the check exists for, run rather than argued: drizzle decides what to apply from
    // `max(created_at)` alone, so a journal watermark above every shipped migration's `when` makes
    // migrate resolve silently and change nothing. A boot that relied on migrate to notice the
    // mismatch would therefore sail past it — this check is the only thing that names the case.
    const before = await coreJournalRows();
    await expect(
      applyMigrations(targetUri, migrationOptionsFor(manifestSets(), null)),
    ).resolves.toBeUndefined();
    expect(await coreJournalRows()).toBe(before);
    expect(await findAheadSets(target, manifestSets(), null)).toEqual([
      { set: "core", unknownMigrations: ["f".repeat(64)] },
    ]);
  });
});
