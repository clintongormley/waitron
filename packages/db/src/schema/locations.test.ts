import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

const venue = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("creates locations without the retired venue-wide order flow", async () => {
  const result = await venue.db.execute<{ name: string }>(
    sql`select name from pragma_table_info('locations')`,
  );
  expect(result.rows.map((row) => row.name)).not.toContain("order_flow");
});
