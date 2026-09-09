import "./errors.js";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { normalizeEmail, isValidEmail } from "./email.js";
import { assertPasswordLength, hashPassword } from "./verify-password.js";
import { startManagementSession, type ManagementSession } from "./management-session.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";

export type AccountActionPurpose = "invitation" | "password_reset";

export const ACCOUNT_ACTION_TTL_MS = {
  invitation: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
} as const;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface IssuedAccountAction {
  id: string;
  personId: string;
  email: string;
  displayName: string;
  locale: string | null;
  purpose: AccountActionPurpose;
  token: string;
  expiresAt: string;
}

/** Issue a fresh action and invalidate any still-live predecessor of the same purpose. */
export async function issueAccountAction(
  tx: Transaction,
  input: {
    tenantId: string;
    personId: string;
    purpose: AccountActionPurpose;
    now?: Date;
  },
): Promise<IssuedAccountAction> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const [person] = await tx
    .select({
      email: persons.email,
      displayName: persons.displayName,
      locale: persons.locale,
      status: persons.status,
    })
    .from(persons)
    .where(and(eq(persons.id, input.personId), eq(persons.tenantId, input.tenantId)));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status === "suspended") {
    throw new AppError("person.suspended", { personId: input.personId });
  }
  if (person.email === null) throw new AppError("person.email_invalid", {});

  await tx
    .update(managementAccountActions)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.personId, input.personId),
        eq(managementAccountActions.purpose, input.purpose),
        isNull(managementAccountActions.usedAt),
      ),
    );

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ACCOUNT_ACTION_TTL_MS[input.purpose]).toISOString();
  const [row] = await tx
    .insert(managementAccountActions)
    .values({
      tenantId: input.tenantId,
      personId: input.personId,
      purpose: input.purpose,
      tokenHash: hashToken(token),
      createdAt: nowIso,
      expiresAt,
    })
    .returning({ id: managementAccountActions.id });
  return {
    id: row!.id,
    personId: input.personId,
    email: person.email,
    displayName: person.displayName,
    locale: person.locale,
    purpose: input.purpose,
    token,
    expiresAt,
  };
}

/** Find an active account without making an unknown or malformed email observable to the caller. */
export async function requestPasswordResetAction(
  tx: Transaction,
  input: { tenantId: string; email: string; now?: Date },
): Promise<IssuedAccountAction | null> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return null;
  const [person] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.tenantId, input.tenantId),
        eq(persons.email, email),
        eq(persons.status, "active"),
      ),
    );
  if (person === undefined) return null;
  return issueAccountAction(tx, {
    tenantId: input.tenantId,
    personId: person.id,
    purpose: "password_reset",
    now: input.now,
  });
}

/** Consume a valid bearer token, replace the password, end old sessions, and open a fresh session. */
export async function completeAccountAction(
  tx: Transaction,
  input: {
    tenantId: string;
    token: string;
    purpose: AccountActionPurpose;
    password: string;
    now?: Date;
  },
): Promise<ManagementSession> {
  assertPasswordLength(input.password);
  const nowIso = (input.now ?? new Date()).toISOString();
  const claimed = await tx
    .update(managementAccountActions)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.tokenHash, hashToken(input.token)),
        eq(managementAccountActions.purpose, input.purpose),
        isNull(managementAccountActions.usedAt),
        gt(managementAccountActions.expiresAt, nowIso),
      ),
    )
    .returning({ personId: managementAccountActions.personId });
  if (claimed.length !== 1) throw new AppError("account_action.invalid", {});
  const personId = claimed[0]!.personId;
  const passwordHash = hashPassword(input.password);
  const updated = await tx
    .update(persons)
    .set({ passwordHash, emailVerifiedAt: nowIso })
    .where(and(eq(persons.id, personId), eq(persons.tenantId, input.tenantId)))
    .returning({ id: persons.id });
  if (updated.length !== 1) throw new AppError("account_action.invalid", {});
  await tx
    .update(managementSessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(managementSessions.tenantId, input.tenantId),
        eq(managementSessions.personId, personId),
        isNull(managementSessions.endedAt),
      ),
    );
  return startManagementSession(tx, { tenantId: input.tenantId, personId });
}
