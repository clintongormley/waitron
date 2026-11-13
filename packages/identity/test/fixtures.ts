import { seedPersons } from "./person-rows.js";
import { captureError, locations, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { seedDevice, seedVenue } from "@waitron/db/testing/seed.js";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { loginWithPin } from "../src/login.js";
import { loginManager } from "../src/manager-login.js";
import { hashSessionToken } from "../src/session-token.js";
import { hashPin } from "../src/verify-pin.js";
import { hashPassword } from "../src/verify-password.js";
import type { BuiltInRoleKey } from "../src/permissions.js";
import type { TotpKeyRing } from "../src/mfa.js";

export const TOTP_KEY_RING: TotpKeyRing = { current: { version: 1, key: Buffer.alloc(32, 0x5) } };

/** Pairs a new device at the venue (seeding the venue on first use) and returns its id: the device
 * a shift session is opened on. */
export async function seedSessionDevice(db: Database): Promise<string> {
  const [existing] = await db.select({ id: locations.id }).from(locations).limit(1);
  if (existing === undefined) {
    await seedVenue(db, {
      name: "Main",
      invoiceLocales: ["en"],
      operationDescription: "Sale on premises",
    });
  }
  const { deviceId } = await seedDevice(db);
  return deviceId;
}

/** A person whose PIN is "1234". Through the `persons` table definition rather than raw SQL:
 * `persons.id` and `persons.created_at` are `$defaultFn` generators, which only the insert BUILDER
 * runs. */
export async function seedPerson(
  db: Database,
  role: "staff" | "supervisor" | "manager" | "admin" = "staff",
  status: "pending" | "active" | "suspended" = "active",
): Promise<string> {
  const displayName = `P-${crypto.randomUUID()}`;
  const [row] = await seedPersons(db, { displayName, pinHash: hashPin("1234"), role, status });
  return row!.id;
}

/** Opens a shift session through `loginWithPin`, as the till would. */
export async function openSession(
  db: Database,
  deviceId: string,
  personId: string,
): Promise<string> {
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { deviceId, personId, pin: "1234" }),
  );
  return session.id;
}

/** A person whose dashboard password is "correct horse". */
export async function seedPersonWithPassword(
  db: Database,
  role: BuiltInRoleKey = "manager",
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
  opts: { email: string; role?: BuiltInRoleKey; status?: "pending" | "active" | "suspended" },
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
  role: BuiltInRoleKey = "manager",
): Promise<{ personId: string; token: string }> {
  const email = `mgr-${crypto.randomUUID()}@example.test`;
  const personId = await seedManager(db, { email, role });
  const session = await withTransaction(db, (tx) =>
    loginManager(tx, { email, password: "correct horse", totpKeyRing: TOTP_KEY_RING }),
  );
  return { personId, token: session.token };
}

export async function openFreshManagementSession(
  db: Database,
  role: BuiltInRoleKey = "manager",
): Promise<{ personId: string; token: string }> {
  const session = await openManagementSession(db, role);
  await withTransaction(db, (tx) =>
    tx.execute(sql`update management_sessions
    set proved_at = ${new Date().toISOString()} where token_hash = ${hashSessionToken(session.token)}`),
  );
  return session;
}

/** The AppError code a rejected call threw, or a describing string when it was not an AppError. */
export async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

/**
 * The code, params and log-only reason a rejected call threw, for comparing two refusals whole: the
 * code and params are the answer, the reason is what only the log sees.
 */
export async function refusalOf(fn: () => Promise<unknown>): Promise<unknown> {
  const error = await captureError(fn);
  return isAppError(error)
    ? { code: error.code, params: error.params, reason: error.reason }
    : error;
}
