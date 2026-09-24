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

/** Through the table definitions rather than raw SQL: `locations.id`, `tills.id` and
 * `tills.created_at` are `$defaultFn` generators, which only the insert BUILDER runs, and
 * `labelList` serialises `invoice_locales` from the plain array passed here. */
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

/** A person whose PIN is "1234". Through the `persons` table definition for the same reason as
 * {@link seedTill}: `persons.id` and `persons.created_at` are `$defaultFn` generators. */
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

/** Opens a shift session through `loginWithPin`, as the till would. */
export async function openSession(db: Database, tillId: string, personId: string): Promise<string> {
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { tillId, personId, pin: "1234" }),
  );
  return session.id;
}

/** A person whose dashboard password is "correct horse". */
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

/** A person who can sign in on the dashboard: `email` and the password "correct horse". */
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

/** Seeds a manager and returns an open management session for them. */
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
