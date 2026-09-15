import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "./schema/persons.js";
import { webauthnCredentials } from "./schema/webauthn.js";

/**
 * Whether to offer this person a passkey at sign-in: they hold none, and have never been offered one.
 *
 * Both reads find the row by person id alone; with one tenant per database it is this tenant's.
 */
export async function shouldOfferPasskey(
  tx: Transaction,
  input: { tenantId: string; personId: string },
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
 *
 * The write updates by person id alone; with one tenant per database the row is this tenant's.
 */
export async function markPasskeyOffered(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<void> {
  await tx
    .update(persons)
    .set({ passkeyOfferedAt: sql`now()` })
    .where(eq(persons.id, input.personId));
}
