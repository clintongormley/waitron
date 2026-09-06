import { describe, expect, it } from "vitest";
import { FISCAL_PROVISIONING, FISCAL_SLOT, FISCAL_VOCABULARY } from "@waitron/fiscal-verifactu";
import { manifestSets } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { WORKFORCE_ES_VOCABULARY } from "@waitron/workforce-es";
import { ALL_MODULES } from "./modules.js";

describe("ALL_MODULES is the migration source of truth", () => {
  it("derives exactly the manifest's sets, in order", () => {
    expect(orderedMigrationSets(ALL_MODULES)).toEqual(manifestSets());
  });
  it("lists the manifest's module names in order", () => {
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

describe("ALL_MODULES vocabulary seat", () => {
  it("fiscal declares the fiscal module's own vocabulary, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal");
    expect(fiscal?.vocabulary).toBe(FISCAL_VOCABULARY);
  });
  it("workforce-es declares the Spain labour module's own vocabulary, by reference", () => {
    const wfes = ALL_MODULES.find((m) => m.name === "workforce-es");
    expect(wfes?.vocabulary).toBe(WORKFORCE_ES_VOCABULARY);
  });
});

describe("ALL_MODULES provisioning and fiscal seats", () => {
  it("fiscal declares its provisioning contribution and fills the fiscal slot, by reference", () => {
    const fiscal = ALL_MODULES.find((m) => m.name === "fiscal");
    expect(fiscal?.provisioning).toBe(FISCAL_PROVISIONING);
    expect(fiscal?.fiscal).toBe(FISCAL_SLOT);
  });
  it("exactly one module fills the fiscal slot", () => {
    expect(ALL_MODULES.filter((m) => m.fiscal !== undefined).map((m) => m.name)).toEqual([
      "fiscal",
    ]);
  });
});
