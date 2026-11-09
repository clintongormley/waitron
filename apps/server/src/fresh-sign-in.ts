import {
  withTransaction,
  type Database,
  type Transaction,
  managementSessions,
  nowIso,
} from "@waitron/db";
import {
  resolveManagementSession,
  verifyOwnFreshSignIn,
  verifyOwnPasskey,
  type TotpKeyRing,
} from "@waitron/identity";
import { eq } from "drizzle-orm";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";
import { ownPasswordChanges } from "./own-password-ahead.js";
import type { PasswordThrottle, PasswordThrottleProbe } from "./password-throttle.js";
import { isUuid } from "./till-session.js";

export interface FreshSignInDeps {
  db: Database;
  throttle: PasswordThrottle & PasswordThrottleProbe;
  keyRing: TotpKeyRing;
  rpId: string;
  origin: string;
}

type Codes = { totp?: string; recoveryCode?: string };

function optionalText(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AppError("management.request_invalid", { field });
  return value;
}

function codesOf(body: Record<string, unknown>): Codes {
  const totp = optionalText(body, "totp");
  const recoveryCode = optionalText(body, "recoveryCode");
  return {
    ...(totp === undefined ? {} : { totp }),
    ...(recoveryCode === undefined ? {} : { recoveryCode }),
  };
}

/**
 * Checks afresh that the signed-in person is who the session says, by their password or one of
 * their own passkeys, and their authenticator or a recovery code when one is set up. Answers the
 * session's person id; a person the body names is never read.
 */
export async function confirmFreshSignIn(
  deps: FreshSignInDeps,
  managementSessionId: string,
  body: unknown,
): Promise<string> {
  if (typeof body !== "object" || body === null) {
    throw new AppError("management.request_invalid", { field: "method" });
  }
  const fields = body as Record<string, unknown>;
  if (fields.method === "password") {
    const currentPassword = optionalText(fields, "password");
    const codes = codesOf(fields);
    return ownPasswordChanges(deps.db, deps.throttle)(
      managementSessionId,
      () => ({
        ...(currentPassword === undefined ? {} : { currentPassword }),
        ...codes,
        keyRing: deps.keyRing,
      }),
      async (tx, input) => {
        const person = await verifyOwnFreshSignIn(tx, input);
        await recordProof(tx, managementSessionId);
        return person.id;
      },
    );
  }
  if (fields.method === "passkey") {
    if (typeof fields.challengeHandle !== "string" || !isUuid(fields.challengeHandle)) {
      throw new AppError("management.request_invalid", { field: "challengeHandle" });
    }
    if (typeof fields.response !== "object" || fields.response === null) {
      throw new AppError("management.request_invalid", { field: "response" });
    }
    const challengeHandle = fields.challengeHandle;
    const response = fields.response as Parameters<typeof verifyOwnPasskey>[1]["response"];
    const codes = codesOf(fields);
    // A failed code check rolls the transaction back, which restores the challenge, so one signed
    // response can be resent with each new code guess until it expires: this throttle is the bound.
    return withTransaction(deps.db, async (tx) => {
      const { personId } = await resolveManagementSession(tx, managementSessionId);
      const finish = deps.throttle.begin(personId);
      try {
        await verifyOwnPasskey(tx, {
          managementSessionId,
          challengeHandle,
          response,
          rpId: deps.rpId,
          origin: deps.origin,
          ...codes,
          keyRing: deps.keyRing,
        });
        await recordProof(tx, managementSessionId);
        finish("success");
        return personId;
      } catch (error) {
        finish(isAppError(error) && error.code === "totp.invalid" ? "invalid" : "error");
        throw error;
      }
    });
  }
  throw new AppError("management.request_invalid", { field: "method" });
}

async function recordProof(tx: Transaction, token: string): Promise<void> {
  const { sessionRowId } = await resolveManagementSession(tx, token);
  await tx
    .update(managementSessions)
    .set({ provedAt: nowIso() })
    .where(eq(managementSessions.id, sessionRowId));
}
