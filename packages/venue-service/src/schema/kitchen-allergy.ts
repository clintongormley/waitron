import { sql, type AnyColumn } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { id, json, table, ticketItems } from "@waitron/db";
import type { KitchenAllergyBlock } from "@waitron/module";

export function kitchenAllergyBlockCheck(column: AnyColumn) {
  return sql`case when ${column} is null then 1
    when not json_valid(${column}) then 0
    else json_type(${column}) is 'object'
      and json_type(${column}, '$.who') is 'text'
      and length(trim(json_extract(${column}, '$.who'))) between 1 and 40
      and json_type(${column}, '$.allergens') is 'object'
      and json_extract(${column}, '$.allergens') <> '{}'
      and json_type(${column}, '$.clashes') is 'object'
      and (json_type(${column}, '$.note') is 'null'
        or (json_type(${column}, '$.note') is 'text'
          and length(json_extract(${column}, '$.note')) <= 2000))
      and json_type(${column}, '$.labels.en.avoids') is 'array'
      and json_type(${column}, '$.labels.en.clashes') is 'array'
      and json_type(${column}, '$.labels.es.avoids') is 'array'
      and json_type(${column}, '$.labels.es.clashes') is 'array'
    end`;
}

export const ticketItemAllergies = table(
  "ticket_item_allergies",
  {
    ticketItemId: id("ticket_item_id").primaryKey(),
    // Row presence also freezes an unticked dish; an absent row has not been exposed yet.
    originalBlock: json<KitchenAllergyBlock>("original_block"),
    currentBlock: json<KitchenAllergyBlock>("current_block"),
  },
  (t) => [
    foreignKey({
      columns: [t.ticketItemId],
      foreignColumns: [ticketItems.id],
      name: "ticket_item_allergies_ticket_fk",
    }).onDelete("cascade"),
    check("ticket_item_allergies_original_ck", kitchenAllergyBlockCheck(t.originalBlock)),
    check("ticket_item_allergies_current_ck", kitchenAllergyBlockCheck(t.currentBlock)),
  ],
);
