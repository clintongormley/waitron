import { and, eq, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "./schema/persons.js";
import { webauthnCredentials } from "./schema/webauthn.js";

/**
 * Whether to offer this person a passkey at sign-in: they hold none, and have never been offered one.
 *
 * Both reads carry their own tenant predicate. A read by person id is not isolated by
 * one-tenant-per-database, and a uuid that is unique in one database says nothing about which tenant
 * owns the row (CLAUDE.md §3).
 */
export async function shouldOfferPasskey(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<boolean> {
  const [person] = await tx
    .select({ personId: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.tenantId, input.tenantId),
        eq(persons.id, input.personId),
        isNull(persons.passkeyOfferedAt),
      ),
    );
  if (person === undefined) return false;
  const [credential] = await tx
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.tenantId, input.tenantId),
        eq(webauthnCredentials.personId, input.personId),
      ),
    )
    .limit(1);
  return credential === undefined;
}

/**
 * Record that the offer was made and resolved, so it is never made again. Called when the person
 * settles it — adding a passkey or skipping — not when it is shown, so an interrupted offer returns.
 *
 * The write carries the tenant predicate for the same reason the reads do, and it is the more
 * damaging direction: a stamp landing on another tenant's person cancels an offer they never saw.
 */
export async function markPasskeyOffered(
  tx: Transaction,
  input: { tenantId: string; personId: string },
): Promise<void> {
  await tx
    .update(persons)
    .set({ passkeyOfferedAt: sql`now()` })
    .where(and(eq(persons.tenantId, input.tenantId), eq(persons.id, input.personId)));
}
