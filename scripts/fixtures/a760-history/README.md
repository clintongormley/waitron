# The migration history before the A760 squash (test-only)

A760 replaced every package's `drizzle/` history with one starting migration per set. A few tests
check what a single old migration did to rows written under the schema before it, so they need the
old history. This folder keeps it, frozen.

- **Taken from** commit `59be31e3b72b2db0bc5e26f47a1ef305ea052d4c`, the last commit before the
  squash. Each folder is named after the old set as `packages/migrations/migrations.manifest.json`
  named it then (`core` came from `packages/db/drizzle`, `node` from `packages/node-db/drizzle`, the
  rest from the package of the same name). `fiscal-none` had no migrations and is left out.
- **What was copied:** every `.sql` file and `meta/_journal.json`, byte for byte. The snapshot files
  were not copied: drizzle's `readMigrationFiles` (in `drizzle-orm/migrator.js`) reads only the
  journal and the `<tag>.sql` file each journal entry names. The journals keep their original
  `when` dates.
- **`old-migrations.manifest.json`** is `packages/migrations/migrations.manifest.json` from that
  commit, byte for byte: each old set's journal table, append-only tables and database, in the
  order the old runner applied them.
- **`manifest.json`** records, for each set, the folder it came from, its migrations table, how
  many journal entries it had, the SHA-256 of its journal and of every SQL file, and the sets its
  old module descriptor `requires` (copied from `packages/composition/src/modules.ts` and
  `packages/media/src/module.ts` at that commit). It also holds the SHA-256 of
  `old-migrations.manifest.json`. `scripts/a760-history-fixture.test.ts` checks those hashes and
  that the two manifests agree, and checks that nothing that builds the server's `dist/drizzle/`
  or the image copies this folder.
- **Test-only.** It is never shipped and never run against a venue. Do not edit it: a changed byte
  no longer describes what venues ran.

A test asks for one old set with `historicalSet("<old set name>")`, or for the whole old world
with `historicalSets()`, from `historical-set.mjs`. Each set comes back shaped as `applyMigrations`
takes it: `{ name, migrationsFolder, migrationsTable, appendOnlyTables, database?, requires }`.
`historicalSets()` leaves out `fiscal-none`: a venue ran it or `fiscal-verifactu`, never both. A
test that applies several sets takes them all from here, never mixing in today's. Copy a folder
somewhere temporary before cutting its journal; never write into this one.
