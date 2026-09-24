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
  /** The operator's own role, carried through so callers (the till's `POST /api/session` response) can
   * gate manager-only affordances client-side. NOT a stored `sessions` column — it is the credential
   * gate's looked-up `persons.role`. Convenience only: every server gate re-derives the role from the
   * session and re-checks the permission (`authorize`), so a tampered client value grants nothing. */
  role: PersonRoleValue;
  /** The operator's preferred UI language (a supported-locale code), or `null` for no preference —
   * the credential gate's looked-up `persons.locale`. Carried through so the till can render in the
   * operator's language from the login response; `null` means fall back to the venue default. */
  locale: string | null;
}

/** Opens a shift session for a person at a till after verifying their PIN. Throws `person.not_found`, `person.suspended`, `pin.invalid`. */
export async function loginWithPin(
  tx: Transaction,
  input: { tillId: string; personId: string; pin: string },
): Promise<Session> {
  // The shared credential gate (not_found → suspended → pin.invalid). Login does not GATE on the role,
  // but it surfaces it in the returned session (see {@link Session.role}). `authorize`'s override
  // branch runs the identical credential sequence.
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

/** Ends the open session the cookie's `token` names. True if this call closed it; false if it was
 * already ended, or the token names no session — a row id or a stored hash names none. */
export async function endSession(tx: Transaction, token: string): Promise<boolean> {
  const updated = await tx
    .update(sessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.endedAt)))
    .returning({ id: sessions.id });
  return updated.length > 0;
}
