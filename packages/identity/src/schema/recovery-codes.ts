import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { id, label, newId, nowIso, table, tsString } from "@waitron/db";
import { persons } from "./persons.js";

// The bracketed thunks below are resolved by `drizzle-kit generate` in its own CLI process,
// never by `vitest run`, so v8 reports them as never-invoked functions. Same treatment, and
// the same reason, as packages/db/src/schema/sales.ts.
export const recoveryCodes = table(
  "recovery_codes",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    personId: id("person_id").notNull(),
    codeHash: label("code_hash").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    usedAt: tsString("used_at"),
  },
  /* v8 ignore start */
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "recovery_codes_person_fk",
    }).onDelete("restrict"),
    index("recovery_codes_person_idx").on(t.personId),
    check("recovery_codes_hash_ck", sql`length(${t.codeHash}) = 64`),
  ],
  /* v8 ignore stop */
);
