import { expect, it } from "vitest";
import { foldStationPrinters } from "./fk7-station-printer-fixtures.mjs";

it("replaces a literal insert with the shared fixture call and is idempotent", () => {
  const source =
    'import { stationPrinters } from "@waitron/db";\nawait tx.insert(stationPrinters).values({ stationId: S, printerId: P });';
  const result = foldStationPrinters(source, "sample.test.ts");
  expect(result.reports).toEqual([]);
  expect(result.text).toContain(
    'import { attachStationPrinterForTest } from "@waitron/db/testing/seed.js";',
  );
  expect(result.text).toContain("await attachStationPrinterForTest(tx, S, P);");
  expect(result.text).not.toContain("stationPrinters");
  expect(foldStationPrinters(result.text, "sample.test.ts")).toEqual(result);
});

it("expands a literal array into calls in input order", () => {
  const result = foldStationPrinters(
    "await db.insert(stationPrinters).values([{ stationId: S, printerId: P }, { stationId: T, printerId: Q }]);",
    "sample.test.ts",
  );
  expect(result.reports).toEqual([]);
  expect(result.text).toContain(
    "await attachStationPrinterForTest(db, S, P);\nawait attachStationPrinterForTest(db, T, Q);",
  );
});

it.each([
  "await tx.insert(stationPrinters).values(rows);",
  "await tx.insert(stationPrinters).values([{ stationId: S, printerId: P }, other]);",
  "const rows = await tx.select().from(stationPrinters);",
  "const row = await tx.insert(stationPrinters).values({ stationId: S, printerId: P }).returning();",
])("reports unsupported writes and reads without changing them: %s", (source) => {
  const result = foldStationPrinters(source, "sample.test.ts");
  expect(result.text).toBe(source);
  expect(result.reports).toHaveLength(1);
});
