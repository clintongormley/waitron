import { describe, expect, it } from "vitest";
import { manifestSets } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { ALL_MODULES, ALL_SYNC_ENROLMENTS, MODULE_BY_TABLE } from "./modules.js";

describe("ALL_MODULES is the migration source of truth", () => {
  it("derives exactly the manifest's sets, in order", () => {
    expect(orderedMigrationSets(ALL_MODULES)).toEqual(manifestSets());
  });
  it("lists nine modules with the manifest's names in order", () => {
    expect(ALL_MODULES.map((m) => m.name)).toEqual(manifestSets().map((s) => s.name));
  });
});

describe("ALL_MODULES backup contribution", () => {
  it("core declares the media store as non-DB backup state", () => {
    const core = ALL_MODULES.find((m) => m.name === "core");
    expect(core?.backup?.nonDbState).toEqual([{ kind: "content-addressed-dir", source: "media" }]);
  });
  it("a module may omit backup (open contribution set)", () => {
    const sync = ALL_MODULES.find((m) => m.name === "sync");
    expect(sync?.backup).toBeUndefined();
  });
});

describe("MODULE_BY_TABLE", () => {
  it("maps every enrolled table to its owning module", () => {
    expect(MODULE_BY_TABLE.get("sales")).toBe("core");
    expect(MODULE_BY_TABLE.get("ticket_items")).toBe("core");
    expect(MODULE_BY_TABLE.get("persons")).toBe("identity");
    expect(MODULE_BY_TABLE.get("webauthn_credentials")).toBe("identity");
    expect(MODULE_BY_TABLE.get("payments")).toBe("payments");
    expect(MODULE_BY_TABLE.get("payment_policy")).toBe("payments");
  });
  it("covers exactly the assembled enrolment's tables", () => {
    expect([...MODULE_BY_TABLE.keys()].sort()).toEqual(
      ALL_SYNC_ENROLMENTS.map((e) => e.table).sort(),
    );
    expect(MODULE_BY_TABLE.size).toBe(ALL_SYNC_ENROLMENTS.length); // 28, no duplicate table
  });
});
