import { sql, type AnyColumn } from "drizzle-orm";

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
