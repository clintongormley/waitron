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
 * value and no localisation bundle references it. `packages/db/src/errors.ts` documents the one
 * prior clean rename made on the same reasoning.
 *
 * The prefix had to change because `server.*` is reserved for facts about the host PROCESS
 * (`apps/server/src/errors.ts` says so in its own doc comment), and "a migration set is not where
 * it should be" is a fact about the migration set. An earlier version of this comment kept
 * `server.` on the grounds that "`apps/server` is still the only thing that can actually hit it in
 * production" — true when written, and made false by this package's own reason for existing:
 * `@waitron/provisioning` depends on it in order to run migrations from a second binary. Renaming
 * after that ships would have cost a permanent deprecate-and-add instead of a find-replace.
 *
 * The precedent is `tenant.not_found`, in the very file this code was cut from: it dropped the
 * `server.` prefix for the identical reason — the domain concept outlived the package that
 * happened to declare it.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A manifest set's folder is absent, or present with no `meta/_journal.json`. */
    "migrations.set_missing": { name: string; folder: string };
  }
}
