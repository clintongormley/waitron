import { sql, type AnyColumn, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  floorResetTables,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
} from "./schema/floor-plans.js";

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

type ResetRowColumns = Record<
  "tableId" | "x" | "y" | "width" | "height" | "shape" | "rotation",
  AnyColumn
>;

/**
 * `movesTable`'s rule (apps/server/src/floor-reset-plan.ts) in SQL, for reset row `row`: its table
 * has a today's row, drawn and not taken off, and is in a merge, split off, or not exactly at the
 * row's placement.
 */
export function resetRowMoves(row: ResetRowColumns): SQL {
  const t = floorTodayTables;
  return sql`exists (
    select 1 from ${t}
    where ${t.tableId} = ${row.tableId} and ${t.takenOff} = 0 and ${t.x} is not null and (
      ${t.x} is not ${row.x} or ${t.y} is not ${row.y} or ${t.width} is not ${row.width}
      or ${t.height} is not ${row.height} or ${t.shape} is not ${row.shape}
      or ${t.rotation} is not ${row.rotation}
      or exists (select 1 from ${floorTodayJoinTables} where ${floorTodayJoinTables.tableId} = ${row.tableId})
      or exists (select 1 from ${floorTodaySplitParts} where ${floorTodaySplitParts.partTableId} = ${row.tableId})
    )
  )`;
}

const markedRow = alias(floorResetTables, "needs_moving_row");

/** The table's reset row waits for Mark moved and its own change moves it: the till's "Needs moving". */
export function needsMoving(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select ${markedRow.tableId} from ${floorResetTables} ${sql.identifier("needs_moving_row")}
    where ${markedRow.readyToMove} = 1 and ${resetRowMoves(markedRow)}
  )`;
}

/**
 * A table is a part of a joined table on its zone's saved plan, whatever the layout, and its zone
 * has no set recorded for `businessDay` (any zone, when `businessDay` is null).
 */
function anySavedPart(tableId: SQLWrapper, businessDay: string | null): SQL {
  const unrecorded =
    businessDay === null
      ? sql``
      : sql`where not exists (
          select 1 from floor_today_zones recorded
          where recorded.zone_id = joined_master.zone_id
            and recorded.business_day = ${businessDay}
            and recorded.set_id is not null
        )`;
  return sql`${tableId} in (
    select part_table.id
    from dining_tables part_table
    inner join floor_plan_table_parts saved_part on saved_part.part_table_id = part_table.plan_table_id
    inner join floor_plan_tables joined_master on joined_master.id = saved_part.joined_table_id
    ${unrecorded}
  )`;
}

/**
 * Reads the zone's record only when its business day is `businessDay`; else,
 * and with no recorded set, every part of a joined table is a saved part and no joined table is.
 * Under a usable record it reads what the zone's last reset copied, so a layout saved since then
 * changes nothing until Update layout: a part is a saved part when the copy places its joined
 * table or none of its parts, and a joined table is one when the copy leaves it off while placing
 * a part.
 */
export function savedPart(tableId: SQLWrapper, businessDay: string | null): SQL {
  if (businessDay === null) return anySavedPart(tableId, null);
  const usable = (zoneId: SQL) =>
    sql`exists (
      select 1 from floor_today_zones recorded
      where recorded.zone_id = ${zoneId}
        and recorded.business_day = ${businessDay}
        and recorded.set_id is not null
    )`;
  const partPlaced = (joinedRowId: SQL) =>
    sql`exists (
      select 1
      from floor_reset_table_parts sibling
      inner join floor_reset_tables sibling_row on sibling_row.id = sibling.part_reset_table_id
      where sibling.joined_reset_table_id = ${joinedRowId} and sibling_row.x is not null
    )`;
  return sql`(${anySavedPart(tableId, businessDay)} or ${tableId} in (
    select part_row.table_id
    from floor_reset_table_parts copied_part
    inner join floor_reset_tables part_row on part_row.id = copied_part.part_reset_table_id
    inner join floor_reset_tables joined_row on joined_row.id = copied_part.joined_reset_table_id
    where part_row.table_id is not null
      and ${usable(sql`joined_row.zone_id`)}
      and (joined_row.x is not null or not ${partPlaced(sql`joined_row.id`)})
    union
    select joined_row.table_id
    from floor_reset_tables joined_row
    where joined_row.table_id is not null
      and joined_row.x is null
      and ${usable(sql`joined_row.zone_id`)}
      and ${partPlaced(sql`joined_row.id`)}
  ))`;
}
