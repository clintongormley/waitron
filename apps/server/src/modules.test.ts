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
