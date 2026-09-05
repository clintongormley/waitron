import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "ANOS_CONSERVACION",
        "TITULARES_ACCESO",
        "exportTimeRecord",
        "WORKFORCE_ES_MIGRATIONS",
        "WORKFORCE_ES_VOCABULARY",
        "convenioConfig",
        "overtimeModel",
        "resolveWorkTimeRuleset",
      ].sort(),
    );
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import or a plain
 * select never runs it, which is why convenio-config.ts's FK/unique/index/check block shows as
 * uncovered even though the resolver imports the table. Calling `getTableConfig` forces the callback
 * to run, and the assertions below are the meaningful check that convenio_config's constraints exist
 * under the names the migration and the RLS policy depend on — not a coverage stunt. Mirrors
 * packages/workforce/src/index.test.ts.
 */
describe("convenio_config constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares convenio_config's foreign keys, unique key and working-days check", () => {
    const config = getTableConfig(api.convenioConfig);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(
      expect.arrayContaining(["convenio_config_tenant_fk", "convenio_config_location_fk"]),
    );

    expect(config.uniqueConstraints.map((u) => u.getName())).toContain(
      "convenio_config_tenant_location_uq",
    );

    expect(config.checks.map((c) => c.name)).toContain("convenio_config_working_days_ck");
  });
});
