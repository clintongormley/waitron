import { and, eq, isNull } from "drizzle-orm";
import { nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { sessions } from "./schema/sessions.js";
import { verifyPersonCredential } from "./credential.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashSessionToken, mintSessionToken } from "./session-token.js";

export interface Session {
  /** The row's identity — what `authorize` takes. Never the cookie. */
  id: string;
  /** The bearer token the shift cookie carries. Only its hash is stored. */
  token: string;
  personId: string;
  tillId: string;
  /** Convenience for client-side affordances only: every server gate re-derives the role from the
   * session and re-checks the permission (`authorize`), so a tampered client value grants nothing. */
  role: PersonRoleValue;
  /** `null` means no preference: fall back to the venue default. */
  locale: string | null;
}

/** Throws `person.not_found`, `person.suspended`, `pin.invalid`. */
export async function loginWithPin(
  tx: Transaction,
  input: { tillId: string; personId: string; pin: string },
): Promise<Session> {
  const { role, locale } = await verifyPersonCredential(tx, input.personId, input.pin);

  const token = mintSessionToken();
  const [row] = await tx
    .insert(sessions)
    .values({ personId: input.personId, tillId: input.tillId, tokenHash: hashSessionToken(token) })
    .returning({ id: sessions.id });
  return {
    id: row!.id,
    token,
    personId: input.personId,
    tillId: input.tillId,
    role,
    locale,
  };
}

/** True if this call closed the session; false if it was already ended, or the token names no
 * session — a row id or a stored hash names none. */
export async function endSession(tx: Transaction, token: string): Promise<boolean> {
  const updated = await tx
    .update(sessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.endedAt)))
    .returning({ id: sessions.id });
  return updated.length > 0;
}
