import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "./testing/venue-db.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { tableExists } from "./table-exists.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("tableExists", () => {
  it("finds tables by their exact bound name and excludes views", async () => {
    suite.db.run(sql`create view table_exists_view as select 1 as id`);

    expect(await tableExists(suite.db, "tenants")).toBe(true);
    expect(await tableExists(suite.db, "table_exists_view")).toBe(false);
    expect(await tableExists(suite.db, "tenants' or 1=1 --")).toBe(false);
    expect(await tableExists(suite.db, "missing_table")).toBe(false);
  });
});
