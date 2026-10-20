import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { adjustmentReasons } from "./reasons.js";

/** drizzle runs a table's extraConfig callback lazily; `getTableConfig` forces it. */
describe("adjustment_reasons declarations", () => {
  it("declares the name index and every check by name, so a regeneration carries them", () => {
    const config = getTableConfig(adjustmentReasons);
    expect(config.indexes.map((index) => [index.config.name, index.config.unique])).toEqual([
      ["adjustment_reasons_name_key", true],
    ]);
    expect(config.checks.map((check) => check.name).sort()).toEqual([
      "adjustment_reasons_actions_ck",
      "adjustment_reasons_kind_ck",
      "adjustment_reasons_kind_fields_ck",
      "adjustment_reasons_max_amount_ck",
      "adjustment_reasons_max_percent_ck",
      "adjustment_reasons_name_ck",
      "adjustment_reasons_position_ck",
    ]);
  });
});
