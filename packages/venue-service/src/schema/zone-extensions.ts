import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { day, id, newId, table, timeOfDay } from "@waitron/db";
import { zoneServicePolicies } from "./service.js";

export const zoneExtensions = table(
  "zone_extensions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    zoneId: id("zone_id").notNull(),
    businessDay: day("business_day").notNull(),
    startsAt: timeOfDay("starts_at").notNull(),
    endsAt: timeOfDay("ends_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.zoneId],
      foreignColumns: [zoneServicePolicies.zoneId],
      name: "zone_extensions_zone_fk",
    }),
    uniqueIndex("zone_extensions_day_key").on(t.zoneId, t.businessDay),
    check(
      "zone_extensions_step_ck",
      sql`substr(${t.startsAt}, 4, 2) in ('00', '15', '30', '45')
      and substr(${t.endsAt}, 4, 2) in ('00', '15', '30', '45')`,
    ),
  ],
);
