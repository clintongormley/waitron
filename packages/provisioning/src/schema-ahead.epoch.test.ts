import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database } from "@waitron/db";
import {
  applyMigrations,
  imageMigrationHashes,
  manifestSets,
  migrationOptionsFor,
  type MigrationSetSource,
} from "@waitron/migrations";
import { assertNotAhead } from "./schema-ahead.js";

const scratch: string[] = [];
afterAll(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

async function migratedDirectory(
  prefix: string,
  sets: Parameters<typeof applyMigrations>[1],
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(directory);
  await applyMigrations(directory, sets);
  return directory;
}

const CORE = manifestSets().find((set) => set.name === "core")!;

/**
 * Gives a freshly migrated file what a pre-squash one carried: `core` journal rows this image does
 * not ship, and the journal of `catalogue`, a set this image no longer has.
 */
async function withForeignCoreJournal(directory: string, hashes: readonly string[]): Promise<void> {
  const store = await openVenueDatabase(directory);
  try {
    await store.venue.execute(
      sql`create table "__drizzle_migrations_catalogue" (id integer primary key, hash text not null, created_at numeric)`,
    );
    await store.venue.execute(sql`delete from ${sql.identifier(CORE.table)}`);
    for (const [index, hash] of hashes.entries())
      await store.venue.execute(
        sql`insert into ${sql.identifier(CORE.table)} ("hash", "created_at") values (${hash}, ${index + 1})`,
      );
  } finally {
    await store.close();
  }
}

/** A `core` migrations folder holding one migration this image does not ship. */
async function foreignCoreFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "wt-epoch-old-image-"));
  scratch.push(folder);
  await mkdir(join(folder, "meta"));
  const tag = "0000_foreign";
  await writeFile(join(folder, `${tag}.sql`), "CREATE TABLE `foreign_only` (`id` text);\n");
  await writeFile(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [{ idx: 0, version: "6", when: 1, tag, breakpoints: true }],
    }),
  );
  return folder;
}

/** Every schema object and every migration journal row in one file, as text to compare. */
async function fileState(db: Database): Promise<string> {
  const objects = await db.execute<{ type: string; name: string; sql: string | null }>(
    sql`select type, name, sql from sqlite_master order by type, name`,
  );
  const journals = objects.rows.filter(
    (row) => row.type === "table" && row.name.startsWith("__drizzle_migrations_"),
  );
  const rows: Record<string, unknown[]> = {};
  for (const { name } of journals) {
    const result = await db.execute(
      sql`select * from ${sql.identifier(name)} order by created_at, hash`,
    );
    rows[name] = result.rows;
  }
  return JSON.stringify({ objects: objects.rows, rows });
}

describe("the migration epoch", () => {
  it("an old database is refused by this image before anything is written", async () => {
    const directory = await migratedDirectory(
      "wt-epoch-old-db-",
      migrationOptionsFor(manifestSets(), null),
    );
    const oldCoreHashes = ["a".repeat(64), "b".repeat(64)];
    await withForeignCoreJournal(directory, oldCoreHashes);

    const store = await openVenueDatabase(directory);
    try {
      const before = { venue: await fileState(store.venue), node: await fileState(store.node) };
      expect(before.venue).toContain("__drizzle_migrations_catalogue");

      const refusal = assertNotAhead(store, manifestSets(), null);
      await expect(refusal).rejects.toMatchObject({
        code: "provisioning.database_ahead",
        params: { set: "core" },
      });
      const { params } = (await refusal.catch((error: unknown) => error)) as {
        params: { unknownMigrations: string[] };
      };
      expect([...params.unknownMigrations].sort()).toEqual([...oldCoreHashes].sort());

      expect({ venue: await fileState(store.venue), node: await fileState(store.node) }).toEqual(
        before,
      );
    } finally {
      await store.close();
    }
  });

  it("a database this image migrated is refused by an image from before the squash", async () => {
    const directory = await migratedDirectory(
      "wt-epoch-new-db-",
      migrationOptionsFor(manifestSets(), null),
    );
    const oldImage: MigrationSetSource[] = [{ ...CORE, from: await foreignCoreFolder() }];
    const newCore = CORE;

    const store = await openVenueDatabase(directory);
    try {
      await expect(assertNotAhead(store, oldImage, null)).rejects.toMatchObject({
        code: "provisioning.database_ahead",
        params: { set: "core", unknownMigrations: imageMigrationHashes(newCore, null) },
      });
    } finally {
      await store.close();
    }
  });
});
