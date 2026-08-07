import { captureError, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { loginWithPin } from "../src/login.js";
import { loginManager } from "../src/manager-login.js";
import { hashPin } from "../src/verify-pin.js";
import { hashPassword } from "../src/verify-password.js";
import type { PersonRoleValue } from "../src/permissions.js";

/**
 * Seed helpers shared by the identity LOGIC suites (authorize / login / staff), which drive
 * `loginWithPin`/`authorize`/the staff-admin API on PGlite. All seed as the connection OWNER
 * (superuser on PGlite, so RLS is bypassed — pure setup, exactly as `@waitron/db`'s own `seedTenant`
 * documents). Under `test/`, so out of the english-only scan and the src coverage glob, mirroring
 * `packages/workforce/test/fixtures.ts`. The real-PG `sessions.rls.test.ts` keeps its own
 * `seedTillAndPerson` — it seeds location+till+person together for a caller-supplied tenant and its
 * shape genuinely differs.
 */

/** Seed a location → till for `tenantId`. Returns the till id a session references. */
export async function seedTill(db: Database, tenantId: string): Promise<string> {
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Main', array['en'], 'Sale on premises') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Till 1') returning id`);
  return till.rows[0]!.id;
}

/** A person of the given role and status whose PIN is "1234". role/status are passed explicitly so a
 * test seeds a real row of that shape rather than relying on a later UPDATE. */
export async function seedPerson(
  db: Database,
  tenantId: string,
  role: "staff" | "supervisor" | "manager" | "admin" = "staff",
  status: "active" | "suspended" = "active",
): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into persons (tenant_id, display_name, pin_hash, role, status)
    values (${tenantId}, 'P', ${hashPin("1234")}, ${role}, ${status}) returning id`);
  return rows.rows[0]!.id;
}

/** Opens a shift session for a person (PIN "1234") and returns its id, exactly as the till would:
 * `loginWithPin` verifies the PIN and inserts the row. */
export async function openSession(
  db: Database,
  tenantId: string,
  tillId: string,
  personId: string,
): Promise<string> {
  const session = await withTenant(db, tenantId, (tx) =>
    loginWithPin(tx, { tenantId, tillId, personId, pin: "1234" }),
  );
  return session.id;
}

/**
 * Seeds a person of `role` with a known password and returns an OPEN management session for them —
 * the dashboard analogue of `openSession`. `seedPerson` leaves `password_hash` null, so it is set
 * here via a raw update (under `withTenant`) before `loginManager` verifies it. "correct horse" is
 * length 13, above `MIN_PASSWORD_LENGTH`, so a real login path accepts it. Default role `manager`
 * holds `person.manage`; pass `"staff"` for the refusal cases.
 */
export async function openManagementSession(
  db: Database,
  tenantId: string,
  role: PersonRoleValue = "manager",
): Promise<{ personId: string; sessionId: string }> {
  const personId = await seedPerson(db, tenantId, role);
  await withTenant(db, tenantId, (tx) =>
    tx.execute(
      sql`update persons set password_hash = ${hashPassword("correct horse")} where id = ${personId}`,
    ),
  );
  const session = await withTenant(db, tenantId, (tx) =>
    loginManager(tx, { tenantId, personId, password: "correct horse" }),
  );
  return { personId, sessionId: session.id };
}

/** The AppError code a rejected call threw, or a describing string when it was not an AppError. */
export async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}
