import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
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
import { historicalSets } from "../../../scripts/fixtures/a760-history/historical-set.mjs";
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
    const directory = await migratedDirectory("wt-epoch-old-db-", historicalSets());
    const oldCore = historicalSets().find((set) => set.name === "core")!;
    const oldCoreHashes = readMigrationFiles({ migrationsFolder: oldCore.migrationsFolder }).map(
      (migration) => migration.hash,
    );

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
    // `assertNotAhead` is unchanged by A760, so the old image is modelled by its migration files alone.
    const oldImage: MigrationSetSource[] = historicalSets().map((set) => ({
      name: set.name,
      table: set.migrationsTable,
      from: set.migrationsFolder,
      ...(set.database === undefined ? {} : { database: set.database }),
    }));
    const newCore = manifestSets().find((set) => set.name === "core")!;

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
