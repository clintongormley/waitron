import { sql } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/pg-core";
import { id, label, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

/** One short-lived, single-use Google authorization-code ceremony. These rows stay local because
 * the browser must return to the node that issued the state and PKCE verifier. */
export const googleOidcStates = table(
  "google_oidc_states",
  {
    id: id("id").primaryKey().defaultRandom(),
    personId: id("person_id"),
    // A plain text column beside its own check constraint below, NOT the enumText/enumCheck pair.
    // The siblings that carry this comment are held by one of the two reasons in columns.ts;
    // neither holds here. Measured 2026-09-18: substituting leaves the generated schema identical,
    // and no caller breaks today. The narrowing itself still happens -- a converter would write
    // the values inline, and inline narrows whatever the nullability -- so what keeps it is scope:
    // rewriting a constraint is not a conversion's job. See enumText in
    // packages/db/src/schema/columns.ts.
    mode: label("mode").notNull(),
    stateHash: label("state_hash").notNull(),
    nonce: label("nonce").notNull(),
    verifier: label("verifier").notNull(),
    expiresAt: tsString("expires_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "google_oidc_states_person_fk",
    }).onDelete("restrict"),
    check("google_oidc_states_mode_ck", sql`${t.mode} in ('login', 'link')`),
    check("google_oidc_states_state_hash_ck", sql`length(${t.stateHash}) = 64`),
  ],
);
