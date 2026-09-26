import { isAppError, sqliteFailureOf } from "@waitron/shared";
import "./errors.js";

/**
 * Result codes meaning the engine cannot open the venue file at all (SQLITE_CANTOPEN): a list, so
 * adding a code is a named decision rather than a widened pattern.
 *
 * Deliberately NOT here: SQLITE_NOTADB (26), `file is not a database`. Naming a third code is a
 * product decision needing a registry entry and English and Spanish operator wording, so a corrupted
 * venue file reaches the page as `unknown`.
 */
export const UNREACHABLE_RESULT_CODES: readonly number[] = [14];

/**
 * Matched on the MESSAGE because a missing table or column and an ordinary query mistake share
 * errcode 1, and this code's operator action is "restore from a backup, or reinstall". A release
 * that rewords the message leaves this reading `unknown`, silently.
 */
const SCHEMA_MISSING = /^no such (table|column): /;

const UNREACHABLE = new Set(UNREACHABLE_RESULT_CODES);

/**
 * The code recorded for a boot failure. The unauthenticated recovery page's title and action are
 * fixed text chosen by this code; what else the page shows is at `OPERATOR_TEXT`
 * (`recovery-surface.ts`). A socket failure is not classified: the database is a file, so it cannot
 * come from the database.
 */
export function classifyBootFailure(error: unknown): string {
  if (isAppError(error)) return error.code;
  const failure = sqliteFailureOf(error);
  if (failure !== null) {
    if (UNREACHABLE.has(failure.errcode)) return "provisioning.database_unreachable";
    if (SCHEMA_MISSING.test(failure.message)) return "provisioning.schema_mismatch";
  }
  return "unknown";
}
