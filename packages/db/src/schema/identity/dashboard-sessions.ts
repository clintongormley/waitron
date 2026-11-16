import { persons } from "./persons.js";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText, id, label, newId, nowIso, table, tsString } from "../columns.js";

export const dashboardSessions = table(
  "dashboard_sessions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tokenHash: label("token_hash").notNull(),
    personId: id("person_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    lastSeenAt: tsString("last_seen_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
    provedAt: tsString("proved_at"),
    proofMethod: enumText("proof_method", ["password", "passkey", "recovery-code"]),
  },
  (t) => [
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "dashboard_sessions_person_fk",
    }).onDelete("restrict"),
    // For the writes that end a person's open sessions.
    index("dashboard_sessions_open_idx").on(t.personId),
    uniqueIndex("dashboard_sessions_token_hash_uq").on(t.tokenHash),
    check("dashboard_sessions_token_hash_ck", sql`length(${t.tokenHash}) = 64`),
    check("dashboard_sessions_proof_method_ck", enumCheck(t.proofMethod)),
  ],
);
