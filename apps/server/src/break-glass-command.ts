import { and, eq } from "drizzle-orm";
import { type Database, withTenant } from "@waitron/db";
import { hasCode, isAppError } from "@waitron/shared";
import { assertPasswordLength, hashPassword, hashPin, persons } from "@waitron/identity";

type Env = Record<string, string | undefined>;

/**
 * `waitron-break-glass` — the PHYSICAL break-glass admin reset. The first admin has no self-service
 * password reset, and every gated reset (`@waitron/identity`'s `setPassword`/`resetPin`) needs a
 * `person.manage` management session a locked-out admin cannot obtain. This resets the admin's
 * dashboard password (and, optionally, PIN) and REACTIVATES a suspended admin, for the box's single
 * tenant, gated ONLY by physical shell access plus the box's `DATABASE_URL` — nothing at the
 * application layer.
 *
 * The ungated reset lives HERE, not in `@waitron/identity`, on purpose: exposing a reusable ungated
 * reset from the identity package would be a permission-bypass anyone could import. This command
 * writes `persons` directly (the same columns `setPassword`/`resetPin` set) under `withTenant`, so
 * the write is still scoped by RLS to the box's tenant — the reset is ungated by PERMISSION, never
 * by TENANT.
 *
 * Secrets come from the environment, NEVER argv — an argv element leaks into the process table
 * (`ps`), the same reason `waitron-recovery`/`register-till` read theirs from env. The new password
 * is `WAITRON_BREAKGLASS_PASSWORD` (required — the dashboard lockout is the password); a PIN reset is
 * opt-in via `WAITRON_BREAKGLASS_PIN`. `argv` carries only an optional `--person <id>` to
 * disambiguate when a tenant somehow has more than one admin.
 *
 * Exported so the flow is unit-tested without a subprocess; a thin `bin-break-glass.ts` wrapper (a
 * later task) supplies `process.argv.slice(2)`/`process.env`/`createPostgresDb` and exits on the
 * returned code. Returns a process exit code: 0 on success, 2 on a usage/config error (missing env,
 * too-short password), 1 on an operational error (no admin, ambiguous admins, `--person` names a
 * non-admin).
 */
export async function runBreakGlassReset(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  connect: (url: string) => Promise<Database>;
}): Promise<number> {
  const databaseUrl = deps.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    deps.out("DATABASE_URL must be set to the box's database connection string");
    return 2;
  }
  const tenantId = deps.env.WAITRON_TILL_TENANT_ID;
  if (tenantId === undefined || tenantId === "") {
    deps.out("WAITRON_TILL_TENANT_ID must be set to the box's tenant id");
    return 2;
  }
  const newPassword = deps.env.WAITRON_BREAKGLASS_PASSWORD;
  if (newPassword === undefined || newPassword === "") {
    // The dashboard lockout IS the password, so a reset with no new password is meaningless. Read
    // from env only — never argv, which `ps` exposes.
    deps.out("WAITRON_BREAKGLASS_PASSWORD must be set to the new dashboard password");
    return 2;
  }
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
  // Optional PIN reset. Length is NOT enforced here: the dashboard password is the break-glass
  // credential, and a wrong-length PIN would fail `persons_pin_hash_ck` only if empty — `hashPin`
  // always produces a non-empty hash, so any provided value is storable. (A caller who wants the
  // policy floor uses the gated `resetPin`.)
  const newPin = deps.env.WAITRON_BREAKGLASS_PIN;

  const personArg = parsePersonArg(deps.argv);

  const db = await deps.connect(databaseUrl);
  try {
    return await withTenant(db, tenantId, async (tx) => {
      // RLS scopes this select to the box's tenant, so "the admin(s)" already means "of this tenant".
      const admins = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(eq(persons.role, "admin"));

      if (admins.length === 0) {
        deps.out(`break-glass: no admin found for tenant ${tenantId}`);
        return 1;
      }

      let targetId: string;
      if (personArg !== undefined) {
        const match = admins.find((a) => a.id === personArg);
        if (match === undefined) {
          deps.out(`break-glass: --person ${personArg} is not an admin of tenant ${tenantId}`);
          return 1;
        }
        targetId = match.id;
      } else if (admins.length > 1) {
        deps.out("break-glass: multiple admins found; re-run with --person <id>:");
        for (const a of admins) deps.out(`  ${a.id}`);
        return 1;
      } else {
        targetId = admins[0]!.id;
      }

      // Same columns `setPassword`/`resetPin`/`reactivatePerson` set — reactivate in the same write.
      const updated = await tx
        .update(persons)
        .set({
          passwordHash: hashPassword(newPassword),
          ...(newPin !== undefined && newPin !== "" ? { pinHash: hashPin(newPin) } : {}),
          status: "active",
        })
        .where(and(eq(persons.id, targetId), eq(persons.role, "admin")))
        .returning({ id: persons.id });

      if (updated.length !== 1) {
        // Under RLS + a matched admin id this is exactly 1; anything else means the row vanished
        // between the select and the update (a concurrent delete) — report rather than pretend.
        deps.out(`break-glass: expected to reset one admin, affected ${String(updated.length)}`);
        return 1;
      }

      const resets = newPin !== undefined && newPin !== "" ? "password, pin" : "password";
      // NEVER echo the new secret — name the admin and WHAT was reset only.
      deps.out(`break-glass: reset admin ${targetId} (${resets}, reactivated)`);
      return 0;
    });
  } finally {
    await db.close();
  }
}

/** Pull the value of an optional `--person <id>` flag out of argv. Returns `undefined` when the flag
 * is absent. Everything else in argv is ignored — the secret NEVER travels there. */
function parsePersonArg(argv: string[]): string | undefined {
  const i = argv.indexOf("--person");
  if (i === -1) return undefined;
  return argv[i + 1];
}
