import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { verifyPin } from "./verify-pin.js";
import type { PersonRoleValue } from "./permissions.js";

/**
 * The shared credential gate: look up a person by id, then run the fixed
 * not_found → suspended → pin.invalid sequence and return their role plus their stored UI `locale`
 * (`persons.locale`, `null` when they have set no preference). Both `loginWithPin` (which carries the
 * locale onto the till session and ignores the role) and `authorize`'s OVERRIDE branch (which checks
 * the role against the requested permission and ignores the locale) call this, so the guard ORDER and
 * its error codes are declared in exactly one place — a security gate that must behave identically for
 * both. Throws `person.not_found`, `person.suspended`, `pin.invalid`.
 *
 * RLS-scoped: `personId` resolves only within the current tenant, so an id from another tenant is
 * `person.not_found` (hidden, not forbidden) — the right answer to leak.
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
  if (person === undefined) throw new AppError("person.not_found", { personId });
  if (person.status === "suspended") throw new AppError("person.suspended", { personId });
  if (!verifyPin(pin, person.pinHash)) throw new AppError("pin.invalid", {});
  return { role: person.role as PersonRoleValue, locale: person.locale };
}
