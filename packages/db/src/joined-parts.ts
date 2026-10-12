import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * A table is a still-joined part while today's copy names its reset row as a part, the reset has
 * applied that row, and the joined table's reset row has a live table.
 */
export function stillJoinedPart(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select part_row.table_id
    from floor_reset_table_parts joined_part
    inner join floor_reset_tables part_row on part_row.id = joined_part.part_reset_table_id
    inner join floor_reset_tables joined_row on joined_row.id = joined_part.joined_reset_table_id
    where part_row.table_id is not null
      and (part_row.placed = 1 or part_row.pending = 0)
      and joined_row.table_id is not null
  )`;
}
