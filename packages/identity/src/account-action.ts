import "./errors.js";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { isUniqueViolation, uniqueViolationConstraint, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { normalizeEmail, isValidEmail } from "./email.js";
import { assertPasswordLength, hashPassword } from "./verify-password.js";
import { assertPinLength, hashPin } from "./verify-pin.js";
import { startManagementSession, type ManagementSession } from "./management-session.js";
import { managementAccountActions } from "./schema/management-account-actions.js";
import { managementSessions } from "./schema/management-sessions.js";
import { persons } from "./schema/persons.js";

export type AccountActionPurpose = "invitation" | "password_reset" | "email_change";
type CredentialActionPurpose = Exclude<AccountActionPurpose, "email_change">;

export const ACCOUNT_ACTION_TTL_MS = {
  invitation: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
  email_change: 30 * 60 * 1000,
} as const;
export const ACCOUNT_ACTION_CODE_TTL_MS = 10 * 60 * 1000;
export const ACCOUNT_ACTION_CODE_ATTEMPTS = 5;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashCode(
  key: Buffer,
  tenantId: string,
  email: string,
  purpose: string,
  code: string,
): string {
  return createHmac("sha256", key)
    .update(`${tenantId}\0${normalizeEmail(email)}\0${purpose}\0${code}`, "utf8")
    .digest("hex");
}

export interface IssuedAccountAction {
  id: string;
  personId: string;
  email: string;
  displayName: string;
  locale: string | null;
  purpose: AccountActionPurpose;
  token: string;
  code?: string;
  codeExpiresAt?: string;
  expiresAt: string;
}

/** Issue a fresh action and invalidate any still-live predecessor of the same purpose. */
export async function issueAccountAction(
  tx: Transaction,
  input: {
    tenantId: string;
    personId: string;
    purpose: AccountActionPurpose;
    codeKey?: Buffer;
    targetEmail?: string;
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
  if (input.purpose === "invitation" && person.status !== "pending") {
    throw new AppError("person.transition_invalid", {});
  }
  if (input.purpose === "email_change" && person.status !== "active") {
    throw new AppError("person.transition_invalid", {});
  }
  if (person.email === null) throw new AppError("person.email_invalid", {});
  const deliveryEmail =
    input.purpose === "email_change" ? normalizeEmail(input.targetEmail ?? "") : person.email;
  if (!isValidEmail(deliveryEmail)) throw new AppError("person.email_invalid", {});

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
  const code =
    input.codeKey === undefined ? undefined : String(randomInt(1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + ACCOUNT_ACTION_TTL_MS[input.purpose]).toISOString();
  const codeExpiresAt =
    code === undefined
      ? undefined
      : new Date(now.getTime() + ACCOUNT_ACTION_CODE_TTL_MS).toISOString();
  const [row] = await tx
    .insert(managementAccountActions)
    .values({
      tenantId: input.tenantId,
      personId: input.personId,
      purpose: input.purpose,
      targetEmail: input.purpose === "email_change" ? deliveryEmail : null,
      tokenHash: hashToken(token),
      codeHash:
        code === undefined
          ? null
          : hashCode(input.codeKey!, input.tenantId, deliveryEmail, input.purpose, code),
      codeExpiresAt: codeExpiresAt ?? null,
      createdAt: nowIso,
      expiresAt,
    })
    .returning({ id: managementAccountActions.id });
  return {
    id: row!.id,
    personId: input.personId,
    email: deliveryEmail,
    displayName: person.displayName,
    locale: person.locale,
    purpose: input.purpose,
    token,
    ...(code === undefined ? {} : { code, codeExpiresAt }),
    expiresAt,
  };
}

interface CompletionInput {
  tenantId: string;
  purpose: CredentialActionPurpose;
  password: string;
  pin?: string;
  now?: Date;
}

export async function confirmEmailChangeByCode(
  tx: Transaction,
  input: { tenantId: string; personId: string; code: string; codeKey: Buffer; now?: Date },
): Promise<string | null> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const [action] = await tx
    .select({
      id: managementAccountActions.id,
      codeHash: managementAccountActions.codeHash,
      targetEmail: managementAccountActions.targetEmail,
    })
    .from(managementAccountActions)
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.personId, input.personId),
        eq(managementAccountActions.purpose, "email_change"),
        isNull(managementAccountActions.usedAt),
        gt(managementAccountActions.expiresAt, nowIso),
        gt(managementAccountActions.codeExpiresAt, nowIso),
        lt(managementAccountActions.codeAttempts, ACCOUNT_ACTION_CODE_ATTEMPTS),
      ),
    )
    .orderBy(sql`${managementAccountActions.createdAt} desc`)
    .limit(1)
    .for("update");
  if (action?.codeHash === null || action?.targetEmail === null || action === undefined)
    return null;
  const supplied = Buffer.from(
    hashCode(input.codeKey, input.tenantId, action.targetEmail, "email_change", input.code),
    "hex",
  );
  const stored = Buffer.from(action.codeHash, "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    await tx
      .update(managementAccountActions)
      .set({ codeAttempts: sql`${managementAccountActions.codeAttempts} + 1` })
      .where(
        and(
          eq(managementAccountActions.tenantId, input.tenantId),
          eq(managementAccountActions.id, action.id),
        ),
      );
    return null;
  }
  const claimed = await tx
    .update(managementAccountActions)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.id, action.id),
        isNull(managementAccountActions.usedAt),
      ),
    )
    .returning({ id: managementAccountActions.id });
  if (claimed.length !== 1) return null;
  try {
    const changed = await tx
      .update(persons)
      .set({ email: action.targetEmail, pendingEmail: null, emailVerifiedAt: nowIso })
      .where(
        and(
          eq(persons.id, input.personId),
          eq(persons.tenantId, input.tenantId),
          eq(persons.pendingEmail, action.targetEmail),
        ),
      )
      .returning({ email: persons.email });
    if (changed.length !== 1) return null;
    return changed[0]!.email;
  } catch (error) {
    if (
      isUniqueViolation(error) &&
      uniqueViolationConstraint(error) === "persons_tenant_email_uq"
    ) {
      throw new AppError("person.email_taken", { email: action.targetEmail });
    }
    throw error;
  }
}

export interface AccountActionCompletion {
  personId: string;
  session: ManagementSession | null;
}

export interface AccountActionInspection {
  email: string;
  purpose: CredentialActionPurpose;
}

function statusAcceptsPurpose(
  status: "pending" | "active" | "suspended",
  purpose: CredentialActionPurpose,
): boolean {
  return purpose === "invitation" ? status === "pending" : status === "active";
}

/** Validate a bearer action without consuming it or opening a session. Completion checks it again. */
export async function inspectAccountAction(
  tx: Transaction,
  input: {
    tenantId: string;
    token: string;
    purpose: CredentialActionPurpose;
    now?: Date;
  },
): Promise<AccountActionInspection> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const [action] = await tx
    .select({ email: persons.email, status: persons.status })
    .from(managementAccountActions)
    .innerJoin(
      persons,
      and(
        eq(persons.id, managementAccountActions.personId),
        eq(persons.tenantId, managementAccountActions.tenantId),
      ),
    )
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.tokenHash, hashToken(input.token)),
        eq(managementAccountActions.purpose, input.purpose),
        isNull(managementAccountActions.usedAt),
        gt(managementAccountActions.expiresAt, nowIso),
      ),
    )
    .limit(1);
  if (
    action?.email === null ||
    action === undefined ||
    !statusAcceptsPurpose(action.status, input.purpose)
  ) {
    throw new AppError("account_action.invalid", {});
  }
  return { email: action.email, purpose: input.purpose };
}

/** Validate an emailed short code without consuming it. A wrong guess is still counted. */
export async function inspectAccountActionByCode(
  tx: Transaction,
  input: {
    tenantId: string;
    email: string;
    code: string;
    purpose: CredentialActionPurpose;
    codeKey: Buffer;
    now?: Date;
  },
): Promise<AccountActionInspection | null> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const email = normalizeEmail(input.email);
  const [action] = await tx
    .select({
      id: managementAccountActions.id,
      codeHash: managementAccountActions.codeHash,
      status: persons.status,
      email: persons.email,
    })
    .from(managementAccountActions)
    .innerJoin(
      persons,
      and(
        eq(persons.id, managementAccountActions.personId),
        eq(persons.tenantId, managementAccountActions.tenantId),
      ),
    )
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.purpose, input.purpose),
        eq(sql`lower(${persons.email})`, email),
        isNull(managementAccountActions.usedAt),
        gt(managementAccountActions.expiresAt, nowIso),
        gt(managementAccountActions.codeExpiresAt, nowIso),
        lt(managementAccountActions.codeAttempts, ACCOUNT_ACTION_CODE_ATTEMPTS),
      ),
    )
    .orderBy(sql`${managementAccountActions.createdAt} desc`)
    .limit(1)
    .for("update");
  if (
    action === undefined ||
    action.codeHash === null ||
    action.email === null ||
    !statusAcceptsPurpose(action.status, input.purpose)
  ) {
    return null;
  }
  const supplied = Buffer.from(
    hashCode(input.codeKey, input.tenantId, email, input.purpose, input.code),
    "hex",
  );
  const stored = Buffer.from(action.codeHash, "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    await tx
      .update(managementAccountActions)
      .set({ codeAttempts: sql`${managementAccountActions.codeAttempts} + 1` })
      .where(
        and(
          eq(managementAccountActions.tenantId, input.tenantId),
          eq(managementAccountActions.id, action.id),
        ),
      );
    return null;
  }
  return { email: action.email, purpose: input.purpose };
}

async function finishClaimedAction(
  tx: Transaction,
  input: CompletionInput,
  personId: string,
  nowIso: string,
): Promise<AccountActionCompletion> {
  const [person] = await tx
    .select({ status: persons.status })
    .from(persons)
    .where(and(eq(persons.id, personId), eq(persons.tenantId, input.tenantId)))
    .for("update");
  if (
    person === undefined ||
    (input.purpose === "invitation" ? person.status !== "pending" : person.status !== "active")
  ) {
    throw new AppError("account_action.invalid", {});
  }
  const passwordHash = hashPassword(input.password);
  const updated = await tx
    .update(persons)
    .set({
      passwordHash,
      emailVerifiedAt: nowIso,
      ...(input.purpose === "invitation"
        ? { pinHash: hashPin(input.pin!), status: "active" as const }
        : {}),
    })
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
  return {
    personId,
    session:
      input.purpose === "invitation"
        ? await startManagementSession(tx, { tenantId: input.tenantId, personId })
        : null,
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

/** Find and lock a pending account before replacing its invitation; unknown states remain silent. */
export async function requestInvitationAction(
  tx: Transaction,
  input: { tenantId: string; email: string; codeKey: Buffer; now?: Date },
): Promise<IssuedAccountAction | null> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return null;
  const [person] = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.tenantId, input.tenantId),
        eq(sql`lower(${persons.email})`, email),
        eq(persons.status, "pending"),
      ),
    )
    .for("update");
  if (person === undefined) return null;
  return issueAccountAction(tx, {
    tenantId: input.tenantId,
    personId: person.id,
    purpose: "invitation",
    codeKey: input.codeKey,
    now: input.now,
  });
}

/** Consume a valid bearer token, replace the password, end old sessions, and open a fresh session. */
export async function completeAccountAction(
  tx: Transaction,
  input: CompletionInput & {
    token: string;
  },
): Promise<AccountActionCompletion> {
  assertPasswordLength(input.password);
  if (input.purpose === "invitation") assertPinLength(input.pin ?? "");
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
  return finishClaimedAction(tx, input, personId, nowIso);
}

export async function completeAccountActionByCode(
  tx: Transaction,
  input: CompletionInput & { email: string; code: string; codeKey: Buffer },
): Promise<AccountActionCompletion | null> {
  assertPasswordLength(input.password);
  if (input.purpose === "invitation") assertPinLength(input.pin ?? "");
  const nowIso = (input.now ?? new Date()).toISOString();
  const email = normalizeEmail(input.email);
  const [action] = await tx
    .select({
      id: managementAccountActions.id,
      personId: managementAccountActions.personId,
      codeHash: managementAccountActions.codeHash,
    })
    .from(managementAccountActions)
    .innerJoin(persons, eq(persons.id, managementAccountActions.personId))
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.purpose, input.purpose),
        eq(sql`lower(${persons.email})`, email),
        isNull(managementAccountActions.usedAt),
        gt(managementAccountActions.expiresAt, nowIso),
        gt(managementAccountActions.codeExpiresAt, nowIso),
        lt(managementAccountActions.codeAttempts, ACCOUNT_ACTION_CODE_ATTEMPTS),
      ),
    )
    .orderBy(sql`${managementAccountActions.createdAt} desc`)
    .limit(1)
    .for("update");
  if (action === undefined || action.codeHash === null) {
    return null;
  }
  const supplied = Buffer.from(
    hashCode(input.codeKey, input.tenantId, email, input.purpose, input.code),
    "hex",
  );
  const stored = Buffer.from(action.codeHash, "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    await tx
      .update(managementAccountActions)
      .set({ codeAttempts: sql`${managementAccountActions.codeAttempts} + 1` })
      .where(
        and(
          eq(managementAccountActions.tenantId, input.tenantId),
          eq(managementAccountActions.id, action.id),
        ),
      );
    return null;
  }
  const claimed = await tx
    .update(managementAccountActions)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(managementAccountActions.tenantId, input.tenantId),
        eq(managementAccountActions.id, action.id),
        isNull(managementAccountActions.usedAt),
      ),
    )
    .returning({ id: managementAccountActions.id });
  if (claimed.length !== 1) throw new AppError("account_action.invalid", {});
  return finishClaimedAction(tx, input, action.personId, nowIso);
}
