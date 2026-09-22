import { firstCodeInCauseChain } from "./cause-chain.js";

/** Five characters, `[0-9A-Z]` — the shape SQLSTATE is defined to have. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The SQLSTATE of a driver failure, or `null` when there is none to be had.
 *
 * Nothing but a five-character `[0-9A-Z]` string ever leaves this function, and that is the entire
 * argument for printing its result into an operator's terminal. It is STRUCTURAL, not a promise
 * about who calls it: a generated password is 32 base64url characters (identifiers.ts) and a
 * connection string is longer still, so neither can satisfy the pattern. A non-SQLSTATE error code
 * that happens to match — Node's `EPIPE` is five upper-case characters — would pass this filter,
 * and is equally not a secret; the filter is a shape guard, not an identification.
 *
 * The `.cause` walk it is built on lives in `cause-chain.ts`, which carries the depth and
 * self-reference arguments. That the code can sit DOWN that chain rather than on the caught error
 * is pinned only against HAND-BUILT errors now: `sql-state.test.ts`'s "reads a SQLSTATE code nested
 * under .cause", the same shape in `cause-chain.test.ts`, and the `failedMigration` helper in
 * `apps/server/src/dev-migration-hint.test.ts`, each of which assembles the wrapper itself. The
 * real-container case that used to force a genuine driver failure through it went with the
 * PostgreSQL deployment model, and nothing replaced it — on this engine nothing could. Measured on Node v26.7.0 against
 * `node:sqlite`: a unique-index, primary-key, NOT NULL and missing-table refusal all arrive with
 * `code: "ERR_SQLITE_ERROR"` and the discriminating number on `errcode`
 * (`packages/db/src/sql-state.ts`), so this function returns `null` for every refusal the live
 * engine produces.
 *
 * It lives in `@waitron/shared` rather than beside any one caller. Two callers are left, both in
 * `apps/server`: `classifyBootFailure` (`boot-failure.ts`) and `withDevMigrationHint`
 * (`dev-migration-hint.ts`). `@waitron/provisioning`'s `sql-state.ts` still re-exports it, but no
 * file in that package imports it any more — the instance path that did was deleted with the
 * PostgreSQL deployment model. The safety argument above is the kind that must not be maintained in
 * several copies.
 */
export function sqlStateOf(error: unknown): string | null {
  return firstCodeInCauseChain(error, (code) => SQLSTATE.test(code));
}
