import { and, eq, isNull } from "drizzle-orm";
import { nowIso, persons, webauthnCredentials } from "@waitron/db";
import type { Transaction } from "@waitron/db";

export async function shouldOfferPasskey(
  tx: Transaction,
  input: { personId: string },
): Promise<boolean> {
  const [person] = await tx
    .select({ personId: persons.id })
    .from(persons)
    .where(and(eq(persons.id, input.personId), isNull(persons.passkeyOfferedAt)));
  if (person === undefined) return false;
  const [credential] = await tx
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.personId, input.personId))
    .limit(1);
  return credential === undefined;
}

/**
 * Called when the person settles the offer — adding a passkey or skipping — not when it is shown, so
 * an interrupted offer returns.
 */
export async function markPasskeyOffered(
  tx: Transaction,
  input: { personId: string },
): Promise<void> {
  await tx
    .update(persons)
    .set({ passkeyOfferedAt: nowIso() })
    .where(eq(persons.id, input.personId));
}
