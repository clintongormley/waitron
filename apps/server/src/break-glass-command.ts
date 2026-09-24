import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import {
  isUniqueViolation,
  nowIso,
  openVenueDatabase,
  type Database,
  withTransaction,
} from "@waitron/db";
import { hasCode, isAppError } from "@waitron/shared";
import {
  assertPasswordLength,
  assertPinLength,
  hashPassword,
  hashPin,
  persons,
} from "@waitron/identity";
import { DEFAULT_STATE_ROOT } from "./boot.js";
import { resolveConfigDir } from "./config.js";

type Env = Record<string, string | undefined>;

/**
 * The handle the reset runs on: the VENUE file of this node's own venue directory.
 *
 * `persons` and the login-factor tables are venue-side — `applyMigrations` applies every set to the
 * venue handle and leaves the node file empty (`packages/migrations/src/apply.ts`), the same fact
 * `rejoin-command.ts`'s `openVenue` records. `close` closes BOTH files, because
 * `openVenueDatabase` opens `node.db` beside `venue.db` and a CLI that exits holding either leaves
 * them to process teardown.
 *
 * No lock: break-glass is run beside a running server (`deploy/README.md`).
 */
export async function openBreakGlassVenue(
  directory: string,
): Promise<{ db: Database; close(): Promise<void> }> {
  const store = await openVenueDatabase(directory, { exclusive: false });
  return { db: store.venue, close: () => store.close() };
}

/**
 * `waitron-break-glass` — the PHYSICAL break-glass admin reset. The first admin has no self-service
 * password reset, and every administrative reset needs a `person.manage` session a locked-out admin
 * cannot obtain. This clears linked login factors, resets the password (and optionally the PIN), and
 * reactivates the admin for the box's single tenant.
 *
 * The deployment holds one tenant per database. The ungated reset lives HERE, not in
 * `@waitron/identity`, on purpose: exposing a reusable ungated reset from the identity package
 * would be a permission bypass anyone could import. This command writes the account and removes its
 * login factors under `withTransaction`; the write is by id.
 *
 * Secrets come from the environment, NEVER argv — an argv element leaks into the process table
 * (`ps`), the same reason `waitron-recovery`/`register-till` read theirs from env. The new password
 * is `WAITRON_BREAKGLASS_PASSWORD` (required — the dashboard lockout is the password); a PIN reset is
 * opt-in via `WAITRON_BREAKGLASS_PIN`. `argv` carries only an optional `--person <id>` to
 * disambiguate when a tenant somehow has more than one admin.
 *
 * WHICH database is no longer a connection string: the engine is a directory holding `venue.db` and
 * `node.db`, and the two directory settings follow `config.ts`'s own resolution, where an unset OR
 * EMPTY value takes the default rather than `resolve("")` — the working directory ("an empty value
 * is a valid value", CLAUDE.md §3). This is the resolution `rejoin-command.ts` and
 * `restore-command.ts` do, not a third one:
 *  - `WAITRON_STATE_DIR` — the state root the venue directory defaults under. Unset or empty =
 *    `DEFAULT_STATE_ROOT`.
 *  - `WAITRON_VENUE_DIR` — the directory holding the two files. Unset or empty = `<stateDir>/venue`.
 *
 * Exported so the flow is unit-tested without a subprocess; the thin `bin-break-glass.ts` wrapper
 * supplies `process.argv.slice(2)`/`process.env` and exits on the returned code. Returns a process
 * exit code: 0 on success, 2 on a usage/config error (missing env, too-short password), 1 on an
 * operational error (no admin, ambiguous admins, `--person` names a non-admin).
 */
export async function runBreakGlassReset(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  /** DI for tests; defaults to {@link openBreakGlassVenue} over the resolved venue directory. */
  openDb?: (directory: string) => Promise<{ db: Database; close(): Promise<void> }>;
}): Promise<number> {
  // Every required value is read from env only — never argv, which `ps` exposes. A blank value is
  // treated as unset (the empty-string trap, CLAUDE.md §3): `requireEnv` fails closed with a usage
  // message. The dashboard lockout IS the password, so a reset with no new password is meaningless.
  const newPassword = requireEnv(
    deps,
    "WAITRON_BREAKGLASS_PASSWORD",
    "WAITRON_BREAKGLASS_PASSWORD must be set to the new dashboard password",
  );
  if (newPassword === undefined) return 2;
  try {
    // Reuse identity's floor so the break-glass password cannot be weaker than a gated reset's.
    assertPasswordLength(newPassword);
  } catch (err) {
    if (isAppError(err) && hasCode(err, "password.too_short")) {
      deps.out(`new password too short: minimum ${String(err.params.min)} characters`);
      return 2;
    }
    throw err;
  }
  // Optional PIN reset.
  const newPin = deps.env.WAITRON_BREAKGLASS_PIN;
  // One named condition, used by both the UPDATE (whether to set `pin_hash`) and the log line, so the
  // two can never drift on what "a PIN was given" means.
  const resetPin = newPin !== undefined && newPin !== "";
  if (resetPin) {
    // Enforce the same PIN floor as self-service profile changes. A
    // break-glass PIN that stores fine but falls below the floor the till keypad/login enforces would
    // re-lock the operator — the opposite of what this command is for. Too-short → usage error (2).
    try {
      assertPinLength(newPin!);
    } catch (err) {
      if (isAppError(err) && hasCode(err, "pin.too_short")) {
        deps.out(`new PIN too short: minimum ${String(err.params.min)} digits`);
        return 2;
      }
      throw err;
    }
  }

  const parsedPerson = parsePersonArg(deps.argv);
  if (!parsedPerson.ok) {
    // `--person` with nothing after it is an operator typo. Fail loudly rather than silently
    // degrading to "no --person", which would reset the sole admin the operator did not name.
    deps.out("--person requires an id, e.g. `--person <id>`");
    return 2;
  }
  const personArg = parsedPerson.id;

  const stateDir = resolveConfigDir(deps.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  // The same resolution `config.ts` does for `venueDir`, against the state root that won above.
  const venueDir = resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(stateDir, "venue"));

  const opened = await (deps.openDb ?? openBreakGlassVenue)(venueDir);
  try {
    try {
      return await withTransaction(opened.db, async (tx) => {
        // The read is unfiltered: these are the box's admins.
        const admins = await tx
          .select({ id: persons.id })
          .from(persons)
          .where(eq(persons.role, "admin"));

        if (admins.length === 0) {
          deps.out("break-glass: no admin found on this box");
          return 1;
        }

        let targetId: string;
        if (personArg !== undefined) {
          if (!admins.some((a) => a.id === personArg)) {
            deps.out(`break-glass: --person ${personArg} is not an admin of this box`);
            return 1;
          }
          targetId = personArg;
        } else if (admins.length > 1) {
          deps.out("break-glass: multiple admins found; re-run with --person <id>:");
          for (const a of admins) deps.out(`  ${a.id}`);
          return 1;
        } else {
          targetId = admins[0]!.id;
        }

        const updated = await tx
          .update(persons)
          .set({
            passwordHash: hashPassword(newPassword),
            ...(resetPin ? { pinHash: hashPin(newPin!) } : {}),
            totpSecret: null,
            googleSubject: null,
            status: "active",
          })
          .where(and(eq(persons.id, targetId), eq(persons.role, "admin")))
          .returning({ id: persons.id });

        if (updated.length !== 1) {
          // With a matched admin id this is exactly 1; anything else means the row vanished between
          // the select and the update (a concurrent delete) — report rather than pretend.
          deps.out(`break-glass: expected to reset one admin, affected ${String(updated.length)}`);
          return 1;
        }

        await tx.execute(sql`delete from webauthn_credentials where person_id=${targetId}`);
        await tx.execute(sql`delete from recovery_codes where person_id=${targetId}`);
        await tx.execute(sql`delete from totp_enrollments where person_id=${targetId}`);
        // One clock reading for the three stamps, so the reset lands as one moment. `nowIso`
        // rather than `now` because raw SQL never reaches a column's own write mapping, and all
        // three of these columns are `tsString` — the spelling `@waitron/identity`'s own writers
        // use, which is what makes a later `<` on them a correct time ordering
        // (`packages/printing/src/runtime.ts` has the four-way measurement).
        const revokedAt = nowIso();
        await tx.execute(
          sql`update management_account_actions set used_at=${revokedAt} where person_id=${targetId} and used_at is null`,
        );
        await tx.execute(
          sql`update management_sessions set ended_at=${revokedAt} where person_id=${targetId} and ended_at is null`,
        );
        await tx.execute(
          sql`update sessions set ended_at=${revokedAt} where person_id=${targetId} and ended_at is null`,
        );

        const resets = resetPin ? "password, pin" : "password";
        // NEVER echo the new secret — name the admin and WHAT was reset only.
        deps.out(`break-glass: reset admin ${targetId} (${resets}, reactivated)`);
        return 0;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        deps.out("break-glass: that display name is already used by an active account");
        return 1;
      }
      throw error;
    }
  } finally {
    await opened.close();
  }
}

/** Read a REQUIRED env var, treating a blank value as unset (CLAUDE.md §3). On miss, emits `message`
 * and returns `undefined` (the caller returns exit code 2); otherwise returns the value. */
function requireEnv(
  deps: { env: Env; out: (line: string) => void },
  key: string,
  message: string,
): string | undefined {
  const value = deps.env[key];
  if (value === undefined || value === "") {
    deps.out(message);
    return undefined;
  }
  return value;
}

/** Pull the value of an optional `--person <id>` flag out of argv. `ok:false` means the flag was
 * given with no following value (a usage error, not "flag absent"); on `ok:true`, `id` is the value
 * or `undefined` when the flag is absent. Everything else in argv is ignored — the secret NEVER
 * travels there. */
function parsePersonArg(argv: string[]): { ok: true; id: string | undefined } | { ok: false } {
  const i = argv.indexOf("--person");
  if (i === -1) return { ok: true, id: undefined };
  const value = argv[i + 1];
  if (value === undefined || value === "") return { ok: false };
  return { ok: true, id: value };
}
