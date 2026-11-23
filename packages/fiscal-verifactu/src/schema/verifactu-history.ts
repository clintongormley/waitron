import { sql } from "drizzle-orm";
import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, json, label, newId, nodes, persons, table, ts } from "@waitron/db";

export const verifactuHistory = table(
  "verifactu_history",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    seq: count("seq").notNull(),
    kind: label("kind").notNull(),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    personId: id("person_id").references(() => persons.id, { onDelete: "restrict" }),
    at: ts("at").notNull(),
    data: json<Record<string, unknown>>("data").notNull(),
  },
  (t) => [
    uniqueIndex("verifactu_history_seq_uq").on(t.seq),
    // Reject malformed JSON before any per-kind check reads the payload.
    check(
      "verifactu_history_data_ck",
      sql`case when json_valid(${t.data}) then json_type(${t.data}) = 'object' else 0 end`,
    ),
    check("verifactu_history_kind_ck", sql`${t.kind} = 'clock.confirmed'`),
    check(
      "verifactu_history_confirmed_source_ck",
      sql`${t.kind} <> 'clock.confirmed' or coalesce(json_extract(${t.data}, '$.source') in ('admin', 'staff'), 0)`,
    ),
    check(
      "verifactu_history_confirmed_reason_ck",
      sql`${t.kind} <> 'clock.confirmed' or coalesce(json_extract(${t.data}, '$.reason') in ('start', 'unusable'), 0)`,
    ),
    check(
      "verifactu_history_confirmed_person_ck",
      sql`${t.kind} <> 'clock.confirmed' or coalesce(length(${t.personId}) > 0, 0)`,
    ),
    check(
      "verifactu_history_confirmed_shape_ck",
      sql`${t.kind} <> 'clock.confirmed' or coalesce(
        json_type(${t.data}, '$.confirmedAt') = 'text'
        and json_type(${t.data}, '$.stepMs') = 'integer'
        and json_type(${t.data}, '$.proof') = 'object',
        0
      )`,
    ),
  ],
);
