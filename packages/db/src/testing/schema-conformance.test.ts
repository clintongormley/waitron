// Unit cases for the suite factory beside this file, covering the pieces of it that the suite it
// builds cannot reach from inside this package.
//
// Two kinds of piece. The refusals exist for declaration shapes no core table has, so running the
// core suite executes none of them. And the staging — migrate the subject and answer with the
// tables that appeared — is reached through `setup`, which runs once per database; driving it here
// is what lets it be run from two different starting points and the two answers compared.
//
// The assembled suite itself is exercised over the core set by `../schema/schema-conformance.test.ts`.
import { is, sql } from "drizzle-orm";
import { getTableConfig, SQLiteTable, unique } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { id, label, table } from "../schema/columns.js";
import * as coreBarrel from "../schema/index.js";
import { fromDatabase, fromDeclaration, stageSubjectTables } from "./schema-conformance.js";
import { useVenueDb } from "./venue-db.js";

// Two databases with different starting points, which is the whole of the staging case below: one
// nothing has migrated, and one already carrying the subject's tables. Driven twice against a
// SINGLE database the pair would measure nothing (`CLAUDE.md` §1) — the second answer would be
// empty because the first call had migrated the subject, which is also what a staging that simply
// reported an empty list would answer.
const unmigrated = useVenueDb({ migrations: [], resetPerTest: false });
const alreadyCarryingCore = useVenueDb({
  // The same folder and journal as `CORE_MIGRATIONS`, with `appendOnlyTables` omitted rather than
  // copied: the field is optional (`./venue-db.ts`) and a set declaring none is a real shape. The
  // staging call below still gets the same `CORE_MIGRATIONS` object the virgin database gets, so
  // the starting point is the only difference between the two.
  migrations: [
    {
      migrationsFolder: CORE_MIGRATIONS.migrationsFolder,
      migrationsTable: CORE_MIGRATIONS.migrationsTable,
    },
  ],
  resetPerTest: false,
});

/**
 * Every table the core schema barrel declares.
 *
 * Read here rather than through the factory's own `tablesIn`, so that the expectation and the
 * answer it checks cannot be wrong together.
 */
const coreDeclaredTables = Object.values<unknown>(coreBarrel)
  .filter((value): value is SQLiteTable => is(value, SQLiteTable))
  .map((declared) => getTableConfig(declared).name)
  .sort();

describe("the schema-conformance suite factory", () => {
  it("refuses a declared default that renders with bind parameters", () => {
    const boundDefault = table("bound_default_probe", {
      id: id("id").primaryKey(),
      // A value interpolated into an `sql` template renders as a placeholder, which is the shape the
      // refusal is about. `enumCheck` avoids it with `.inlineParams()` (`../schema/columns.ts`).
      zone: label("zone").default(sql`${"Europe/Madrid"}`),
    });
    expect(() => fromDeclaration(boundDefault)).toThrow(
      "a column default on zone renders with bind parameters (?); write it as an inline sql`…` " +
        "template so it can be compared with the statement the migration stored",
    );
  });

  it("reads a name for both unique shapes, including one the declaration left unnamed", () => {
    const uniqueShapes = table(
      "unique_shapes_probe",
      { id: id("id").primaryKey(), code: label("code"), slug: label("slug").unique() },
      (self) => [unique().on(self.code)],
    );
    // Neither shape names itself here, and both arrive named: drizzle derives the name in the
    // constraint's own constructor and in the column builder's `build`. That is what makes
    // `fromDeclaration`'s unnamed-constraint refusal unreachable through a declaration, and that
    // refusal's comment cites this case — so if a drizzle upgrade starts answering `undefined`, this
    // fails rather than the refusal quietly becoming live code again.
    expect(fromDeclaration(uniqueShapes).indexes).toEqual([
      "unique unique_shapes_probe_code_unique(code)",
      "unique unique_shapes_probe_slug_unique(slug)",
    ]);
  });

  it("refuses a table the database stored no CREATE TABLE for", () => {
    expect(() => fromDatabase(unmigrated.db, "never_migrated_probe")).toThrow(
      "no CREATE TABLE stored for never_migrated_probe",
    );
  });

  it("answers with the tables the subject built, and with none where they were there already", async () => {
    // One subject set from two starting points, and the two answers are DIFFERENT. On a database
    // nothing has migrated it names every table the set builds; on one already carrying those
    // tables it names none. The second answer is what shows the staging reports the difference it
    // took around the subject rather than whatever the database happens to hold — a module's suite
    // runs on exactly that second kind of database, its prerequisites having migrated first.
    const onVirgin = await stageSubjectTables(unmigrated.db, CORE_MIGRATIONS);
    expect([...onVirgin].sort()).toEqual(coreDeclaredTables);

    expect(await stageSubjectTables(alreadyCarryingCore.db, CORE_MIGRATIONS)).toEqual([]);
  });
});
