import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, invoiceSeries, sales } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE_PROVISIONING } from "./provisioning.js";

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
    });
    const nodeId = await seedNode(db);
    await db.transaction((tx) => VENUE_SERVICE_PROVISIONING.seed!.run(tx, { nodeId }));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "RC", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const department = await db.execute<{ id: string }>(sql`
      select id from departments `);
    const departmentId = department.rows[0]!.id;
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
        receiptDepartmentId: departmentId,
        receiptTradingName: "Corner Kitchen",
        receiptPrintsTradingName: true,
      })
      .returning({ id: sales.id });
    await db.execute(
      sql`update departments set trading_name = 'Renamed' where id = ${departmentId}`,
    );

    const rows = await db.execute<{
      department_id: string;
      trading_name: string;
      print_trading_name: number;
    }>(sql`
      select receipt_department_id as department_id, receipt_trading_name as trading_name,
        receipt_prints_trading_name as print_trading_name
      from sales where id = ${sale!.id}`);
    expect(rows.rows).toEqual([
      { department_id: departmentId, trading_name: "Corner Kitchen", print_trading_name: 1 },
    ]);
    expect(() =>
      db.execute(sql`update sales set receipt_trading_name = 'Renamed' where id = ${sale!.id}`),
    ).toThrow("sales is append-only");
    expect(() => db.execute(sql`delete from sales where id = ${sale!.id}`)).toThrow(
      "sales is append-only",
    );
  });
});
