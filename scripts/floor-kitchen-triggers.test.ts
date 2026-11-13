import { expect, it } from "vitest";
import { createRequire } from "node:module";
const { sql } = createRequire(new URL("../packages/db/package.json", import.meta.url))(
  "drizzle-orm",
);
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { installChangeFeed } from "../packages/db/src/change-feed.js";
import { useVenueDb } from "../packages/db/src/testing/venue-db.js";
import { migrationOptionsFor } from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(orderedMigrationSets(ALL_MODULES), null),
  setup: async (db) => {
    await db.withWriteLock(() =>
      installChangeFeed(
        db,
        ALL_MODULES.flatMap((module) => module.changes ?? []),
      ),
    );
  },
});

it("keeps only the named allergy guards on the floor and kitchen tables", () => {
  const tables = [
    "floor_zones",
    "floor_plan_tables",
    "dining_tables",
    "floor_reset_tables",
    "floor_plan_sets",
    "floor_plans",
    "floor_plan_placements",
    "table_merges",
    "parties",
    "party_tables",
    "party_allergy_guests",
    "allergy_line_ticks",
    "bookings",
    "order_kitchen_notes",
    "service_steps",
    "service_step_completions",
    "kitchen_stations",
    "kitchen_courses",
    "ticket_items",
    "ticket_item_moves",
    "kitchen_print_jobs",
    "kitchen_print_job_lines",
    "kitchen_notices",
    "routing_cells",
    "routing_cell_periods",
  ];
  const area = new RegExp(`\\b(?:${tables.join("|")})\\b`, "i");
  const triggers = suite.db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  expect(
    triggers
      .filter((trigger) => !trigger.name.startsWith("waitron_change_") && area.test(trigger.sql))
      .map((trigger) => trigger.name),
  ).toEqual(["party_allergy_guests_need_answer_insert", "party_allergy_guests_need_answer_update"]);
});
