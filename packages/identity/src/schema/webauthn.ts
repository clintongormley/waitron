import {
  bigint,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { persons } from "./persons.js";

/**
 * A registered passkey (WebAuthn credential) for a person. Deliberately MUTABLE, not an audit trail:
 * `counter` is bumped on every successful authentication, and a stale or revoked passkey is removed
 * outright — so app_user holds SELECT, INSERT, UPDATE, DELETE. DELETE is
 * granted here, unlike `management_sessions`, mirroring `tenant_credentials`: a credential row is
 * live configuration, not a record anyone needs preserved.
 */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").notNull(),
    /** The credential id the authenticator returned, base64url. Unique, so a login lookup resolves
     * exactly one credential; `credential_id` is the seam the verifier keys on. */
    credentialId: text("credential_id").notNull(),
    name: text("name"),
    /** base64url of the COSE public key — used to verify the authentication assertion's signature. */
    publicKey: text("public_key").notNull(),
    /** The authenticator's signature counter, bumped on each successful assertion to detect a cloned
     * authenticator. bigint (not integer): the spec allows a 32-bit counter, and `mode: "number"`
     * keeps it a JS number since the value never approaches 2^53. */
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    /** JSON array string of the authenticator's transports ("usb", "internal", …), optional. */
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI
    // process), the same reason persons.ts and management-sessions.ts use this form. restrict, not
    // cascade: removing a person must never silently discard a registered passkey.
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
 * and consumed (deleted) at the START of finish, BEFORE verification — a locking DELETE, so the row
 * lock enforces single-use even when two finishes race on the same handle. `person_id` is null for a
 * login (discoverable-credential) ceremony, where the person is not yet known. Ephemeral rather than
 * an audit trail — app_user holds SELECT, INSERT, UPDATE, DELETE (DELETE because a challenge is
 * deleted the moment it is consumed; the consume-DELETE is undone if the finish transaction then rolls
 * back, so the row survives on a failed or expired ceremony). An expired challenge is bounded by the
 * `CHALLENGE_TTL_MS` check at consume time — a later finish rejects it as `passkey.challenge_expired`
 * and rolls the transaction back — NOT swept: there is no sweep job (a background sweep is a possible
 * future follow-up).
 */
export const webauthnChallenges = pgTable("webauthn_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null for a login (discoverable) ceremony — the person is resolved from the returned
   * credential, not known when the challenge is minted. */
  personId: uuid("person_id"),
  challenge: text("challenge").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
