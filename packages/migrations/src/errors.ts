import "@waitron/shared";

/** `@waitron/migrations`'s contribution to the shared error registry. */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A manifest set's folder is absent, or present with no `meta/_journal.json`. */
    "migrations.set_missing": { name: string; folder: string };
    /**
     * A set's `table` is not a drizzle journal-table name (`__drizzle_migrations_<lowercase>`).
     * `appliedSchemaVersion` and `journalHashes` both interpolate the table name into a query over
     * it — an identifier a bind parameter cannot carry — so the name is validated before it
     * reaches the SQL.
     */
    "migrations.invalid_table": { table: string };
    /**
     * A migration set reported success with fewer migrations applied than the image ships.
     *
     * Drizzle skips an entry whose `when` sits at or below the watermark the database already
     * recorded, and raises nothing (CLAUDE.md §3; measured in #310).
     *
     * Both counts are journal lengths — public facts about a build artefact, never data.
     */
    "migrations.incomplete": { set: string; applied: number; expected: number };
  }
}
