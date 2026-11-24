import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";
import { enumCheck, enumType, id, label, table, tsString } from "../columns.js";
import { persons } from "./persons.js";

export const signInChallengeKind = enumType([
  "passkey_registration",
  "passkey_login",
  "passkey_check",
  "google_login",
  "google_link",
  "totp_enrolment",
]);
export const signInChallenges = table(
  "sign_in_challenges",
  {
    id: id("id").primaryKey().$defaultFn(randomUUID),
    kind: signInChallengeKind("kind").notNull(),
    personId: id("person_id"),
    challenge: label("challenge"),
    stateHash: label("state_hash"),
    nonce: label("nonce"),
    verifier: label("verifier"),
    encryptedSecret: label("encrypted_secret"),
    createdAt: tsString("created_at").notNull(),
    expiresAt: tsString("expires_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "sign_in_challenges_person_fk",
    }).onDelete("cascade"),
    index("sign_in_challenges_person_idx").on(t.personId),
    uniqueIndex("sign_in_challenges_state_hash_uq")
      .on(t.stateHash)
      .where(sql`${t.stateHash} is not null`),
    uniqueIndex("sign_in_challenges_totp_person_uq")
      .on(t.personId)
      .where(sql`${t.kind} = 'totp_enrolment'`),
    check("sign_in_challenges_kind_ck", enumCheck(t.kind)),
    check(
      "sign_in_challenges_state_hash_ck",
      sql`${t.stateHash} is null or length(${t.stateHash}) = 64`,
    ),
    check("sign_in_challenges_expiry_ck", sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      "sign_in_challenges_shape_ck",
      sql`
    (${t.kind} in ('passkey_registration', 'passkey_login', 'passkey_check')
      and ${t.challenge} is not null and ${t.stateHash} is null and ${t.nonce} is null
      and ${t.verifier} is null and ${t.encryptedSecret} is null
      and ((${t.kind} = 'passkey_login' and ${t.personId} is null)
        or (${t.kind} in ('passkey_registration', 'passkey_check') and ${t.personId} is not null)))
    or (${t.kind} in ('google_login', 'google_link')
      and ${t.stateHash} is not null and ${t.nonce} is not null and ${t.verifier} is not null
      and ${t.challenge} is null and ${t.encryptedSecret} is null
      and ((${t.kind} = 'google_login' and ${t.personId} is null)
        or (${t.kind} = 'google_link' and ${t.personId} is not null)))
    or (${t.kind} = 'totp_enrolment' and ${t.encryptedSecret} is not null
      and length(${t.encryptedSecret}) > 0 and ${t.personId} is not null
      and ${t.challenge} is null and ${t.stateHash} is null and ${t.nonce} is null and ${t.verifier} is null)
  `,
    ),
  ],
);
