import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { hashPin, verifyPin } from "./verify-pin.js";
import type { PersonRoleValue } from "./permissions.js";
import type { PinThrottle } from "./pin-throttle.js";

// Checked against when there is no real PIN hash to check, so every refusal costs one PIN check:
// a faster refusal would tell an unknown or suspended account from a wrong PIN.
const DUMMY_PIN_HASH = hashPin("timing-equalization-dummy");

/**
 * Both `loginWithPin` and `authorize`'s OVERRIDE branch call this. Every refusal is `pin.invalid`
 * with no params, whatever the cause, so the answer never says whether the person exists or why
 * they cannot sign in; the cause travels only as the error's log-only `reason`.
 */
export async function verifyPersonCredential(
  tx: Transaction,
  personId: string,
  pin: string,
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
    await verifyPin(pin, DUMMY_PIN_HASH);
    const reason =
      person === undefined
        ? "unknown_person"
        : person.status === "active"
          ? "no_pin"
          : person.status;
    throw new AppError("pin.invalid", {}, { reason });
  }
  if (!(await verifyPin(pin, person.pinHash))) {
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
): Promise<{ role: PersonRoleValue; locale: string | null }> {
  const { throttle, slot } = attempts;
  throttle.check(slot, personId);
  let cred;
  try {
    cred = await verifyPersonCredential(tx, personId, pin);
  } catch (error) {
    if (isAppError(error) && error.code === "pin.invalid") throttle.recordFailure(slot, personId);
    throw error;
  }
  throttle.clear(slot, personId);
  return cred;
}
