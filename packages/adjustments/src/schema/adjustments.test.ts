import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { adjustments } from "./adjustments.js";

/** drizzle runs a table's extraConfig callback lazily; `getTableConfig` forces it. */
describe("adjustments declarations", () => {
  it("declares its keys, index and every check by name, so a regeneration carries them", () => {
    const config = getTableConfig(adjustments);
    expect(config.foreignKeys.map((key) => [key.getName(), key.onDelete]).sort()).toEqual([
      ["adjustments_reason_fk", "restrict"],
      ["adjustments_working_order_fk", "restrict"],
    ]);
    expect(config.indexes.map((index) => [index.config.name, index.config.unique])).toEqual([
      ["adjustments_order_reason_idx", false],
    ]);
    expect(config.checks.map((check) => check.name).sort()).toEqual([
      "adjustments_action_ck",
      "adjustments_amounts_ck",
      "adjustments_bill_level_ck",
      "adjustments_line_level_ck",
      "adjustments_percent_ck",
      "adjustments_reason_name_ck",
      "adjustments_stage_ck",
    ]);
  });
});
