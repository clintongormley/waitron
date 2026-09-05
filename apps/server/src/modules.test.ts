import { describe, expect, it } from "vitest";
import { manifestSets } from "@waitron/migrations";
import { orderedMigrationSets } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";

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
