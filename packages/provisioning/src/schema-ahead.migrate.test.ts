// Against a real migrated venue directory, not a stub: `schema-ahead.test.ts` answers the module's
// own `select "hash" from …` from a fake, so it can only pin the set arithmetic. What has to be
// checked against the engine and against drizzle is the journal itself — the table drizzle creates,
// the rows it writes, and what it does on a re-migrate — because that is the artefact
// `findAheadSets` reads and none of it is ours.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database, type VenueDatabase } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { assertNotAhead, findAheadSets } from "./schema-ahead.js";

const CORE = manifestSets().find((set) => set.name === "core")!;
/** Above every shipped migration's `folderMillis`, which is what makes the re-migrate a no-op. */
const AHEAD_WHEN = 9_999_999_999_999;

describe("an ahead database", () => {
  let directory: string;
  let store: VenueDatabase;
  let target: Database;

  // Its own directory rather than `useVenueDb`'s, because the third case re-runs `applyMigrations`
  // and that takes the DIRECTORY — which the helper owns and does not hand out.
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "waitron-schema-ahead-"));
    await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
    store = await openVenueDatabase(directory);
    target = store.venue;
  }, 120_000);

  afterAll(async () => {
    // Guarded, and in order: the files close before the directory holding them is removed, and a
    // run whose `applyMigrations` threw still removes the directory it made.
    if (store !== undefined) await store.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  /** The journal's row count for `core`, which is what a re-migrate would change if it applied anything. */
  async function coreJournalRows(): Promise<number> {
    const result = await target.execute<{ n: number }>(
      sql`select count(*) as n from ${sql.identifier(CORE.table)}`,
    );
    return Number(result.rows[0]!.n);
  }

  // The NEGATIVE CONTROL runs first, and it is what makes the next test a probe rather than a
  // measurement where both answers look alike: a freshly migrated directory must be accepted.
  it("is not reported for a database this image migrated itself", async () => {
    expect(await findAheadSets(target, manifestSets(), null)).toEqual([]);
    await expect(assertNotAhead(target, manifestSets(), null)).resolves.toBeUndefined();
  });

  it("is named, with its set and the unknown hash, once a newer image's migration is recorded", async () => {
    // The shape a branch image leaves behind: a journal row whose hash this image ships no file for.
    // Written directly rather than by running a synthetic migration, because the row IS the artefact
    // the check reads — and drizzle records nothing else about a migration.
    const unknown = "f".repeat(64);
    // The table name reaches SQL as an identifier (no placeholder binds one), but the VALUES are
    // bound — CLAUDE.md §3 forbids concatenating them and explicitly rejects "the callers only pass
    // safe values" as a defence.
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
      applyMigrations(directory, migrationOptionsFor(manifestSets(), null)),
    ).resolves.toBeUndefined();
    expect(await coreJournalRows()).toBe(before);
    expect(await findAheadSets(target, manifestSets(), null)).toEqual([
      { set: "core", unknownMigrations: ["f".repeat(64)] },
    ]);
  });
});
