import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { isRefusal } from "../unique-violation.js";
import { locations, tenants } from "./tenants.js";
import { watchers } from "./watchers.js";

const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";
const WATCHER = "bbbbbbbb-0000-4000-8000-000000000001";
const AT = "2026-10-01T10:00:00.000Z";

describe("watchers schema", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture" });
    await suite.db.insert(locations).values({
      id: LOCATION,
      name: "Kitchen",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
  });

  async function insertWatcher(id: string, name: string) {
    await suite.db.insert(watchers).values({ id, locationId: LOCATION, name, createdAt: AT });
  }

  it("defaults a new watcher to no stations, no zones, no pass, and active", async () => {
    await insertWatcher(WATCHER, "Pass");
    const [row] = await suite.db.all<{
      every_station: number;
      every_zone: number;
      runs_pass: number;
      display_order: number;
      active: number;
    }>(
      sql`select every_station, every_zone, runs_pass, display_order, active from watchers where id = ${WATCHER}`,
    );
    expect(row).toEqual({
      every_station: 0,
      every_zone: 0,
      runs_pass: 0,
      display_order: 0,
      active: 1,
    });
  });

  it("refuses a second active watcher with the same name and accepts it after deactivation", async () => {
    await insertWatcher(WATCHER, "Pass");
    expect(
      isRefusal(await captureError(() => insertWatcher("watcher-2", "Pass")), UNIQUE_VIOLATION),
    ).toBe(true);
    await suite.db.execute(sql`update watchers set active = 0 where id = ${WATCHER}`);
    await insertWatcher("watcher-2", "Pass");
    expect(
      suite.db.all<{ id: string }>(sql`select id from watchers where name = 'Pass'`),
    ).toHaveLength(2);
  });

  it("declares the active-name condition in the schema used by new migrations", () => {
    const index = getTableConfig(watchers).indexes.find(
      (index) => index.config.name === "watchers_name_key",
    );
    expect(index?.config.where).toBeDefined();
  });
});
