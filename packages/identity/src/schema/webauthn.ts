import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { bigCount, id, label, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * A registered passkey (WebAuthn credential) for a person. Deliberately MUTABLE, not an audit trail:
 * `counter` is bumped on every successful authentication, and a stale or revoked passkey is removed
 * outright — so this table carries no append-only trigger. Under PostgreSQL the grant here included
 * DELETE, unlike `management_sessions` and mirroring `tenant_credentials`, because a credential row
 * is live configuration rather than a record anyone needs preserved; that grant went with the
 * engine, nothing replaced it, and the database now draws no distinction between the two tables.
 */
export const webauthnCredentials = table(
  "webauthn_credentials",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** The credential id the authenticator returned, base64url. Unique, so a login lookup resolves
     * exactly one credential; `credential_id` is the seam the verifier keys on. */
    credentialId: label("credential_id").notNull(),
    name: label("name"),
    /** base64url of the COSE public key — used to verify the authentication assertion's signature. */
    publicKey: label("public_key").notNull(),
    /** The authenticator's signature counter, bumped on each successful assertion to detect a cloned
     * authenticator. bigint (not integer): the spec allows a 32-bit counter, and `mode: "number"`
     * keeps it a JS number since the value never approaches 2^53. */
    counter: bigCount("counter").notNull().default(0),
    /** JSON array string of the authenticator's transports ("usb", "internal", …), optional. */
    transports: label("transports"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process), the same reason recovery-codes.ts and management-account-actions.ts use this form.
    // restrict, not cascade: removing a person must never silently discard a registered passkey.
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "webauthn_credentials_person_fk",
    }).onDelete("restrict"),
    unique("webauthn_credentials_credential_id_uq").on(t.credentialId),
    index("webauthn_credentials_person_idx").on(t.personId),
  ],
);

/**
 * A short-lived WebAuthn challenge issued at the start of a registration or authentication ceremony
 * and consumed (deleted) at the START of finish, BEFORE verification — one DELETE-and-return, which
 * is what enforces single-use when two finishes arrive for the same handle (`../passkey.ts`'s
 * `consumeChallenge`; the row lock that note used to name is gone). `person_id` is null for a
 * login (discoverable-credential) ceremony, where the person is not yet known. Ephemeral rather than
 * an audit trail, so no append-only trigger stands between a caller and the row: a challenge is
 * deleted the moment it is consumed, and that consume-DELETE is undone if the finish transaction then
 * rolls back, so the row survives a failed or expired ceremony. (The grant that used to spell out the
 * same permissions went with PostgreSQL.) An expired challenge is bounded by the
 * `CHALLENGE_TTL_MS` check at consume time — a later finish rejects it as `passkey.challenge_expired`
 * and rolls the transaction back — NOT swept: there is no sweep job (a background sweep is a possible
 * future follow-up).
 */
export const webauthnChallenges = table("webauthn_challenges", {
  id: id("id").primaryKey().$defaultFn(newId),
  /** null for a login (discoverable) ceremony — the person is resolved from the returned
   * credential, not known when the challenge is minted. */
  personId: id("person_id"),
  challenge: label("challenge").notNull(),
  createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
});
