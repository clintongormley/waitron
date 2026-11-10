import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { checkOwnPassword, resolveManagementSession, type SecretCheck } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { inTurn } from "./attempt-turns.js";
import type { PasswordThrottle, PasswordThrottleProbe } from "./password-throttle.js";

type Change<I, T> = (
  tx: Transaction,
  input: I & { managementSessionId: string; checked?: SecretCheck },
) => Promise<T>;

/** Password checks take turns per person, outside the write lock, so refusals count in order. */
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
    checksPassword: boolean,
  ): Promise<{ personId: string; currentPassword?: string } | undefined> => {
    if (checksPassword === false) return undefined;
    try {
      const { currentPassword }: { currentPassword?: string } = input();
      const person = await resolveManagementSession(db, managementSessionId, { touch: false });
      if (throttle.wouldRefuse(person.personId)) return undefined;
      return { personId: person.personId, currentPassword };
    } catch {
      return undefined;
    }
  };

  return async <I extends object, T>(
    managementSessionId: string,
    input: () => I,
    change: Change<I, T>,
    checksPassword: boolean = true,
  ): Promise<T> => {
    const credential = await toCheck(managementSessionId, input, checksPassword);
    if (credential === undefined) {
      return inTransaction(managementSessionId, input, change, undefined);
    }
    const { personId, currentPassword } = credential;
    return inTurn(throttle, personId, async () => {
      const checked = throttle.wouldRefuse(personId)
        ? undefined
        : await checkOwnPassword(db, { personId, currentPassword }).catch(() => undefined);
      return inTransaction(managementSessionId, input, change, checked);
    });
  };
}
