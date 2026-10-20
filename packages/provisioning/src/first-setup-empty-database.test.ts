import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { firstSetupDatabaseIsEmpty } from "./first-setup-empty-database.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
async function inspect(
  edit: (connection: DatabaseSync) => void = () => {},
  root: string | null = null,
  requiredSets: readonly string[] = ["core"],
) {
  const directory = await mkdtemp(join(tmpdir(), "setup-empty-proof-"));
  let connection: DatabaseSync | undefined;
  try {
    const file = join(directory, "venue.db");
    await suite.db.archiveTo(file);
    // Parent rows must not mask a missing scan of the retained row's own table.
    connection = new DatabaseSync(file, { enableForeignKeyConstraints: false });
    edit(connection);
    connection.close();
    const before = await readFile(file);
    connection = new DatabaseSync(file, { readOnly: true });
    const result = await firstSetupDatabaseIsEmpty(connection, root, requiredSets);
    connection.close();
    connection = undefined;
    expect(await readFile(file)).toEqual(before);
    return result;
  } finally {
    connection?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

it("accepts a fully migrated empty schema through a read-only connection", async () => {
  expect(await inspect()).toBe(true);
});
it("reads the image schema from the configured copied migration folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-empty-image-"));
  try {
    const sets = manifestSets();
    const sources = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await cp(sources[index]!.migrationsFolder, join(root, set.name), { recursive: true });
    expect(await inspect(undefined, root)).toBe(true);
    const meta = join(root, "core/meta");
    for (const name of await readdir(meta))
      if (name.endsWith("_snapshot.json")) await rm(join(meta, name));
    expect(await inspect(undefined, root)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each([
  [
    "catalogue",
    "insert into catalogues(id, name, created_at, updated_at) values ('menu', 'Retained', '2026-10-16', '2026-10-16')",
  ],
  [
    "invoice series",
    "insert into invoice_series(id, node_id, code, next_number) values ('series', 'node', 'A', 2)",
  ],
  [
    "sale",
    "insert into sales(id, source, series_id, node_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values ('sale', 'operator_script', 'series', 'node', 1, '2026-10-16T12:00:00Z', 0, 100, '[]', 'en', '[\"en\"]', 'none', 'not_applicable')",
  ],
  [
    "fiscal filing",
    "insert into filing_cases(id, registro_id, cause, evidence, opened_at) values ('filing', 'registro', 'retained', '{}', 1)",
  ],
  [
    "scheduler",
    "insert into scheduled_runs(id, duty, period_from, period_to, state, created_at, updated_at) values ('run', 'close', '2026-10-15', '2026-10-16', 'succeeded', '2026-10-16', '2026-10-16')",
  ],
])("refuses retained %s rows without a taxpayer or location", async (_name, insert) => {
  expect(await inspect((connection) => connection.exec(insert))).toBe(false);
});
it.each([
  ["unknown table", 'create table "retained""data" (value text)'],
  ["unknown journal", 'create table "__drizzle_migrations_unknown" (hash text)'],
  ["missing module table", 'drop table "scheduled_runs"'],
  ["missing module column", 'alter table "scheduled_runs" drop column "summary"'],
  ["missing module journal", 'drop table "__drizzle_migrations_scheduler"'],
  ["view", 'create view "retained_view" as select * from catalogues'],
])("refuses a %s instead of certifying an incomplete or unknown schema", async (_name, edit) => {
  expect(await inspect((connection) => connection.exec(edit))).toBe(false);
});
it("refuses when the configured image schema cannot be read", async () => {
  expect(await inspect(undefined, "/missing/setup-empty-proof-migrations")).toBe(false);
});
it("refuses a completely missing required module, including its journal", async () => {
  expect(
    await inspect(
      (connection) => {
        connection.exec('drop table "scheduled_runs"');
        connection.exec('drop table "__drizzle_migrations_scheduler"');
      },
      null,
      ["core", "scheduler"],
    ),
  ).toBe(false);
});
it("refuses an unknown required migration set", async () => {
  expect(await inspect(undefined, null, ["core", "unknown-module"])).toBe(false);
});
