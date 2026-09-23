import { isAppError, sqliteFailureOf } from "@waitron/shared";
import "./errors.js";

/**
 * The engine cannot open the venue file at all: the state volume is not mounted, the directory is
 * not there, or the process cannot read it. SQLITE_CANTOPEN (14) is what every one of those arrives
 * as — measured 2026-09-22 on Node v26.7.0, a missing file opened read-only and a path under a
 * directory that does not exist both give `unable to open database file`, errcode 14.
 *
 * A LIST, like the tables this replaces, so that adding a code is a decision with a name rather
 * than widening a pattern.
 *
 * **What is deliberately NOT here: SQLITE_NOTADB (26), `file is not a database`.** Neither shipped
 * code fits it — the file is reachable, and its schema is not what is wrong with it — and naming a
 * third code is a product decision, not a classification one: it needs a registry entry and English
 * and Spanish operator wording (CLAUDE.md §3). So a corrupted venue file reaches the page as
 * `unknown`, with the driver's own message on the installer's channel.
 */
export const UNREACHABLE_RESULT_CODES: readonly number[] = [14];

/**
 * The database does not carry the schema this image expects.
 *
 * **Matched on the MESSAGE, and it has to be.** This engine reports a missing table and a missing
 * column as errcode 1, `SQL logic error` — and so is an ordinary mistake in a query (measured
 * 2026-09-22, Node v26.7.0: `select * from tenants` against a virgin file, `select legal_name from
 * tenants` against a table without it, and `select from where`, all errcode 1). This code's
 * operator action is "restore from a backup, or reinstall", so classifying on the number alone
 * would send a box's operator to restore a healthy database over a typo. The control for that is a
 * case in `boot-failure.test.ts`.
 *
 * The cost of matching text: a release that reworded either message leaves this reading `unknown`,
 * silently. Nothing warns.
 */
const SCHEMA_MISSING = /^no such (table|column): /;

const UNREACHABLE = new Set(UNREACHABLE_RESULT_CODES);

/**
 * The best code the entrypoint can name for a boot failure, sitting between `runEntry`'s catch and
 * the recovery state — so the unauthenticated page shows a classification rather than the single
 * word `unknown` that told the first real box's operator nothing.
 *
 * **A socket failure is no longer a database failure, and this no longer says it is.** The list of
 * Node socket codes that used to answer `provisioning.database_unreachable` is gone with the
 * networked cluster: the database is a file this process opens, so nothing it does can be refused
 * by a socket. A socket failure reaching here now comes from something else on the boot path, and
 * telling a box's operator to check the database settings for it would be worse than `unknown`.
 * The loss, stated plainly: nothing classifies a socket failure at boot any more.
 *
 * `unknown` is the rare fallback now. `runEntry` writes the scrubbed error to the container's stdout
 * for every failure OF THE BOOT SEQUENCE ITSELF — not for every failure: `readRecoveryState` and the
 * pre-boot counter write happen before that try block, and the counter write is deliberately allowed
 * to throw, so a box whose state volume is unwritable exits with only `server.boot_failed
 * { errorCode }` and no detail. Measured on the built bundle: an unwritable state directory prints
 * that one line and nothing else. The page does not promise otherwise — it tells the operator to ask
 * whoever installed the box, which is true either way.
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
