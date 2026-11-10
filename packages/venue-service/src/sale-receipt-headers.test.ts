import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, sales } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";

// Core's set carries `sale_receipt_headers` among its append-only tables.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("sale receipt header snapshot", () => {
  it("keeps the issued department heading when its source department changes", async () => {
    await seedVenue(db, {
      name: "Corner Kitchen",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const nodeId = await seedNode(db);
    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, { nodeId }));
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
      select id from departments `);
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
