import { and, eq, isNotNull } from "drizzle-orm";
import { persons, signInChallenges, withTransaction, type Database } from "@waitron/db";
import { openText, sealText, type KeyRing } from "@waitron/credentials";
import type { ResealResult } from "@waitron/credentials/src/cli.js";

export async function resealTwoStepSecrets(db: Database, ring: KeyRing): Promise<ResealResult> {
  const result = { rotated: 0, alreadyCurrent: 0, unopened: 0 };
  const people = await db
    .select({ id: persons.id, stored: persons.totpSecret })
    .from(persons)
    .where(isNotNull(persons.totpSecret));
  const pending = await db
    .select({ id: signInChallenges.id, stored: signInChallenges.encryptedSecret })
    .from(signInChallenges)
    .where(eq(signInChallenges.kind, "totp_enrolment"));
  // Each row commits separately. A new enrolment can run between rows; re-read inside the turn
  // and compare with the snapshot so rotation never replaces a person's new secret.
  for (const source of [
    { rows: people, person: true },
    { rows: pending, person: false },
  ]) {
    for (const row of source.rows) {
      await withTransaction(db, async (tx) => {
        const [fresh] = source.person
          ? await tx
              .select({ stored: persons.totpSecret })
              .from(persons)
              .where(eq(persons.id, row.id))
          : await tx
              .select({ stored: signInChallenges.encryptedSecret })
              .from(signInChallenges)
              .where(
                and(eq(signInChallenges.id, row.id), eq(signInChallenges.kind, "totp_enrolment")),
              );
        if (!fresh || fresh.stored !== row.stored || fresh.stored === null) return;
        const opened = openText(ring, "totp", fresh.stored);
        if (opened === null) {
          result.unopened++;
          return;
        }
        if (opened.keyVersion === ring.current.version) {
          result.alreadyCurrent++;
          return;
        }
        const sealed = sealText(ring, "totp", opened.value);
        if (source.person) {
          await tx
            .update(persons)
            .set({ totpSecret: sealed })
            .where(and(eq(persons.id, row.id), eq(persons.totpSecret, fresh.stored)));
        } else {
          await tx
            .update(signInChallenges)
            .set({ encryptedSecret: sealed })
            .where(
              and(
                eq(signInChallenges.id, row.id),
                eq(signInChallenges.encryptedSecret, fresh.stored),
              ),
            );
        }
        result.rotated++;
      });
    }
  }
  return result;
}
