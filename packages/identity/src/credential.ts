import "./errors.js";
import { eq } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { hashPin, verifyPin } from "./verify-pin.js";
import type { PersonRoleValue } from "./permissions.js";
import type { PinThrottle } from "./pin-throttle.js";
import { DUMMY, issueCheck, trustedVerdict, type SecretCheck } from "./secret-check.js";

// Checked against when there is no real PIN hash to check, so every refusal costs one PIN check:
// a faster refusal would tell an unknown or suspended account from a wrong PIN.
const DUMMY_PIN_HASH = hashPin("timing-equalization-dummy");

/**
 * Opens no transaction, so a caller holding none leaves the write lock free while the key is
 * derived. Pass the result to {@link verifyPersonCredential} inside the transaction.
 */
export async function checkPin(db: Database, personId: string, pin: string): Promise<SecretCheck> {
  const [person] = await db
    .select({ status: persons.status, pinHash: persons.pinHash })
    .from(persons)
    .where(eq(persons.id, personId));
  if (person?.status !== "active" || person.pinHash === null) {
    await verifyPin(pin, DUMMY_PIN_HASH);
    return issueCheck({ personId, secret: pin, derivedAgainst: DUMMY, matches: false });
  }
  const matches = await verifyPin(pin, person.pinHash);
  return issueCheck({ personId, secret: pin, derivedAgainst: person.pinHash, matches });
}

/**
 * Every refusal is `pin.invalid` with no params, whatever the cause, so the answer never says
 * whether the person exists or why they cannot sign in; the cause travels only as the error's
 * log-only `reason`.
 */
export async function verifyPersonCredential(
  tx: Transaction,
  personId: string,
  pin: string,
  checked?: SecretCheck,
): Promise<{ role: PersonRoleValue; locale: string | null }> {
  const [person] = await tx
    .select({
      role: persons.role,
      status: persons.status,
      pinHash: persons.pinHash,
      locale: persons.locale,
    })
    .from(persons)
    .where(eq(persons.id, personId));
  if (person?.status !== "active" || person.pinHash === null) {
    if (trustedVerdict(checked, personId, pin, DUMMY) === undefined) {
      await verifyPin(pin, DUMMY_PIN_HASH);
    }
    const reason =
      person === undefined
        ? "unknown_person"
        : person.status === "active"
          ? "no_pin"
          : person.status;
    throw new AppError("pin.invalid", {}, { reason });
  }
  const matches =
    trustedVerdict(checked, personId, pin, person.pinHash) ??
    (await verifyPin(pin, person.pinHash));
  if (!matches) {
    throw new AppError("pin.invalid", {}, { reason: "wrong_pin" });
  }
  return { role: person.role as PersonRoleValue, locale: person.locale };
}

/** The wrong-PIN limit a PIN check counts against, and the bucket (`slot`) it counts in. */
export interface PinAttempts {
  throttle: PinThrottle;
  slot: string;
}

/**
 * {@link verifyPersonCredential} under a wrong-PIN limit: refuses `pin.throttled` before any PIN
 * check while the person is inside a wait, counts a `pin.invalid`, and clears the count on success.
 */
export async function verifyThrottledCredential(
  tx: Transaction,
  personId: string,
  pin: string,
  attempts: PinAttempts,
  checked?: SecretCheck,
): Promise<{ role: PersonRoleValue; locale: string | null }> {
  const { throttle, slot } = attempts;
  throttle.check(slot, personId);
  let cred;
  try {
    cred = await verifyPersonCredential(tx, personId, pin, checked);
  } catch (error) {
    if (isAppError(error) && error.code === "pin.invalid") throttle.recordFailure(slot, personId);
    throw error;
  }
  throttle.clear(slot, personId);
  return cred;
}
