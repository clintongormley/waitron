// Real PostgreSQL: the behaviour under test is drizzle's watermark arithmetic against a real
// journal table, and PGlite would be a false pass twice over (CLAUDE.md §4).
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  databaseUrl,
  startPostgresContainer,
  type StartedContainer,
} from "@waitron/db/testing/postgres.js";
import { applyMigrations } from "./apply.js";

const CORE_DRIZZLE = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const TABLE = "__drizzle_migrations_db";
const scratch: string[] = [];

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const journal = JSON.parse(readFileSync(join(CORE_DRIZZLE, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
} & Record<string, unknown>;

/** A migrations folder carrying the given entries, with `when` values as supplied. */
function folderOf(entries: readonly JournalEntry[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-complete-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  for (const entry of entries) {
    copyFileSync(join(CORE_DRIZZLE, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return dir;
}

describe("applyMigrations refuses to report success on an incomplete set", () => {
  let container: StartedContainer;

  beforeAll(async () => {
    container = await startPostgresContainer();
  }, 180_000);

  afterAll(async () => {
    // Guarded: `startPostgresContainer` may have thrown, leaving `container` unassigned.
    if (container !== undefined) await container.stop();
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  async function freshDatabase(name: string): Promise<string> {
    const admin = new Client({ connectionString: container.uri });
    await admin.connect();
    try {
      await admin.query(`create database "${name}"`);
    } finally {
      await admin.end();
    }
    return databaseUrl(container.uri, name);
  }

  /** Journal rows in `uri`'s `TABLE` — one per migration drizzle actually applied. */
  async function journalRows(uri: string): Promise<number> {
    const client = new Client({ connectionString: uri });
    await client.connect();
    try {
      const result = await client.query<{ n: number }>(`select count(*)::int as n from "${TABLE}"`);
      return result.rows[0]!.n;
    } finally {
      await client.end();
    }
  }

  it("throws migrations.incomplete when drizzle's watermark skipped a migration", async () => {
    const uri = await freshDatabase("wt_incomplete");
    const first = journal.entries[0]!;
    const second = journal.entries[1]!;
    // A database migrated by a folder whose ONE entry carries a HIGH `when` …
    await applyMigrations(uri, [
      {
        migrationsFolder: folderOf([{ ...first, when: 9_000_000_000_000 }]),
        migrationsTable: TABLE,
      },
    ]);
    // … then handed a folder whose second entry sits BELOW that watermark. Drizzle applies nothing
    // and raises nothing; this is exactly the shape that skipped five core migrations in silence.
    await expect(
      applyMigrations(uri, [
        {
          migrationsFolder: folderOf([
            { ...first, when: 9_000_000_000_000 },
            { ...second, when: 1 },
          ]),
          migrationsTable: TABLE,
        },
      ]),
    ).rejects.toMatchObject({ code: "migrations.incomplete" });
  }, 180_000);

  it("resolves for a set that applied completely — the control", async () => {
    const uri = await freshDatabase("wt_complete");
    const folder = folderOf(journal.entries.slice(0, 2));
    await expect(
      applyMigrations(uri, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    expect(await journalRows(uri)).toBe(2);
    // And again, idempotently: a re-run applies nothing and must still be complete, or every second
    // boot of a healthy box would throw. The row count is asserted on BOTH sides so this is a
    // measurement rather than a pair of answers that look alike: an idempotent re-run that resolved
    // because it silently re-applied both migrations would read 4 here.
    await expect(
      applyMigrations(uri, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    expect(await journalRows(uri)).toBe(2);
  }, 180_000);

  it("resolves for a database holding MORE journal rows than the folder ships", async () => {
    // The other direction, pinned because the comparison is `applied < expected` rather than
    // `!==` on purpose: a journal row this image ships no migration for is a database migrated by a
    // NEWER image, which is a different fault with its own code and its own remedy
    // (`provisioning.database_ahead`). Naming it "incomplete" here — with `applied 3, expected 2` —
    // would put a misleading count in front of the one reader who cannot debug it, and would take
    // the case away from the check that CAN name it.
    const uri = await freshDatabase("wt_ahead");
    const folder = folderOf(journal.entries.slice(0, 2));
    await applyMigrations(uri, [{ migrationsFolder: folder, migrationsTable: TABLE }]);
    const client = new Client({ connectionString: uri });
    await client.connect();
    try {
      // The artefact a newer image leaves behind: a journal row, ahead of every shipped `when`.
      await client.query(`insert into "${TABLE}" ("hash", "created_at") values ($1, $2)`, [
        "f".repeat(64),
        9_999_999_999_999,
      ]);
    } finally {
      await client.end();
    }
    await expect(
      applyMigrations(uri, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    ).resolves.toBeUndefined();
    expect(await journalRows(uri)).toBe(3);
  }, 180_000);
});
