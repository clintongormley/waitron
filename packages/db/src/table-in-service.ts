import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** A table stays in service while it has a today's row in a switched-on zone, even if taken off. */
export function tableInService(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select service_today.table_id
    from floor_today_tables service_today
    inner join dining_tables service_table on service_table.id = service_today.table_id
    inner join floor_zones service_zone on service_zone.id = service_table.zone_id
    where service_zone.active = 1
  )`;
}
