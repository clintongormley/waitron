import { firstCodeInCauseChain, isAppError, sqlStateOf } from "@waitron/shared";
import "./errors.js";

/**
 * Node socket-level failures. A refused connection is NOT a SQLSTATE — `sqlStateOf` returns null for
 * every one of these, because they are not five `[0-9A-Z]` characters — so this branch tests the
 * Node `code` itself. `waitForPostgres` already retries a refused connection for up to sixty
 * seconds, so reaching here means the failure outlasted that wait.
 */
export const UNREACHABLE_SOCKET_CODES: readonly string[] = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
];

/** Driver-level refusals to connect: bad password, no such database, cluster not accepting yet. */
export const UNREACHABLE_SQL_STATES: readonly string[] = ["28P01", "3D000", "57P03"];

/**
 * The database does not carry the schema this image expects. Written from the run-it experiment, not
 * before it (spec §6): `55P04` is the one the first real box actually produced — drizzle applies a
 * set's pending migrations in one transaction and PostgreSQL refuses to use an enum value added
 * inside it, so an upgrade aborts there.
 *
 * Each entry has to be UNAMBIGUOUSLY schema-shaped, because this code's operator action is "restore
 * from a backup, or reinstall". `22P02` was listed here (spec §4.1 still names it) and was removed
 * for failing that test: run on PostgreSQL 18, `select 'not-a-uuid'::uuid` and `select 'b'::t` for
 * an enum without a `b` return the SAME SQLSTATE, and the first is a malformed VALUE, not a missing
 * schema. Sending an operator to restore a healthy database over a bad boot-time value is worse than
 * saying `unknown` — and `unknown` now costs little, because the installer's channel carries the
 * driver's own message. Deviation recorded in the spec's §9 addendum.
 */
export const SCHEMA_MISMATCH_SQL_STATES: readonly string[] = [
  "42P01", // undefined_table
  "42703", // undefined_column
  "42704", // undefined_object
  "55P04", // object_not_in_prerequisite_state — unsafe use of a new enum value
];

const SOCKET = new Set(UNREACHABLE_SOCKET_CODES);
const UNREACHABLE = new Set(UNREACHABLE_SQL_STATES);
const MISMATCH = new Set(SCHEMA_MISMATCH_SQL_STATES);

/**
 * The first `code` in the cause chain that names a socket failure we classify, or null.
 *
 * Same walk as `sqlStateOf`, different predicate — `firstCodeInCauseChain` (`@waitron/shared`) is
 * the one copy, and it carries the depth-bound and self-reference arguments.
 */
function socketCodeOf(error: unknown): string | null {
  return firstCodeInCauseChain(error, (code) => SOCKET.has(code));
}

/**
 * The best code the entrypoint can name for a boot failure, sitting between `runEntry`'s catch and
 * the recovery state — so the unauthenticated page shows a classification rather than the single
 * word `unknown` that told the first real box's operator nothing.
 *
 * Both tables are EXHAUSTIVE BY CONSTRUCTION — membership in a pinned list, never a pattern — which
 * is what keeps `EPIPE` out: it is five upper-case characters and therefore passes `sqlStateOf`'s
 * shape filter, but it is in neither list, so it stays `unknown`. `boot-failure.test.ts` walks each
 * list and pins that control.
 *
 * `unknown` is the rare fallback now, and on the page it means "the installer can read the reason on
 * the box" — which is true, because `runEntry` writes the scrubbed error to stdout for every
 * failure.
 */
export function classifyBootFailure(error: unknown): string {
  if (isAppError(error)) return error.code;
  if (socketCodeOf(error) !== null) return "provisioning.database_unreachable";
  const sqlState = sqlStateOf(error);
  if (sqlState !== null) {
    if (UNREACHABLE.has(sqlState)) return "provisioning.database_unreachable";
    if (MISMATCH.has(sqlState)) return "provisioning.schema_mismatch";
  }
  return "unknown";
}
