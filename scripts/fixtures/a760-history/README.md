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
- **`manifest.json`** records, for each set, the folder it came from, its migrations table, how
  many journal entries it had, and the SHA-256 of its journal and of every SQL file.
  `scripts/a760-history-fixture.test.ts` checks those hashes, and checks that nothing that builds
  the server's `dist/drizzle/` or the image copies this folder.
- **Test-only.** It is never shipped and never run against a venue. Do not edit it: a changed byte
  no longer describes what venues ran.

A test asks for an old set with `historicalSet("<old set name>")` from `historical-set.mjs`, which
returns `{ migrationsFolder, migrationsTable }`. Copy the folder somewhere temporary before cutting
its journal; never write into this one.
