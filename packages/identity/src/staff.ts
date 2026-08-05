import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { authorize } from "./authorize.js";
import { hashPin } from "./verify-pin.js";
import type { PersonRoleValue } from "./permissions.js";

/** The shortest PIN accepted. Four digits is the floor a POS keypad expects; longer is allowed. */
export const MIN_PIN_LENGTH = 4;

/** Refuses a PIN below `MIN_PIN_LENGTH` with `pin.too_short` (carrying only the policy `min`, never
 * the PIN). Exported because provisioning's `venue` CLI seeds the FIRST admin outside this gated
 * path and applies the same floor — one implementation of the check, not two that can drift. */
export function assertPinLength(pin: string): void {
  if (pin.length < MIN_PIN_LENGTH) throw new AppError("pin.too_short", { min: MIN_PIN_LENGTH });
}

/**
 * Creates a staff member. Gated on `person.manage`: `authorize` runs FIRST, so a caller without the
 * permission is rejected before any write. The PIN is length-checked, then stored hashed — never
 * plaintext. Bootstrapping the FIRST admin is provisioning's job, not this gated path.
 */
export async function createPerson(
  tx: Transaction,
  input: {
    tenantId: string;
    actorSessionId: string;
    displayName: string;
    role: PersonRoleValue;
    pin: string;
  },
): Promise<{ id: string }> {
  await authorize(tx, { sessionId: input.actorSessionId, permission: "person.manage" });
  assertPinLength(input.pin);
  const [row] = await tx
    .insert(persons)
    .values({
      tenantId: input.tenantId,
      displayName: input.displayName,
      pinHash: hashPin(input.pin),
      role: input.role,
    })
    .returning({ id: persons.id });
  return { id: row!.id };
}

/** Changes a person's role. Gated on `person.manage`. authorize reads a role live, so an open
 * session sees the change on its next authorize. */
export async function setRole(
  tx: Transaction,
  input: { actorSessionId: string; personId: string; role: PersonRoleValue },
): Promise<void> {
  await authorize(tx, { sessionId: input.actorSessionId, permission: "person.manage" });
  await tx.update(persons).set({ role: input.role }).where(eq(persons.id, input.personId));
}

/** Resets a person's PIN. Gated on `person.manage`; the new PIN is length-checked, then stored
 * hashed. */
export async function resetPin(
  tx: Transaction,
  input: { actorSessionId: string; personId: string; pin: string },
): Promise<void> {
  await authorize(tx, { sessionId: input.actorSessionId, permission: "person.manage" });
  assertPinLength(input.pin);
  await tx
    .update(persons)
    .set({ pinHash: hashPin(input.pin) })
    .where(eq(persons.id, input.personId));
}

/** Suspends a person: keeps the row (and its history) while refusing login. Gated on
 * `person.manage`. */
export async function suspendPerson(
  tx: Transaction,
  input: { actorSessionId: string; personId: string },
): Promise<void> {
  await authorize(tx, { sessionId: input.actorSessionId, permission: "person.manage" });
  await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, input.personId));
}

/** Reactivates a suspended person, restoring login. Gated on `person.manage`. */
export async function reactivatePerson(
  tx: Transaction,
  input: { actorSessionId: string; personId: string },
): Promise<void> {
  await authorize(tx, { sessionId: input.actorSessionId, permission: "person.manage" });
  await tx.update(persons).set({ status: "active" }).where(eq(persons.id, input.personId));
}
