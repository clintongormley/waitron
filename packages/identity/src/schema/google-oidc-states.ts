import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { id, label, newId, table, tsString } from "@waitron/db";

/** One short-lived, single-use Google authorization-code ceremony. The state is stored only as its
 * hash. */
export const googleOidcStates = table(
  "google_oidc_states",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // No key to `persons`: none was restored when the table became `state` (docs/backlog.md,
    // slice-2 Task 1b). Null for a login; `completeGoogleLink` refuses a link whose person is gone.
    personId: id("person_id"),
    mode: label("mode").notNull(),
    stateHash: label("state_hash").notNull(),
    nonce: label("nonce").notNull(),
    verifier: label("verifier").notNull(),
    expiresAt: tsString("expires_at").notNull(),
  },
  /* v8 ignore start */
  (t) => [
    check("google_oidc_states_mode_ck", sql`${t.mode} in ('login', 'link')`),
    check("google_oidc_states_state_hash_ck", sql`length(${t.stateHash}) = 64`),
  ],
  /* v8 ignore stop */
);
