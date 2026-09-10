import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";
import { persons } from "./persons.js";

/** One short-lived, single-use Google authorization-code ceremony. These rows stay local because
 * the browser must return to the node that issued the state and PKCE verifier. */
export const googleOidcStates = pgTable(
  "google_oidc_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    personId: uuid("person_id"),
    mode: text("mode").notNull(),
    stateHash: text("state_hash").notNull(),
    nonce: text("nonce").notNull(),
    verifier: text("verifier").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "google_oidc_states_tenant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "google_oidc_states_person_fk",
    }).onDelete("restrict"),
    index("google_oidc_states_tenant_idx").on(t.tenantId),
    check("google_oidc_states_mode_ck", sql`${t.mode} in ('login', 'link')`),
    check("google_oidc_states_state_hash_ck", sql`length(${t.stateHash}) = 64`),
  ],
);
