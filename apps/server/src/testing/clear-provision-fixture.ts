import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";

/** Clears historical untraded fixtures; activation-ledger references can refuse owner deletion. */
export async function clearProvisionFixture(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // All listed fixture rows are removed together; check their foreign keys at commit.
    await tx.execute(sql`pragma defer_foreign_keys = on`);
    for (const table of [
      // A range keys its period with no delete rule, so remove ranges first.
      "opening_hours",
      "seasons",

      "special_days",
      "menu_periods",
      "routing_cell_periods",
      "routing_cells",
      "device_approved_profiles",
      "floor_plan_sets",
      "service_steps",
      "kitchen_courses",
      "floor_zones",
      "departments",
      "venue_credentials",
      "activity_log",
      "dashboard_sessions",
      "device_profiles",
      "persons",
      "verifactu_identities",
      "invoice_series",
      "nodes",
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
