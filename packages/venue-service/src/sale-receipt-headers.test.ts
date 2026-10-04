import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS, invoiceSeries, locations, sales } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { appendOnlyTablesIn } from "@waitron/sync-enrolment";
import { VENUE_SERVICE_CLASSIFICATION } from "./classification.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    {
      ...VENUE_SERVICE_MIGRATIONS,
      appendOnlyTables: appendOnlyTablesIn(VENUE_SERVICE_CLASSIFICATION),
    },
  ],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("sale receipt header snapshot", () => {
  it("keeps the issued department heading when its source department changes", async () => {
    await seedTenant(db);
    const [location] = await db
      .insert(locations)
      .values({
        name: "Corner Kitchen",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning({ id: locations.id });
    const locationId = brandLocationId(location!.id);
    const nodeId = await seedNode(db, locationId);
    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, { locationId, nodeId }));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "RC", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const [sale] = await db
      .insert(sales)
      .values({
        source: "demo_seed",
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: "2026-10-04T12:00:00Z",
        issuedOffsetMinutes: 120,
        total: 100,
        vatBreakdown: [],
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        fiscalBackend: "none",
        fiscalState: "recorded",
      })
      .returning({ id: sales.id });
    const department = await db.execute<{ id: string }>(sql`
      select id from departments where location_id = ${locationId}`);
    const departmentId = department.rows[0]!.id;

    await db.execute(sql`
      insert into sale_receipt_headers
        (sale_id, department_id, trading_name, print_trading_name)
      values (${sale!.id}, ${departmentId}, 'Corner Kitchen', 1)`);
    await db.execute(
      sql`update departments set trading_name = 'Renamed' where id = ${departmentId}`,
    );

    const rows = await db.execute<{
      department_id: string;
      trading_name: string;
      print_trading_name: number;
    }>(sql`
      select department_id, trading_name, print_trading_name
      from sale_receipt_headers where sale_id = ${sale!.id}`);
    expect(rows.rows).toEqual([
      { department_id: departmentId, trading_name: "Corner Kitchen", print_trading_name: 1 },
    ]);
    expect(() =>
      db.execute(
        sql`update sale_receipt_headers set trading_name = 'Renamed' where sale_id = ${sale!.id}`,
      ),
    ).toThrow("sale_receipt_headers is append-only");
    expect(() =>
      db.execute(sql`delete from sale_receipt_headers where sale_id = ${sale!.id}`),
    ).toThrow("sale_receipt_headers is append-only");
  });
});
