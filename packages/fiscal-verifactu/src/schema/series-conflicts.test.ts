import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { expect, it } from "vitest";
import { fiscalSeriesConflicts } from "./series-conflicts.js";

it("exports the retained observation's identity and series links and number uniqueness in its runtime schema", () => {
  const config = getTableConfig(fiscalSeriesConflicts);
  expect(
    config.foreignKeys.map((key) => {
      const ref = key.reference();
      return {
        columns: ref.columns.map((column) => column.name),
        table: getTableName(ref.foreignTable),
        target: ref.foreignColumns.map((column) => column.name),
      };
    }),
  ).toEqual([
    { columns: ["sif_id"], table: "registro_sif", target: ["id"] },
    { columns: ["series_id"], table: "invoice_series", target: ["id"] },
  ]);
  expect(
    config.indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
      columns: index.config.columns.map((column) => ("name" in column ? column.name : null)),
    })),
  ).toEqual([
    {
      name: "fiscal_series_conflicts_invoice_uq",
      unique: true,
      columns: ["sif_id", "invoice_identity"],
    },
  ]);
});
