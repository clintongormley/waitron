import { foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import { bigCount, id, label, newId, nowIso, table, tsString } from "../columns.js";
import { persons } from "./persons.js";

/**
 * Deliberately MUTABLE, not an audit trail: authentication records `last_used_at` and may advance
 * `counter`, and a stale or revoked passkey is removed outright.
 */
export const webauthnCredentials = table(
  "webauthn_credentials",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    /** The credential id the authenticator returned, base64url. */
    credentialId: label("credential_id").notNull(),
    /** base64url of the COSE public key. */
    publicKey: label("public_key").notNull(),
    /** The authenticator's signature counter, kept to detect a cloned authenticator. */
    counter: bigCount("counter").notNull().default(0),
    /** JSON array string of the authenticator's transports ("usb", "internal", …). */
    transports: label("transports"),
    /**
     * The authenticator's AAGUID as registration reported it; all zeros when the authenticator or
     * the browser names no provider.
     */
    aaguid: label("aaguid"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    /** null until the passkey first signs someone in. */
    lastUsedAt: tsString("last_used_at"),
  },
  (t) => [
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
