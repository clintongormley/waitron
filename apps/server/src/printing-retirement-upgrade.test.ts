import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";

async function snapshot(directory: string) {
  const store = await openVenueDatabase(directory);
  try {
    const tables = store.venue.all<{ name: string }>(sql`
      select name from sqlite_schema
      where type = 'table' and name not glob 'sqlite_*' order by name`);
    const rows: Record<string, unknown> = {};
    for (const { name } of tables)
      rows[name] = store.venue.all(sql`select * from ${sql.identifier(name)}`);
    const schema = store.venue.all(sql`
      select name, sql from sqlite_schema
      where type in ('table', 'index', 'trigger') and name not glob 'waitron_change_*'
      order by name`);
    return { rows, schema };
  } finally {
    await store.close();
  }
}

it.each(["source", "issued"])(
  "refuses the populated %s venue upgrade and rolls back core changes",
  async (name) => {
    const directory = await mkdtemp(join(tmpdir(), "waitron-printing-retirement-"));
    try {
      const fixture = await readFile(
        new URL(`./testing/fixtures/printing-retirement-${name}.db.gz`, import.meta.url),
      );
      await writeFile(join(directory, "venue.db"), gunzipSync(fixture));
      const before = await snapshot(directory);
      expect(before.rows.locations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ receipt_print_mode: "auto", drawer_open_policy: "gated" }),
        ]),
      );
      if (name === "issued") {
        expect(before.rows.sales).toHaveLength(1);
        expect(before.rows.registros_facturacion).toHaveLength(1);
      }
      await expect(
        applyMigrations(directory, migrationOptionsFor(manifestSets(), null)),
      ).rejects.toMatchObject({
        code: "migrations.apply_failed",
        params: { set: "__drizzle_migrations_db" },
        cause: {
          message: expect.stringContaining("DROP TABLE `locations`"),
          cause: {
            message: "FOREIGN KEY constraint failed",
            code: "ERR_SQLITE_ERROR",
            errcode: 1811,
          },
        },
      });
      expect(await snapshot(directory)).toEqual(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
