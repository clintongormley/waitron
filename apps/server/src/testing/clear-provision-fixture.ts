import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears historical untraded fixtures; activation-ledger references can refuse owner deletion. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // All listed fixture rows are removed together; check their foreign keys at commit.
    await tx.execute(sql`pragma defer_foreign_keys = on`);
    for (const table of [
      // A season day's range keys its period with no delete rule; the days take their ranges.
      "department_days",
      "zone_days",
      "seasons",

      "special_days",
      "menu_period_staff_menus",
      "menu_periods",
      "routing_cell_periods",
      "routing_cells",
      "device_profile_zones",
      "device_profile_service_access",
      "device_profile_kitchen_screen_stations",
      "device_profile_kitchen_screen_zones",
      "device_profile_kitchen_screens",
      "device_profile_admission_roles",
      "device_approved_profiles",
      "floor_plan_sets",
      "service_steps",
      "kitchen_courses",
      "floor_zones",
      "departments",
      "venue_credentials",
      "management_sessions",
      "device_profiles",
      "persons",
      "cadenas",
      "registro_sif",
      "invoice_series",
      "nodes",
      "device_made_here_stations",
      "kitchen_stations",
      "day_cutover_changes",
      "sections",
      "menus",
      "units",
      "settings",
      "taxpayer",
      "deployment",
    ]) {
      await tx.execute(sql`delete from ${sql.identifier(table)}`);
    }
  });
}
