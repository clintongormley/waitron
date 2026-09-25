import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "../migrations.js";
import { useVenueDb } from "../testing/venue-db.js";

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS] });

describe("sale_voids schema", () => {
  it("indexes voided_at, which the reports select voids by", async () => {
    const indexed = await fx.db.execute<{ index: string; column: string }>(sql`
      select l.name as "index", i.name as "column"
      from pragma_index_list('sale_voids') l, pragma_index_info(l.name) i
      where l.name = 'sale_voids_voided_at_idx'`);
    expect(indexed.rows).toEqual([{ index: "sale_voids_voided_at_idx", column: "voided_at" }]);
  });
});
