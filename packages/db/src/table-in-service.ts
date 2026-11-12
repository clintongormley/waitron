import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** A table stays in service while it is on today's map in a switched-on zone, even if taken off. */
export function tableInService(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select service_table.id
    from dining_tables service_table
    inner join floor_zones service_zone on service_zone.id = service_table.zone_id
    where service_table.on_floor = 1 and service_zone.active = 1
  )`;
}
