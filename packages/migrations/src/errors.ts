import "@waitron/shared";

/**
 * `@waitron/migrations`'s contribution to the shared error registry.
 *
 * **Renamed from `server.migrations_missing` when this package was extracted from `apps/server`.**
 * That looks like a breach of the never-rename rule (`packages/shared/src/errors.ts`), so here is
 * why it is not, and why now was the only free moment:
 *
 * The rule exists because a code is a translation key and may already sit in a persisted record.
 * Neither applies to this one. It is thrown by `migrationOptionsFor` before the host finishes
 * booting — earlier than any tenant scope, any `incidents` row, or any display layer — so no stored
 * value and no localisation bundle references it. `packages/db/src/errors.ts` documents TWO prior
 * clean renames made on the same reasoning — that file says the code "has been renamed twice, and
 * both renames were clean", and enumerates both.
 *
 * The prefix had to change because `server.*` is reserved for facts about the host PROCESS
 * (`apps/server/src/errors.ts` says so in its own doc comment), and "a migration set is not where
 * it should be" is a fact about the migration set. An earlier version of this comment kept
 * `server.` on the grounds that "`apps/server` is still the only thing that can actually hit it in
 * production" — true when written, and unsafe to keep relying on: this package was extracted
 * precisely so a second binary could run the migration sets, and `@waitron/provisioning` is the
 * consumer it was extracted for. That consumer does not import it yet — as of this commit
 * `packages/provisioning`'s only dependency is `@waitron/shared` — so the second thrower is
 * intended, not present. Renaming after it ships would cost a permanent deprecate-and-add instead
 * of a find-replace, which is why now was the free moment rather than then.
 *
 * `tenant.not_found` (`apps/server/src/errors.ts`) is the closest SIBLING, not a precedent for
 * renaming: it was introduced under that name in `4fb3f2c` and never renamed —
 * `git log --all -S"server.tenant_not_found"` returns nothing — and its own comment calls it
 * "Deliberately NOT `server.*`". So it shows the naming rule being applied up front; it does not
 * show a rename. The prior renames are `series.not_found`'s, and there are TWO of them, both
 * enumerated in `packages/db/src/errors.ts`.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A manifest set's folder is absent, or present with no `meta/_journal.json`. */
    "migrations.set_missing": { name: string; folder: string };
    /**
     * A set's `table` is not a drizzle journal-table name (`__drizzle_migrations_<lowercase>`).
     * `appliedSchemaVersion` interpolates the table name into a `count(*)` over it — an identifier
     * a bind parameter cannot carry (§3) — so the name is validated before it reaches the SQL,
     * rather than trusting that "callers only pass safe values".
     */
    "migrations.invalid_table": { table: string };
  }
}
