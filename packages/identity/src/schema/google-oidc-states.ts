import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { id, label, newId, table, tsString } from "@waitron/db";

/** One short-lived, single-use Google authorization-code ceremony. The state is stored only as its
 * hash. */
// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as packages/db/src/schema/sales.ts.
export const googleOidcStates = table(
  "google_oidc_states",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // No key to `persons`: none was restored when the table became `state` (docs/backlog.md,
    // slice-2 Task 1b). Null for a login; `completeGoogleLink` refuses a link whose person is gone.
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
  /* v8 ignore start */
  (t) => [
    check("google_oidc_states_mode_ck", sql`${t.mode} in ('login', 'link')`),
    check("google_oidc_states_state_hash_ck", sql`length(${t.stateHash}) = 64`),
  ],
  /* v8 ignore stop */
);
