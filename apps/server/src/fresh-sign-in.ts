import { withTransaction, type Database } from "@waitron/db";
import {
  resolveManagementSession,
  verifyOwnFreshSignIn,
  verifyOwnPasskey,
  type TotpKeyRing,
} from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import "./errors.js";
import { ownPasswordChanges } from "./own-password-ahead.js";
import type { PasswordThrottle, PasswordThrottleProbe } from "./password-throttle.js";
import { isUuid } from "./till-session.js";

export interface FreshSignInDeps {
  db: Database;
  /** This step's own throttle, keyed by person: neither sign-in's nor profile changes'. */
  throttle: PasswordThrottle & PasswordThrottleProbe;
  keyRing: TotpKeyRing;
  rpId: string;
  origin: string;
}

type Codes = { totp?: string; recoveryCode?: string };

function codesOf(body: Record<string, unknown>): Codes {
  return {
    ...(typeof body.totp === "string" ? { totp: body.totp } : {}),
    ...(typeof body.recoveryCode === "string" ? { recoveryCode: body.recoveryCode } : {}),
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
    const currentPassword = typeof fields.password === "string" ? fields.password : undefined;
    return ownPasswordChanges(deps.db, deps.throttle)(
      managementSessionId,
      () => ({
        ...(currentPassword === undefined ? {} : { currentPassword }),
        ...codesOf(fields),
        keyRing: deps.keyRing,
      }),
      async (tx, input) => (await verifyOwnFreshSignIn(tx, input)).id,
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
          ...codesOf(fields),
          keyRing: deps.keyRing,
        });
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
