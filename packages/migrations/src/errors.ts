import "@waitron/shared";

/**
 * `@waitron/migrations`'s contribution to the shared error registry.
 *
 * The code keeps its `server.` prefix through this move, deliberately. Codes are stable
 * identifiers and are never renamed (see `packages/shared/src/errors.ts`), and the prefix names
 * the domain concept — "the host's migration set is not where it should be" — not the package
 * whose source happens to hold the `throw`. `apps/server` is still the only thing that can
 * actually hit it in production.
 */
declare module "@waitron/shared" {
  interface ErrorParams {
    /** A manifest set's folder is absent, or present with no `meta/_journal.json`. */
    "server.migrations_missing": { name: string; folder: string };
  }
}
