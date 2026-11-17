import { queueSecurityChangeMail } from "./security-change-mail.js";
import "./errors.js";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  enqueueMail,
  outgoingMail,
  refusalOn,
  UNIQUE_VIOLATION,
  type Transaction,
  accountActions,
  dashboardSessions,
  recordActivity,
  loginEmailKey,
  persons,
  withFoldedPersonChanges,
} from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import { authorizePersonLoginChange } from "./staff.js";
import { normalizeEmail, isValidEmail } from "./email.js";
import { assertPasswordLength, hashPasswordAsync } from "./verify-password.js";
import { assertPinLength, hashPinAsync } from "./verify-pin.js";
import { startManagementSession, type ManagementSession } from "./management-session.js";
import { foldForUniqueness } from "./fold.js";
import { PERSONS_EMAIL } from "./person-constraints.js";

export type AccountActionPurpose = "invitation" | "password_reset" | "email_change";
type CredentialActionPurpose = Exclude<AccountActionPurpose, "email_change">;

export const ACCOUNT_ACTION_TTL_MS = {
  invitation: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
  email_change: 30 * 60 * 1000,
} as const;
export const ACCOUNT_ACTION_CODE_TTL_MS = 10 * 60 * 1000;
export const ACCOUNT_ACTION_CODE_ATTEMPTS = 5;

/** A later expiry was stamped before a backward clock step, and counts as passed. */
function latestLiveExpiry(nowIso: string, purpose: AccountActionPurpose): string {
  return new Date(Date.parse(nowIso) + ACCOUNT_ACTION_TTL_MS[purpose]).toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hashCode(key: Buffer, email: string, purpose: string, code: string): string {
  return createHmac("sha256", key)
    .update(`${normalizeEmail(email)}\0${purpose}\0${code}`, "utf8")
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

/**
 * Issue a fresh action and invalidate any still-live predecessor of the same purpose. It also
 * deletes the person's used or expired actions of that purpose, so retiring a known person's link
 * walks no history the unknown-address decoy lacks (A159, #986).
 */
export async function issueAccountAction(
  tx: Transaction,
  input: {
    personId: string;
    purpose: AccountActionPurpose;
    codeKey?: Buffer;
    now?: Date;
  },
): Promise<IssuedAccountAction> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const [person] = await tx
    .select({
      email: persons.email,
      pendingEmail: persons.pendingEmail,
      displayName: persons.displayName,
      locale: persons.locale,
      status: persons.status,
    })
    .from(persons)
    .where(eq(persons.id, input.personId));
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
    input.purpose === "email_change" ? normalizeEmail(person.pendingEmail ?? "") : person.email;
  if (!isValidEmail(deliveryEmail)) throw new AppError("person.email_invalid", {});

  await deleteDeadActions(tx, input.personId, input.purpose, nowIso);
  await tx
    .update(accountActions)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(accountActions.personId, input.personId),
        eq(accountActions.purpose, input.purpose),
        isNull(accountActions.usedAt),
      ),
    );

  const token = randomBytes(32).toString("base64url");
  const code =
    input.purpose !== "email_change" || input.codeKey === undefined
      ? undefined
      : String(randomInt(1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + ACCOUNT_ACTION_TTL_MS[input.purpose]).toISOString();
  const codeExpiresAt =
    code === undefined
      ? undefined
      : new Date(now.getTime() + ACCOUNT_ACTION_CODE_TTL_MS).toISOString();
  const [row] = await tx
    .insert(accountActions)
    .values({
      personId: input.personId,
      purpose: input.purpose,
      tokenHash: hashToken(token),
      codeHash:
        code === undefined ? null : hashCode(input.codeKey!, deliveryEmail, input.purpose, code),
      codeExpiresAt: codeExpiresAt ?? null,
      createdAt: nowIso,
      expiresAt,
    })
    .returning({ id: accountActions.id });
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

async function deleteDeadActions(
  tx: Transaction,
  personId: string,
  purpose: AccountActionPurpose,
  nowIso: string,
): Promise<void> {
  await tx
    .delete(accountActions)
    .where(
      and(
        eq(accountActions.personId, personId),
        eq(accountActions.purpose, purpose),
        or(
          isNotNull(accountActions.usedAt),
          lte(accountActions.expiresAt, nowIso),
          gt(accountActions.expiresAt, latestLiveExpiry(nowIso, purpose)),
        ),
      ),
    );
}

interface CompletionInput {
  purpose: CredentialActionPurpose;
  password: string;
  pin?: string;
  now?: Date;
}

export async function confirmEmailChangeByCode(
  tx: Transaction,
  input: { personId: string; code: string; codeKey: Buffer; now?: Date },
): Promise<string | null> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const [action] = await tx
    .select({
      id: accountActions.id,
      codeHash: accountActions.codeHash,
      pendingEmail: persons.pendingEmail,
    })
    .from(accountActions)
    .innerJoin(persons, eq(persons.id, accountActions.personId))
    .where(
      and(
        eq(accountActions.personId, input.personId),
        eq(accountActions.purpose, "email_change"),
        isNull(accountActions.usedAt),
        gt(accountActions.expiresAt, nowIso),
        lte(accountActions.expiresAt, latestLiveExpiry(nowIso, "email_change")),
        gt(accountActions.codeExpiresAt, nowIso),
        lt(accountActions.codeAttempts, ACCOUNT_ACTION_CODE_ATTEMPTS),
      ),
    )
    .orderBy(sql`${accountActions.createdAt} desc`)
    .limit(1);
  if (action?.codeHash === null || action?.pendingEmail === null || action === undefined)
    return null;
  const supplied = Buffer.from(
    hashCode(input.codeKey, action.pendingEmail, "email_change", input.code),
    "hex",
  );
  const stored = Buffer.from(action.codeHash, "hex");
  if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
    await tx
      .update(accountActions)
      .set({ codeAttempts: sql`${accountActions.codeAttempts} + 1` })
      .where(eq(accountActions.id, action.id));
    return null;
  }
  const claimed = await tx
    .update(accountActions)
    .set({ usedAt: nowIso })
    .where(and(eq(accountActions.id, action.id), isNull(accountActions.usedAt)))
    .returning({ id: accountActions.id });
  if (claimed.length !== 1) return null;
  try {
    const changed = await tx
      .update(persons)
      .set(
        withFoldedPersonChanges({
          email: action.pendingEmail,
          emailFolded: foldForUniqueness(action.pendingEmail),
          pendingEmail: null,
          pendingEmailFolded: null,
          emailVerifiedAt: nowIso,
        }),
      )
      .where(and(eq(persons.id, input.personId), eq(persons.pendingEmail, action.pendingEmail)))
      .returning({ email: persons.email });
    if (changed.length !== 1) return null;
    return changed[0]!.email;
  } catch (error) {
    if (refusalOn(error, UNIQUE_VIOLATION, PERSONS_EMAIL)) {
      throw new AppError("person.email_taken", { email: action.pendingEmail });
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

/**
 * Validate a bearer action without consuming it or opening a session. Completion repeats these
 * checks.
 */
export async function inspectAccountAction(
  tx: Transaction,
  input: {
    token: string;
    purpose: CredentialActionPurpose;
    now?: Date;
  },
): Promise<AccountActionInspection> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const [action] = await tx
    .select({ email: persons.email, status: persons.status })
    .from(accountActions)
    .innerJoin(persons, eq(persons.id, accountActions.personId))
    .where(
      and(
        eq(accountActions.tokenHash, hashToken(input.token)),
        eq(accountActions.purpose, input.purpose),
        isNull(accountActions.usedAt),
        gt(accountActions.expiresAt, nowIso),
        lte(accountActions.expiresAt, latestLiveExpiry(nowIso, input.purpose)),
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

async function finishClaimedAction(
  tx: Transaction,
  input: CompletionInput,
  personId: string,
  nowIso: string,
): Promise<AccountActionCompletion> {
  const [person] = await tx
    .select({ email: persons.email, status: persons.status })
    .from(persons)
    .where(eq(persons.id, personId));
  if (
    person?.email === null ||
    person === undefined ||
    !statusAcceptsPurpose(person.status, input.purpose)
  ) {
    throw new AppError("account_action.invalid", {});
  }
  const passwordHash = await hashPasswordAsync(input.password);
  const updated = await tx
    .update(persons)
    .set(
      withFoldedPersonChanges({
        passwordHash,
        emailVerifiedAt: nowIso,
        ...(input.purpose === "invitation"
          ? { pinHash: await hashPinAsync(input.pin!), status: "active" as const }
          : {}),
      }),
    )
    .where(eq(persons.id, personId))
    .returning({ id: persons.id });
  if (updated.length !== 1) throw new AppError("account_action.invalid", {});
  const ended = await tx
    .delete(dashboardSessions)
    .where(and(eq(dashboardSessions.personId, personId), isNull(dashboardSessions.endedAt)))
    .returning({ personId: dashboardSessions.personId });
  for (const row of ended)
    await recordActivity(tx, {
      kind: "dashboard.signed_out",
      subjectId: row.personId,
      personId: row.personId,
      data: { reason: "account_action_completed" },
    });
  if (input.purpose === "password_reset")
    await queueSecurityChangeMail(tx, { personId, change: "password_changed" });
  return {
    personId,
    session:
      input.purpose === "invitation"
        ? await startManagementSession(tx, { method: "invitation", personId })
        : null,
  };
}

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
    .update(accountActions)
    .set({ usedAt: nowIso })
    .where(
      and(
        eq(accountActions.tokenHash, hashToken(input.token)),
        eq(accountActions.purpose, input.purpose),
        isNull(accountActions.usedAt),
        gt(accountActions.expiresAt, nowIso),
        lte(accountActions.expiresAt, latestLiveExpiry(nowIso, input.purpose)),
      ),
    )
    .returning({ personId: accountActions.personId });
  if (claimed.length !== 1) throw new AppError("account_action.invalid", {});
  const personId = claimed[0]!.personId;
  return finishClaimedAction(tx, input, personId, nowIso);
}

export type AccountMailParams = { purpose: AccountActionPurpose; origin?: string };
export async function queueAccountMail(
  tx: Transaction,
  input: {
    personId: string;
    purpose: AccountActionPurpose;
    requestedBy?: string;
    origin?: string;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await enqueueMail(tx, {
    kind: "account_action",
    dedupeKey: `account:${randomUUID()}`,
    personId: input.personId,
    requestedBy: input.requestedBy,
    params: {
      purpose: input.purpose,
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    },
    now,
    notAfter: new Date(now.getTime() + ACCOUNT_ACTION_TTL_MS[input.purpose]),
  });
}
export async function queueAccountRecovery(
  tx: Transaction,
  input: { email: string; origin: string; now?: Date },
): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return;
  const [person] = await tx
    .select({ id: persons.id, status: persons.status })
    .from(persons)
    .where(
      and(
        eq(loginEmailKey(), foldForUniqueness(email)),
        inArray(persons.status, ["active", "pending"]),
      ),
    );
  if (person === undefined) {
    // The unknown address writes and removes one mail under deferred foreign keys. Its two
    // change-feed rows differ from the known address's single row; the answer has already gone.
    const personId = randomUUID();
    await tx.execute(sql`pragma defer_foreign_keys = on`);
    await queueAccountMail(tx, { ...input, personId, purpose: "password_reset" });
    await tx.delete(outgoingMail).where(eq(outgoingMail.personId, personId));
    return;
  }
  await queueAccountMail(tx, {
    ...input,
    personId: person.id,
    purpose: person.status === "pending" ? "invitation" : "password_reset",
  });
}

export async function queueInvitation(
  tx: Transaction,
  input: { managementSessionId: string; personId: string; origin: string; now?: Date },
): Promise<void> {
  const { authorizedBy } = await authorizePersonLoginChange(tx, input);
  await queueAccountMail(tx, { ...input, purpose: "invitation", requestedBy: authorizedBy });
}

export async function issueQueuedAccountAction(
  tx: Transaction,
  mail: { personId: string; params: AccountMailParams },
  input: { codeKey?: Buffer; now: Date },
): Promise<IssuedAccountAction | null> {
  try {
    const [person] = await tx
      .select({ pendingEmail: persons.pendingEmail })
      .from(persons)
      .where(eq(persons.id, mail.personId));
    if (mail.params.purpose === "email_change" && !person?.pendingEmail) return null;
    return await issueAccountAction(tx, {
      personId: mail.personId,
      purpose: mail.params.purpose,
      ...input,
    });
  } catch (error) {
    if (
      isAppError(error) &&
      [
        "person.not_found",
        "person.suspended",
        "person.transition_invalid",
        "person.email_invalid",
      ].includes(error.code)
    )
      return null;
    throw error;
  }
}
