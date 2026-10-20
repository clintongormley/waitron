CREATE TABLE `ticket_item_allergies` (
	`ticket_item_id` text PRIMARY KEY NOT NULL,
	`original_block` text,
	`current_block` text,
	FOREIGN KEY (`ticket_item_id`) REFERENCES `ticket_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ticket_item_allergies_original_ck" CHECK(case when "ticket_item_allergies"."original_block" is null then 1
    when not json_valid("ticket_item_allergies"."original_block") then 0
    else json_type("ticket_item_allergies"."original_block") is 'object'
      and json_type("ticket_item_allergies"."original_block", '$.who') is 'text'
      and length(trim(json_extract("ticket_item_allergies"."original_block", '$.who'))) between 1 and 40
      and json_type("ticket_item_allergies"."original_block", '$.allergens') is 'object'
      and json_extract("ticket_item_allergies"."original_block", '$.allergens') <> '{}'
      and json_type("ticket_item_allergies"."original_block", '$.clashes') is 'object'
      and (json_type("ticket_item_allergies"."original_block", '$.note') is 'null'
        or (json_type("ticket_item_allergies"."original_block", '$.note') is 'text'
          and length(json_extract("ticket_item_allergies"."original_block", '$.note')) <= 2000))
      and json_type("ticket_item_allergies"."original_block", '$.labels.en.avoids') is 'array'
      and json_type("ticket_item_allergies"."original_block", '$.labels.en.clashes') is 'array'
      and json_type("ticket_item_allergies"."original_block", '$.labels.es.avoids') is 'array'
      and json_type("ticket_item_allergies"."original_block", '$.labels.es.clashes') is 'array'
    end),
	CONSTRAINT "ticket_item_allergies_current_ck" CHECK(case when "ticket_item_allergies"."current_block" is null then 1
    when not json_valid("ticket_item_allergies"."current_block") then 0
    else json_type("ticket_item_allergies"."current_block") is 'object'
      and json_type("ticket_item_allergies"."current_block", '$.who') is 'text'
      and length(trim(json_extract("ticket_item_allergies"."current_block", '$.who'))) between 1 and 40
      and json_type("ticket_item_allergies"."current_block", '$.allergens') is 'object'
      and json_extract("ticket_item_allergies"."current_block", '$.allergens') <> '{}'
      and json_type("ticket_item_allergies"."current_block", '$.clashes') is 'object'
      and (json_type("ticket_item_allergies"."current_block", '$.note') is 'null'
        or (json_type("ticket_item_allergies"."current_block", '$.note') is 'text'
          and length(json_extract("ticket_item_allergies"."current_block", '$.note')) <= 2000))
      and json_type("ticket_item_allergies"."current_block", '$.labels.en.avoids') is 'array'
      and json_type("ticket_item_allergies"."current_block", '$.labels.en.clashes') is 'array'
      and json_type("ticket_item_allergies"."current_block", '$.labels.es.avoids') is 'array'
      and json_type("ticket_item_allergies"."current_block", '$.labels.es.clashes') is 'array'
    end)
);
--> statement-breakpoint
ALTER TABLE `kitchen_notices` ADD `allergy_block` text;