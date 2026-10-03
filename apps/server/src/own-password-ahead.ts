import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { checkOwnPassword, resolveManagementSession, type SecretCheck } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { inTurn } from "./attempt-turns.js";
import type { PasswordThrottle, PasswordThrottleProbe } from "./password-throttle.js";

/** Whether a change checks the current password at all, given the session's person. */
export type ChecksPassword = boolean | ((person: { email: string | null }) => boolean);

type Change<I, T> = (
  tx: Transaction,
  input: I & { managementSessionId: string; checked?: SecretCheck },
) => Promise<T>;

/**
 * Changes to the signed-in person's own account, each confirmed by their current password under
 * `throttle`, which brackets the change inside its transaction. The password's key is derived before
 * the transaction opens, so not under the write lock, and the change is handed that check with its
 * input. One person's changes take turns from the check until their transaction settles, so each is
 * checked only once the outcomes before it are counted.
 *
 * `input` is built again inside the transaction, after the session is resolved and the throttle has
 * begun, so a request it refuses is refused there in the same order as without a check. There is no
 * check, and no turn, when the change would not reach one: `input` or the session refuses, the
 * throttle would refuse, or `checksPassword` says no.
 */
export function ownPasswordChanges(
  db: Database,
  throttle: PasswordThrottle & PasswordThrottleProbe,
) {
  const inTransaction = <I, T>(
    managementSessionId: string,
    input: () => I,
    change: Change<I, T>,
    checked: SecretCheck | undefined,
  ): Promise<T> =>
    withTransaction(db, async (tx) => {
      const { personId } = await resolveManagementSession(tx, managementSessionId);
      const finish = throttle.begin(personId);
      try {
        const result = await change(tx, {
          ...input(),
          managementSessionId,
          ...(checked === undefined ? {} : { checked }),
        });
        finish("success");
        return result;
      } catch (error) {
        finish(
          isAppError(error) && (error.code === "password.invalid" || error.code === "totp.invalid")
            ? "invalid"
            : "error",
        );
        throw error;
      }
    });

  /** Whose password the change will check, and with what; undefined when it will check none. */
  const toCheck = async (
    managementSessionId: string,
    input: () => object,
    checksPassword: ChecksPassword,
  ): Promise<{ personId: string; currentPassword?: string } | undefined> => {
    if (checksPassword === false) return undefined;
    try {
      const { currentPassword }: { currentPassword?: string } = input();
      const person = await resolveManagementSession(db, managementSessionId, { touch: false });
      if (throttle.wouldRefuse(person.personId)) return undefined;
      if (typeof checksPassword === "function" && !checksPassword(person)) return undefined;
      return { personId: person.personId, currentPassword };
    } catch {
      return undefined;
    }
  };

  return async <I extends object, T>(
    managementSessionId: string,
    input: () => I,
    change: Change<I, T>,
    checksPassword: ChecksPassword = true,
  ): Promise<T> => {
    const credential = await toCheck(managementSessionId, input, checksPassword);
    if (credential === undefined) {
      return inTransaction(managementSessionId, input, change, undefined);
    }
    const { personId, currentPassword } = credential;
    return inTurn(throttle, personId, async () => {
      const checked = throttle.wouldRefuse(personId)
        ? undefined
        : await checkOwnPassword(db, { personId, currentPassword });
      return inTransaction(managementSessionId, input, change, checked);
    });
  };
}
