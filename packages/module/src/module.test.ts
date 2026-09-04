import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { orderedMigrationSets, type WaitronModule } from "./index.js";

const mod = (name: string, requires?: WaitronModule["requires"]): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "toggleable",
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
  ...(requires ? { requires } : {}),
});

/** The AppError code `fn` throws, or `false` if it did not throw one. */
function thrownCode(fn: () => unknown): string | false {
  try {
    fn();
    return false;
  } catch (error) {
    return isAppError(error) ? error.code : false;
  }
}

describe("orderedMigrationSets", () => {
  it("maps dependency-free modules in list order (no edges → input order preserved)", () => {
    const mods = [mod("core"), mod("fiscal"), mod("sync")];
    expect(orderedMigrationSets(mods)).toEqual(mods.map((m) => m.migrations));
  });

  it("is empty for no modules", () => {
    expect(orderedMigrationSets([])).toEqual([]);
  });

  it("reorders a wrong input into dependency order, input order as tie-break", () => {
    // workforce placed BEFORE identity in the input; the sort must move identity ahead of it, and
    // core (required by both) ahead of all — while leaving unrelated modules in input order.
    const mods = [
      mod("workforce", { core: "*", modules: { identity: "*" } }),
      mod("core"),
      mod("payments", { core: "*" }),
      mod("identity", { core: "*" }),
    ];
    expect(orderedMigrationSets(mods).map((s) => s.name)).toEqual([
      "core",
      "payments",
      "identity",
      "workforce",
    ]);
  });

  it("throws module.dependency_missing when a required module is absent from the set", () => {
    const mods = [mod("core"), mod("workforce", { core: "*", modules: { identity: "*" } })];
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.dependency_missing");
  });

  it("throws module.dependency_cycle on a cyclic graph", () => {
    const mods = [mod("a", { modules: { b: "*" } }), mod("b", { modules: { a: "*" } })];
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.dependency_cycle");
  });

  it("throws module.incompatible_version when a present dependency's version is out of range", () => {
    const mods = [mod("core"), mod("workforce", { core: ">=1.0.0" })]; // core is 0.0.0
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.incompatible_version");
  });

  it("accepts a dependency whose version satisfies the range (positive control)", () => {
    const mods = [mod("core"), mod("workforce", { core: ">=0.0.0" })];
    expect(orderedMigrationSets(mods).map((s) => s.name)).toEqual(["core", "workforce"]);
  });

  it("throws module.requires_invalid on a malformed range string", () => {
    const mods = [mod("core"), mod("workforce", { core: "not-a-range" })];
    expect(thrownCode(() => orderedMigrationSets(mods))).toBe("module.requires_invalid");
  });
});
