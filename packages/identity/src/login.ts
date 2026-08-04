import "./errors.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { sessions } from "./schema/sessions.js";
import { verifyPin } from "./verify-pin.js";

export interface Session {
  id: string;
  tenantId: string;
  personId: string;
  tillId: string;
}

/** Opens a shift session for a person at a till after verifying their PIN. RLS-scoped: `personId`
 * must belong to the current tenant. Throws `person.not_found`, `person.suspended`, `pin.invalid`. */
export async function loginWithPin(
  tx: Transaction,
  input: { tenantId: string; tillId: string; personId: string; pin: string },
): Promise<Session> {
  const [person] = await tx
    .select({ pinHash: persons.pinHash, status: persons.status })
    .from(persons)
    .where(eq(persons.id, input.personId));
  if (person === undefined) throw new AppError("person.not_found", { personId: input.personId });
  if (person.status === "suspended")
    throw new AppError("person.suspended", { personId: input.personId });
  if (!verifyPin(input.pin, person.pinHash)) throw new AppError("pin.invalid", {});

  const [row] = await tx
    .insert(sessions)
    .values({ tenantId: input.tenantId, personId: input.personId, tillId: input.tillId })
    .returning({ id: sessions.id });
  return { id: row!.id, tenantId: input.tenantId, personId: input.personId, tillId: input.tillId };
}

/** Ends an open session. Returns true if it was open (this call closed it), false if already ended
 * or unknown. */
export async function endSession(tx: Transaction, sessionId: string): Promise<boolean> {
  const updated = await tx
    .update(sessions)
    .set({ endedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.endedAt)))
    .returning({ id: sessions.id });
  return updated.length > 0;
}
