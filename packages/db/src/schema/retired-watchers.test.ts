import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_CONFIGURATION_TRANSFER } from "../configuration-transfer.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

const RETIRED = ["watchers", "watcher_stations", "watcher_zones", "watcher_printers"];

describe("retired watchers", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("a venue migrated with the core set has none of the four watcher tables", () => {
    const tables = suite.db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((row) => row.name);
    expect(tables).toContain("kitchen_stations");
    for (const name of RETIRED) expect(tables).not.toContain(name);
  });

  it("the core configuration transfer names none of the four watcher tables", () => {
    const names = CORE_CONFIGURATION_TRANSFER.tables.map((table) => table.name);
    expect(names).toContain("station_printers");
    for (const name of RETIRED) expect(names).not.toContain(name);
  });
});
