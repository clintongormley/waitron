import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { correctivesOf } from "./correctives-of.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { sales } from "./schema/sales.js";
import { invoiceSeries } from "./schema/series.js";
import { seedDevice, seedNode, seedVenue } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function seller() {
  await seedVenue(suite.db, { name: "Fixture Venue" });
  const nodeId = await seedNode(suite.db);
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "A", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  const { deviceId } = await seedDevice(suite.db);
  let next = 0;
  return async (
    total: number,
    correction: { correctsSaleId?: string; replacesOriginal?: boolean } = {},
  ): Promise<string> => {
    next += 1;
    const [row] = await suite.db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: next,
        issuedAt: "2026-11-01T12:00:00.000Z",
        issuedOffsetMinutes: 60,
        total,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "fake",
        fiscalState: "recorded",
        ...correction,
      })
      .returning({ id: sales.id });
    return row!.id;
  };
}

async function correctives(saleId: string): Promise<string[]> {
  const result = await suite.db.execute<{ id: string }>(
    sql`select k.id from sales k where k.id in (${correctivesOf(sql`${saleId}`)}) order by k.invoice_number`,
  );
  return result.rows.map((row) => row.id);
}

describe("correctivesOf", () => {
  it("lists a sale's own correctives and its replacement's, leaving the replacement out", async () => {
    const sell = await seller();
    const original = await sell(1210);
    const refund = await sell(-110, { correctsSaleId: original });
    const replacement = await sell(1210, { correctsSaleId: original, replacesOriginal: true });
    const refundOfReplacement = await sell(-330, { correctsSaleId: replacement });
    const other = await sell(500);
    await sell(-100, { correctsSaleId: other });

    expect(await correctives(original)).toEqual([refund, refundOfReplacement]);
  });

  it("lists every corrective of a sale with no replacement", async () => {
    const sell = await seller();
    const original = await sell(1210);
    const first = await sell(-110, { correctsSaleId: original });
    const second = await sell(220, { correctsSaleId: original });

    expect(await correctives(original)).toEqual([first, second]);
  });
});
