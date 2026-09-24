import { captureError, locations, tills, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { loginWithPin } from "../src/login.js";
import { persons } from "../src/schema/persons.js";
import { loginManager } from "../src/manager-login.js";
import { hashPin } from "../src/verify-pin.js";
import { hashPassword } from "../src/verify-password.js";
import type { PersonRoleValue } from "../src/permissions.js";

/**
 * Seed helpers shared by the identity LOGIC suites (authorize / login / staff), which drive
 * `loginWithPin`/`authorize`/the staff-admin API. Pure setup, never a case — nothing here asserts,
 * exactly as `@waitron/db`'s own `seedTenant` documents. Under `test/`, so out of the
 * english-only scan and the src coverage glob, mirroring `packages/workforce/test/fixtures.ts`.
 */

/** Seed a location → till. Returns the till id a session references.
 *
 * Inserted through the table definitions rather than as raw SQL, exactly as
 * `packages/workforce/test/fixtures.ts`'s `seedLocation` is: `locations.id`, `tills.id` and
 * `tills.created_at` are JavaScript generators (`$defaultFn`), which only the insert BUILDER runs,
 * and `invoice_locales` is a JSON array in a text column that the `labelList` helper serialises
 * from the plain array passed here. */
export async function seedTill(db: Database): Promise<string> {
  const [location] = await db
    .insert(locations)
    .values({ name: "Main", invoiceLocales: ["en"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  const [till] = await db
    .insert(tills)
    .values({ locationId: location!.id, name: "Till 1" })
    .returning({ id: tills.id });
  return till!.id;
}

/** A person of the given role and status whose PIN is "1234". role/status are passed explicitly so a
 * test seeds a real row of that shape rather than relying on a later UPDATE.
 *
 * Inserted through the `persons` table definition for the same reason as {@link seedTill}:
 * `persons.id` and `persons.created_at` are `$defaultFn` generators (`src/schema/persons.ts:27`
 * and `:67`), so a raw INSERT omitting them writes nothing there. */
export async function seedPerson(
  db: Database,
  role: "staff" | "supervisor" | "manager" | "admin" = "staff",
  status: "pending" | "active" | "suspended" = "active",
): Promise<string> {
  const displayName = `P-${crypto.randomUUID()}`;
  const [row] = await db
    .insert(persons)
    .values({ displayName, pinHash: hashPin("1234"), role, status })
    .returning({ id: persons.id });
  return row!.id;
}

/** Opens a shift session for a person (PIN "1234") and returns its id, exactly as the till would:
 * `loginWithPin` verifies the PIN and inserts the row. */
export async function openSession(db: Database, tillId: string, personId: string): Promise<string> {
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { tillId, personId, pin: "1234" }),
  );
  return session.id;
}

/**
 * Seeds a person of `role` and sets the known dashboard password "correct horse" via a raw update —
 * `seedPerson` leaves `password_hash` null. "correct horse" is length 13, above `MIN_PASSWORD_LENGTH`,
 * so a real login path accepts it. Returns the person id. Default role `manager` holds `person.manage`;
 * pass `"staff"` for the refusal cases.
 */
export async function seedPersonWithPassword(
  db: Database,
  role: PersonRoleValue = "manager",
): Promise<string> {
  const personId = await seedPerson(db, role);
  await withTransaction(db, (tx) =>
    tx.execute(
      sql`update persons set password_hash = ${hashPassword("correct horse")} where id = ${personId}`,
    ),
  );
  return personId;
}

/**
 * Seeds a person who can sign in on the DASHBOARD (management) path: a known `email`, the known
 * password "correct horse", plus an explicit `role`/`status`. `loginManager` now resolves by email,
 * so every management-login fixture must carry one (unique case-insensitively — the seeded value is
 * already lowercase). Returns the person id.
 */
export async function seedManager(
  db: Database,
  opts: { email: string; role?: PersonRoleValue; status?: "pending" | "active" | "suspended" },
): Promise<string> {
  const personId = await seedPerson(db, opts.role ?? "manager", opts.status ?? "active");
  await withTransaction(db, (tx) =>
    tx.execute(
      sql`update persons set password_hash = ${hashPassword("correct horse")}, email = ${opts.email} where id = ${personId}`,
    ),
  );
  return personId;
}

/**
 * Seeds a manager (known email + password) and returns an OPEN management session for them — the
 * dashboard analogue of `openSession`. The email is unique per call so many managers can be seeded
 * without colliding on the email index.
 */
export async function openManagementSession(
  db: Database,
  role: PersonRoleValue = "manager",
): Promise<{ personId: string; token: string }> {
  const email = `mgr-${crypto.randomUUID()}@example.test`;
  const personId = await seedManager(db, { email, role });
  const session = await withTransaction(db, (tx) =>
    loginManager(tx, { email, password: "correct horse" }),
  );
  return { personId, token: session.token };
}

/** The AppError code a rejected call threw, or a describing string when it was not an AppError. */
export async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}
