import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPostgresDb } from "@waitron/db";
import { POSTGRES_IMAGE } from "@waitron/db/testing/postgres.js";
import { applyMigrations } from "./apply.js";
import { manifestSets, migrationOptionsFor } from "./manifest.js";

let container: StartedPostgreSqlContainer;
let uri: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  uri = container.getConnectionUri();
}, 180_000);

afterAll(async () => {
  if (container !== undefined) await container.stop();
});

describe("applyMigrations under two concurrent hosts", () => {
  it("serialises on the advisory lock and leaves one journal row per migration", async () => {
    const options = migrationOptionsFor(manifestSets(), null);
    // core is options[0] (the manifest puts it first) — its own _journal.json on disk is the
    // ground truth this test checks the database against below, not a second, hand-maintained
    // expectation that could drift from the real migration count on its own.
    const coreJournal = JSON.parse(
      await readFile(join(options[0]!.migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    // A single connection, used only to READ the journal back afterwards — `applyMigrations` no
    // longer takes a `Database` to migrate over, it opens and closes its own from `uri` (see its
    // doc comment in apply.ts), so there is nothing left for a caller-supplied handle to do
    // during the migration itself.
    const reader = await createPostgresDb(uri);
    try {
      // Two replicas started together is the case the lock exists for. Without it, both run
      // Drizzle's migrator concurrently against the same empty journal table. Drizzle's journal
      // schema (`id serial primary key, hash text not null, created_at bigint`) carries no unique
      // constraint on `hash`, so a lost-update race does not fail loudly — it inserts the SAME
      // migration twice. The migrator decides what is already applied from
      // `order by created_at desc limit 1`, which a doubled journal still satisfies, so the
      // duplication stays silent at every later boot too, not just this one.
      //
      // Concurrent `CREATE TABLE IF NOT EXISTS`/its implicit `CREATE SEQUENCE`, the ONE time the
      // journal table itself doesn't exist yet, is the failure Postgres does throw on its own —
      // confirmed by a no-lock control run against this exact test, which reproduced
      // `duplicate key value violates unique constraint "pg_class_relname_nsp_index"` 3/3 times.
      // That crash is a narrower, first-boot-only hazard than the silent duplication above; the
      // lock closes both, and the exact-count assertion below is what catches the one crashing
      // wouldn't: a doubled journal on a database that was already migrated once before.
      //
      // What this test does and does not prove: the successful `Promise.all` below plus the
      // exact-count assertion show the lock prevents both the concurrent-DDL crash and a silent
      // double-application. It does NOT show the lock is held on a single DEDICATED session rather
      // than the connection the migration statements themselves run over — with only two hosts and
      // one connection each, this test could pass whether or not the two were the same session by
      // coincidence. That property — acquire and release on the SAME session, and a migration
      // connection that is never the long-lived pool the rest of the host runs duties over — is
      // established by reading `applyMigrations` in apply.ts (a dedicated `pg.Client` for the
      // lock, a freshly opened and closed `Database` for the migration work, both from the same
      // connection string), not by anything observable from outside like this test.
      await Promise.all([applyMigrations(uri, options), applyMigrations(uri, options)]);

      // The assertion this test is named for: exactly one journal row per migration FILE, not
      // merely "more than zero". A doubled journal (20 rows for 10 migrations) would still satisfy
      // a bare count() > 0 check — comparing against core's own _journal.json is what catches it.
      const journal = await reader.execute<{ count: string }>(
        sql`select count(*) as count from __drizzle_migrations_db`,
      );
      expect(Number(journal.rows[0]!.count)).toBe(coreJournal.entries.length);

      // Idempotent on a current database: a third run applies nothing new.
      await applyMigrations(uri, options);
      const third = await reader.execute<{ count: string }>(
        sql`select count(*) as count from __drizzle_migrations_db`,
      );
      expect(third.rows[0]!.count).toBe(journal.rows[0]!.count);
    } finally {
      await reader.close();
    }
  });
});
