import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { adjustmentSettings } from "./settings.js";

/** drizzle runs a table's extraConfig callback lazily; `getTableConfig` forces it. */
describe("adjustment_settings declarations", () => {
  it("declares every check by name, so a regeneration carries them", () => {
    const config = getTableConfig(adjustmentSettings);
    expect(config.checks.map((check) => check.name).sort()).toEqual([
      "adjustment_settings_max_bill_discount_ck",
      "adjustment_settings_singleton_ck",
    ]);
  });
});
