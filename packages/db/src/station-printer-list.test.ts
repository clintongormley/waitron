import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { kitchenStations } from "./schema/kitchen-stations.js";
import { removeIdFromJson } from "./json-id-lists.js";
import {
  readStationPrinterPairs,
  stationPrinterPairs,
  withPrinter,
} from "./station-printer-list.js";
import { useVenueDb } from "./testing/venue-db.js";
import { withTransaction } from "./tenancy.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

it("adds a printer in sorted order without repeating an existing id or changing its input", () => {
  const ids = ["q", "p", "q"];
  expect(withPrinter(ids, "p")).toEqual(["p", "q"]);
  expect(withPrinter(ids, "a")).toEqual(["a", "p", "q"]);
  expect(ids).toEqual(["q", "p", "q"]);
});

it("finds every station for a printer, filters stations in SQL and reads pairs in order", async () => {
  await suite.db.insert(kitchenStations).values([
    { id: "one", name: "One", printerIds: ["q", "p"] },
    { id: "two", name: "Two", printerIds: ["p"], active: false },
    { id: "empty", name: "Empty" },
  ]);
  expect(await readStationPrinterPairs(suite.db, { printerId: "p" })).toEqual([
    { stationId: "one", printerId: "p" },
    { stationId: "two", printerId: "p" },
  ]);
  expect(await readStationPrinterPairs(suite.db, { stationIds: ["one"] })).toEqual([
    { stationId: "one", printerId: "p" },
    { stationId: "one", printerId: "q" },
  ]);
  expect(await readStationPrinterPairs(suite.db, { activeStationsOnly: true })).toEqual([
    { stationId: "one", printerId: "p" },
    { stationId: "one", printerId: "q" },
  ]);
  expect(await readStationPrinterPairs(suite.db, { stationIds: [] })).toEqual([]);
  expect(
    await suite.db
      .select({
        stationId: stationPrinterPairs.stationId,
        printerId: stationPrinterPairs.printerId,
      })
      .from(stationPrinterPairs)
      .where(sql`${stationPrinterPairs.printerId} = 'q'`),
  ).toEqual([{ stationId: "one", printerId: "q" }]);
  expect(
    await withTransaction(suite.db, (tx) => removeIdFromJson(tx, kitchenStations.printerIds, "p")),
  ).toBe(2);
  expect(
    await suite.db
      .select({ id: kitchenStations.id, printerIds: kitchenStations.printerIds })
      .from(kitchenStations)
      .orderBy(kitchenStations.id),
  ).toEqual([
    { id: "empty", printerIds: [] },
    { id: "one", printerIds: ["q"] },
    { id: "two", printerIds: [] },
  ]);
});

it("normalizes the rewritten printer ids after a configuration import", async () => {
  await suite.db
    .insert(kitchenStations)
    .values({ id: "station", name: "Imported", printerIds: ["z", "a", "z"] });
  await withTransaction(suite.db, (tx) => CORE_CONFIGURATION_TRANSFER.afterImport(tx));
  expect((await suite.db.select().from(kitchenStations))[0]!.printerIds).toEqual(["a", "z"]);
});
