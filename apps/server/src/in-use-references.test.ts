import { getTableName, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Reference } from "./in-use.js";
import { COURSE_REFERENCES } from "./kitchen.js";

/**
 * Every foreign key into `kitchen_courses` in a venue migrated with every set is a reference that
 * keeps the row from being deleted. Weaker than its name: it reads declared foreign keys only, so an id kept in a column
 * with no key, in JSON or in text is not seen, and neither is a key a set outside the manifest adds.
 */

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function keysInto(parent: string): Promise<string[]> {
  const { rows } = await suite.db.execute<{ child: string; column: string }>(sql`
    select m.name as child, f."from" as column
    from sqlite_master m join pragma_foreign_key_list(m.name) f
    where m.type = 'table' and f."table" = ${parent}`);
  return rows.map((row) => `${row.child}.${row.column}`).sort();
}

function named(references: readonly Reference[]): string[] {
  return references.map(({ table, column }) => `${getTableName(table)}.${column.name}`).sort();
}

describe("what can refer to a course", () => {
  it("lists every foreign key into kitchen_courses as a reference", async () => {
    expect(await keysInto("kitchen_courses")).toEqual(named(COURSE_REFERENCES));
  });
});
