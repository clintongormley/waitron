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

/** `exclusive: false` because break-glass runs beside a running server (`deploy/README.md`). */
export async function openBreakGlassVenue(
  directory: string,
): Promise<{ db: Database; close(): Promise<void> }> {
  const store = await openVenueDatabase(directory, { exclusive: false });
  return { db: store.venue, close: () => store.close() };
}

/**
 * `waitron-break-glass`: the physical admin reset for an admin locked out of every gated reset. It
 * resets the password (and optionally the PIN), clears the admin's other login factors and
 * reactivates the account.
 *
 * The ungated reset lives here, not in `@waitron/identity`, because an importable ungated reset
 * would be a permission bypass. Secrets come from the environment, never argv, which `ps` shows.
 *
 * Returns the exit code: 0 on success, 2 on a usage or config error, 1 on an operational error.
 */
export async function runBreakGlassReset(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  openDb?: (directory: string) => Promise<{ db: Database; close(): Promise<void> }>;
}): Promise<number> {
  // The lockout IS the password, so a reset without a new one is meaningless.
  const newPassword = requireEnv(
    deps,
    "WAITRON_BREAKGLASS_PASSWORD",
    "WAITRON_BREAKGLASS_PASSWORD must be set to the new dashboard password",
  );
  if (newPassword === undefined) return 2;
  try {
    assertPasswordLength(newPassword);
  } catch (err) {
    if (isAppError(err) && hasCode(err, "password.too_short")) {
      deps.out(`new password too short: minimum ${String(err.params.min)} characters`);
      return 2;
    }
    throw err;
  }
  const newPin = deps.env.WAITRON_BREAKGLASS_PIN;
  const resetPin = newPin !== undefined && newPin !== "";
  if (resetPin) {
    // A PIN below the floor the till enforces would lock the operator out again.
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
    // Treated as absent, it would reset the sole admin the operator did not name.
    deps.out("--person requires an id, e.g. `--person <id>`");
    return 2;
  }
  const personArg = parsedPerson.id;

  const stateDir = resolveConfigDir(deps.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  // The same resolution `config.ts` does for `venueDir`.
  const venueDir = resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(stateDir, "venue"));

  const opened = await (deps.openDb ?? openBreakGlassVenue)(venueDir);
  try {
    try {
      return await withTransaction(opened.db, async (tx) => {
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
          deps.out(`break-glass: expected to reset one admin, affected ${String(updated.length)}`);
          return 1;
        }

        await tx.execute(sql`delete from webauthn_credentials where person_id=${targetId}`);
        await tx.execute(sql`delete from recovery_codes where person_id=${targetId}`);
        await tx.execute(sql`delete from totp_enrollments where person_id=${targetId}`);
        // `nowIso`, because raw SQL never reaches a column's write mapping and these three columns
        // are `tsString`.
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
        // Never echo the new secret.
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

/** A blank value counts as unset (CLAUDE.md §3). */
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

/** `ok: false` means the flag was given with no value, a usage error distinct from its absence. */
function parsePersonArg(argv: string[]): { ok: true; id: string | undefined } | { ok: false } {
  const i = argv.indexOf("--person");
  if (i === -1) return { ok: true, id: undefined };
  const value = argv[i + 1];
  if (value === undefined || value === "") return { ok: false };
  return { ok: true, id: value };
}
