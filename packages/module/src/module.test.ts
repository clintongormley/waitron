import { describe, expect, it } from "vitest";
import { orderedMigrationSets, type WaitronModule } from "./index.js";

const mod = (name: string): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "toggleable",
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
});

describe("orderedMigrationSets", () => {
  it("returns each module's migration set, in list order", () => {
    const mods = [mod("core"), mod("fiscal"), mod("sync")];
    expect(orderedMigrationSets(mods)).toEqual(mods.map((m) => m.migrations));
  });
  it("is empty for no modules", () => {
    expect(orderedMigrationSets([])).toEqual([]);
  });
});
