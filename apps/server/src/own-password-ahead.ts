import type { Database } from "@waitron/db";
import { checkOwnPassword, resolveManagementSession, type SecretCheck } from "@waitron/identity";
import type { PasswordThrottleProbe } from "./password-throttle.js";

export interface OwnPasswordAhead {
  currentPassword?: string;
  /** Whether the change will check the password at all, given the session's person. */
  checksPassword?: (person: { email: string | null }) => boolean;
}

/**
 * Checks the signed-in person's current password before the change's transaction opens, so the key
 * is not derived while the write lock is held. Returns undefined, and derives nothing, when the
 * change would not reach the check: the throttle the transaction opens would refuse, or
 * `checksPassword` says no. Any failure here also returns undefined, leaving the transaction to
 * answer exactly as it would with no check, the session's own refusals included.
 */
export async function checkOwnPasswordAhead(
  db: Database,
  throttle: PasswordThrottleProbe,
  managementSessionId: string,
  ahead: OwnPasswordAhead,
): Promise<SecretCheck | undefined> {
  try {
    const session = await resolveManagementSession(db, managementSessionId, { touch: false });
    if (throttle.wouldRefuse(session.personId)) return undefined;
    if (ahead.checksPassword !== undefined && !ahead.checksPassword(session)) return undefined;
    return await checkOwnPassword(db, {
      managementSessionId,
      currentPassword: ahead.currentPassword,
    });
  } catch {
    return undefined;
  }
}
