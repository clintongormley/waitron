import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { bigCount, id, label, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

/**
 * Deliberately MUTABLE, not an audit trail: `counter` is bumped on every successful authentication,
 * and a stale or revoked passkey is removed outright.
 */
export const webauthnCredentials = table(
  "webauthn_credentials",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** The credential id the authenticator returned, base64url. */
    credentialId: label("credential_id").notNull(),
    name: label("name"),
    /** base64url of the COSE public key. */
    publicKey: label("public_key").notNull(),
    /** The authenticator's signature counter, kept to detect a cloned authenticator. */
    counter: bigCount("counter").notNull().default(0),
    /** JSON array string of the authenticator's transports ("usb", "internal", …). */
    transports: label("transports"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => …)`: the thunk form makes v8 count a
    // never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate CLI process).
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
 * Consumed by `consumeChallenge` (`../passkey.ts`). An expired challenge is refused at consume time
 * by the `CHALLENGE_TTL_MS` check, not swept: there is no sweep job.
 */
export const webauthnChallenges = table("webauthn_challenges", {
  id: id("id").primaryKey().$defaultFn(newId),
  /** null for a login (discoverable) ceremony, where the person is not yet known. */
  personId: id("person_id"),
  challenge: label("challenge").notNull(),
  createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
});
