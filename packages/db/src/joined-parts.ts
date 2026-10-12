import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * A table is a still-joined part while today's copy names its reset row as a part, the reset has
 * applied that row, the joined table's reset row has a live table, the part has not been split off
 * today, and the table is in use by neither an open party nor one of today's merges: a part in use
 * when its joined table goes live stays in use until it is free.
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
      and not exists (
        select 1 from party_tables held
        where held.table_id = part_row.table_id and held.left_at is null
      )
      and not exists (
        select 1 from floor_today_join_tables merged where merged.table_id = part_row.table_id
      )
      and not exists (
        select 1 from floor_today_split_parts split_off where split_off.part_table_id = part_row.table_id
      )
  )`;
}

/** A joined table of today's copy with fewer than two parts still joined, that no party holds and no merge takes in. */
export function joinedTableApart(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select joined_row.table_id
    from floor_reset_table_parts joined_part
    inner join floor_reset_tables joined_row on joined_row.id = joined_part.joined_reset_table_id
    inner join floor_reset_tables part_row on part_row.id = joined_part.part_reset_table_id
    where joined_row.table_id is not null
      and not exists (select 1 from party_tables held where held.table_id = joined_row.table_id and held.left_at is null)
      and not exists (select 1 from floor_today_join_tables merged where merged.table_id = joined_row.table_id)
    group by joined_row.table_id
    having sum(case when ${stillJoinedPart(sql`part_row.table_id`)} then 1 else 0 end) < 2
  )`;
}

/** Out of service because of a joined table: a part still joined, or a joined table come apart. */
export function joinedOutOfService(tableId: SQLWrapper): SQL {
  return sql`(${stillJoinedPart(tableId)} or ${joinedTableApart(tableId)})`;
}

/** A table follows a part of a joined table on its zone's saved plan. */
export function savedPart(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select part_table.id
    from dining_tables part_table
    inner join floor_plan_table_parts saved_part on saved_part.part_table_id = part_table.plan_table_id
  )`;
}
