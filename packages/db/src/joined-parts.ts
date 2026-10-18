import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * A table is a still-joined part while today's copy names its reset row as a part, the joined
 * table's reset row has a live table, the part has not been split off today, and the table is in
 * use by neither an open party nor one of today's merges: a part in use when its joined table goes
 * live stays in use until it is free. Whether the joined table holds its parts is read from
 * today's map: it does while it is drawn, whether or not the part's reset row still waits; when it
 * is not drawn, it does once the part's reset row has been applied and while none of its parts
 * that were not split off today is drawn.
 */
export function stillJoinedPart(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select part_row.table_id
    from floor_reset_table_parts joined_part
    inner join floor_reset_tables part_row on part_row.id = joined_part.part_reset_table_id
    inner join floor_reset_tables joined_row on joined_row.id = joined_part.joined_reset_table_id
    where part_row.table_id is not null
      and joined_row.table_id is not null
      and (
        exists (
          select 1 from floor_today_tables joined_drawn
          where joined_drawn.table_id = joined_row.table_id
            and joined_drawn.x is not null and joined_drawn.taken_off = 0
        )
        or (
          (part_row.placed = 1 or part_row.pending = 0)
          and not exists (
            select 1
            from floor_reset_table_parts sibling
            inner join floor_reset_tables sibling_row on sibling_row.id = sibling.part_reset_table_id
            inner join floor_today_tables sibling_drawn on sibling_drawn.table_id = sibling_row.table_id
            where sibling.joined_reset_table_id = joined_row.id
              and sibling_drawn.x is not null and sibling_drawn.taken_off = 0
              and not exists (
                select 1 from floor_today_split_parts sibling_split
                where sibling_split.part_table_id = sibling_row.table_id
              )
          )
        )
      )
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

/** A table follows a part of a joined table on its zone's saved plan, whatever the layout. */
function anySavedPart(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select part_table.id
    from dining_tables part_table
    inner join floor_plan_table_parts saved_part on saved_part.part_table_id = part_table.plan_table_id
  )`;
}

/**
 * Reads the zone's record only when its business day is `businessDay` (spec decision 2); else,
 * and with no recorded set, every part of a joined table is a saved part and no joined table is.
 * Under a usable record a part is a saved part when the recorded layout places its joined table
 * or none of its parts, and a joined table is one when that layout leaves it off while placing a
 * part.
 */
export function savedPart(tableId: SQLWrapper, businessDay: string | null): SQL {
  if (businessDay === null) return anySavedPart(tableId);
  const placedIn = (layout: SQL, planTableId: SQL) =>
    sql`exists (
      select 1 from floor_plan_placements placed
      where placed.plan_id = ${layout} and placed.plan_table_id = ${planTableId}
    )`;
  const partPlacedIn = (layout: SQL, joinedPlanTableId: SQL) =>
    sql`exists (
      select 1
      from floor_plan_table_parts sibling
      inner join floor_plan_placements placed on placed.plan_table_id = sibling.part_table_id
      where sibling.joined_table_id = ${joinedPlanTableId} and placed.plan_id = ${layout}
    )`;
  return sql`${tableId} in (
    select part_table.id
    from dining_tables part_table
    inner join floor_plan_table_parts saved_part on saved_part.part_table_id = part_table.plan_table_id
    inner join floor_plan_tables joined_master on joined_master.id = saved_part.joined_table_id
    left join floor_today_zones recorded
      on recorded.zone_id = joined_master.zone_id
      and recorded.business_day = ${businessDay}
    left join floor_plans layout
      on layout.zone_id = recorded.zone_id and layout.set_id = recorded.set_id
    where recorded.id is null
      or ${placedIn(sql`layout.id`, sql`saved_part.joined_table_id`)}
      or not ${partPlacedIn(sql`layout.id`, sql`saved_part.joined_table_id`)}
    union
    select joined_table.id
    from dining_tables joined_table
    inner join floor_plan_tables joined_master on joined_master.id = joined_table.plan_table_id
    inner join floor_today_zones recorded
      on recorded.zone_id = joined_master.zone_id and recorded.business_day = ${businessDay}
    inner join floor_plans layout
      on layout.zone_id = recorded.zone_id and layout.set_id = recorded.set_id
    where not ${placedIn(sql`layout.id`, sql`joined_master.id`)}
      and ${partPlacedIn(sql`layout.id`, sql`joined_master.id`)}
  )`;
}
