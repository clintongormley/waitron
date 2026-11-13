import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedVenue } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { kitchenStations } from "./kitchen-stations.js";
import { printers } from "./printers.js";
import { readStationPrinterPairs } from "../station-printer-list.js";
import { attachStationPrinterForTest } from "../testing/seed.js";

describe("station printer list mapping", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await seedVenue(suite.db, {
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Drizzle rather than raw SQL: `id` and `created_at` are `$defaultFn` columns a raw insert does
  // not fill.
  async function seedStation(name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(kitchenStations)
        .values({ name })
        .returning({ id: kitchenStations.id });
      return row!.id;
    });
  }

  // cloud_poll needs only `poll_id`, so the suite needs no other printer fixture.
  async function seedPrinter(name: string, pollId: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(printers)
        .values({ name, transport: "cloud_poll", pollId })
        .returning({ id: printers.id });
      return row!.id;
    });
  }

  async function seedMapping(station: string, printer: string): Promise<void> {
    await inTx((tx) => attachStationPrinterForTest(tx, station, printer));
  }

  it("reads the station/printer pair and clears the list through the Drizzle export", async () => {
    const station = await seedStation("Kitchen");
    const printer = await seedPrinter("Kitchen printer", "poll-control");
    await seedMapping(station, printer);
    const [row] = await inTx((tx) => readStationPrinterPairs(tx, { stationIds: [station] }));
    expect(row!.stationId).toBe(station);
    expect(row!.printerId).toBe(printer);
    const cleared = await inTx((tx) =>
      tx
        .update(kitchenStations)
        .set({ printerIds: [] })
        .where(eq(kitchenStations.id, station))
        .returning({ printerIds: kitchenStations.printerIds }),
    );
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.printerIds).toEqual([]);
    expect(await inTx((tx) => readStationPrinterPairs(tx, { stationIds: [station] }))).toEqual([]);
  });
});
