import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkFailed } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode, seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { saleLines, sales } from "./sales.js";
import { invoiceSeries } from "./series.js";

const AT = "2026-11-20T12:00:00.000Z";

describe("sale_lines.set_menu_role", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("a sale line holds a set-menu role or none", async () => {
    const db = suite.db;
    await seedVenue(db, { name: "Set menus", invoiceLocales: ["es"] });
    const nodeId = await seedNode(db);
    const { deviceId } = await seedDevice(db);
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "SM", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 0,
        total: 2800,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning({ id: sales.id });
    const saleId = sale!.id;
    const line = (lineNo: number, setMenuRole: "set_menu" | "dish" | null) =>
      db.insert(saleLines).values({
        saleId,
        lineNo,
        name: "Daily menu",
        descriptions: { es: "Daily menu" },
        quantity: 1000,
        unitPrice: 1400,
        vatRate: 1000,
        lineTotal: 1400,
        setMenuRole,
      });

    await line(1, "set_menu");
    await line(2, "dish");
    await line(3, null);

    const unknown = await captureError(() =>
      db.run(
        sql`insert into sale_lines (id, sale_id, line_no, name, descriptions, quantity, unit_price, vat_rate, line_total, set_menu_role) values ('x', ${saleId}, 4, 'A', '{}', 1000, 1, 1000, 1, 'extra')`,
      ),
    );
    expect(checkFailed(unknown, "sale_lines_set_menu_role_ck")).toBe(true);

    expect(
      await db
        .select({ lineNo: saleLines.lineNo, setMenuRole: saleLines.setMenuRole })
        .from(saleLines)
        .where(eq(saleLines.saleId, saleId))
        .orderBy(asc(saleLines.lineNo)),
    ).toEqual([
      { lineNo: 1, setMenuRole: "set_menu" },
      { lineNo: 2, setMenuRole: "dish" },
      { lineNo: 3, setMenuRole: null },
    ]);
  });
});
