import { signInChallenges, type Transaction } from "@waitron/db";
import { gt, lte, or } from "drizzle-orm";

export type SignInChallengeKind = typeof signInChallenges.$inferSelect.kind;
export const LONGEST_CHALLENGE_LIFETIME_MS = 10 * 60 * 1000;

export async function insertSignInChallenge(
  tx: Transaction,
  row: {
    kind: SignInChallengeKind;
    personId: string | null;
    lifetimeMs: number;
    now?: Date;
    challenge?: string;
    stateHash?: string;
    nonce?: string;
    verifier?: string;
    encryptedSecret?: string;
  },
): Promise<string> {
  const { now = new Date(), lifetimeMs, ...values } = row;
  await tx
    .delete(signInChallenges)
    .where(
      or(
        lte(signInChallenges.expiresAt, now.toISOString()),
        gt(
          signInChallenges.expiresAt,
          new Date(now.getTime() + LONGEST_CHALLENGE_LIFETIME_MS).toISOString(),
        ),
      ),
    );
  const [inserted] = await tx
    .insert(signInChallenges)
    .values({
      ...values,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
    })
    .returning({ id: signInChallenges.id });
  return inserted!.id;
}
