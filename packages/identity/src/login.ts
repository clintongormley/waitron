import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { sessions } from "./schema/sessions.js";
import { verifyPersonCredential } from "./credential.js";

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
  // The shared credential gate (not_found → suspended → pin.invalid); the returned role is unused
  // here — login does not gate on it. `authorize`'s override branch runs the identical sequence.
  await verifyPersonCredential(tx, input.personId, input.pin);

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
