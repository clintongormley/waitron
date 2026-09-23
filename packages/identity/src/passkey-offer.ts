import { and, eq, isNull } from "drizzle-orm";
import { nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "./schema/persons.js";
import { webauthnCredentials } from "./schema/webauthn.js";

/**
 * Whether to offer this person a passkey at sign-in: they hold none, and have never been offered one.
 */
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
 * Record that the offer was made and resolved, so it is never made again. Called when the person
 * settles it — adding a passkey or skipping — not when it is shown, so an interrupted offer returns.
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
