import { createHash, timingSafeEqual } from "node:crypto";

export interface VerifiedTokenMemory {
  alreadyVerified(id: string, token: string, tokenHash: string): boolean;
  remember(id: string, token: string, tokenHash: string): void;
  forget(id: string): void;
}

const digestOf = (token: string): Buffer => createHash("sha256").update(token).digest();

/**
 * Tokens that have already passed scrypt, by the id of the row they belong to: the stored hash each
 * passed against and the SHA-256 of the token. Skipping scrypt on a match is safe because the
 * caller reads the row's CURRENT hash on every request and it must equal the remembered one, and
 * because the tokens held here are `randomBytes(32)`, not passwords, so a fast digest of one is not
 * open to guessing. In `apps/server/src/join-requests.ts`: a device's token comes from
 * `createJoinRequest`; a print agent's from `createJoinRequest` or `selfEnrolNodeAgent`.
 */
export function createVerifiedTokenMemory(limit: number): VerifiedTokenMemory {
  const verified = new Map<string, { tokenHash: string; tokenDigest: Buffer }>();
  return {
    alreadyVerified(id, token, tokenHash) {
      const entry = verified.get(id);
      if (entry === undefined) return false;
      if (entry.tokenHash !== tokenHash) {
        verified.delete(id);
        return false;
      }
      return timingSafeEqual(entry.tokenDigest, digestOf(token));
    },
    remember(id, token, tokenHash) {
      verified.delete(id);
      if (verified.size >= limit) verified.delete(verified.keys().next().value!);
      verified.set(id, { tokenHash, tokenDigest: digestOf(token) });
    },
    forget(id) {
      verified.delete(id);
    },
  };
}
