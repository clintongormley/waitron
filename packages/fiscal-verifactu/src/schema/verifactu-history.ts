import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, json, label, newId, nodes, persons, table, ts } from "@waitron/db";
import { verifactuRecords } from "./verifactu-records.js";

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
    eventKey: label("event_key"),
    registroId: id("registro_id").references(() => verifactuRecords.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("verifactu_history_seq_uq").on(t.seq),
    uniqueIndex("verifactu_history_event_key_uq").on(t.eventKey),
    index("verifactu_history_registro_kind_seq_idx").on(t.registroId, t.kind, t.seq),
    // Reject malformed JSON before any per-kind check reads the payload.
    check(
      "verifactu_history_data_ck",
      sql`case when json_valid(${t.data}) then json_type(${t.data}) = 'object' else 0 end`,
    ),
    check(
      "verifactu_history_kind_ck",
      sql`${t.kind} in ('clock.confirmed', 'conflict.observed', 'conflict.lookup', 'case.note')`,
    ),
    // The writer serializes an object with unique keys. For a repeated key in raw JSON, SQLite
    // checks the first value and JSON.parse reads the last.
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
    check(
      "verifactu_history_confirmed_links_ck",
      sql`${t.kind} <> 'clock.confirmed' or coalesce(
        ${t.eventKey} is null and ${t.registroId} is null, 0
      )`,
    ),
    check(
      "verifactu_history_observed_ck",
      sql`${t.kind} <> 'conflict.observed' or coalesce(
        ${t.registroId} is not null
        and json_type(${t.data}, '$.attempt') = 'integer'
        and json_extract(${t.data}, '$.attempt') > 0
        and json_extract(${t.data}, '$.cause') in ('fiscal.huella_divergente', 'fiscal.duplicado_anulado')
        and json_type(${t.data}, '$.evidence') is not null
        and ${t.personId} is null
        and ${t.eventKey} = 'conflict:' || ${t.registroId} || ':' || json_extract(${t.data}, '$.attempt') || ':' || json_extract(${t.data}, '$.cause'),
        0
      )`,
    ),
    check(
      "verifactu_history_lookup_ck",
      sql`${t.kind} <> 'conflict.lookup' or coalesce(
        ${t.registroId} is not null
        and json_type(${t.data}, '$.evidence') is not null
        and ${t.personId} is null
        and ${t.eventKey} = 'lookup:' || ${t.registroId},
        0
      )`,
    ),
    check(
      "verifactu_history_note_ck",
      sql`${t.kind} <> 'case.note' or coalesce(
        ${t.registroId} is not null and ${t.personId} is not null
        and substr(${t.eventKey}, 1, 10) = 'case.note:' and length(${t.eventKey}) > 10
        and json_type(${t.data}, '$.action') = 'text',
        0
      )`,
    ),
  ],
);
