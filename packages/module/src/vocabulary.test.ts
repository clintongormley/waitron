import { describe, expect, it } from "vitest";
import { forbiddenVocabulary, vocabularyOwners } from "./vocabulary.js";
import type { WaitronModule } from "./module.js";

const mod = (name: string, vocabulary?: readonly string[]): WaitronModule => ({
  name,
  version: "0.0.0",
  tier: "toggleable",
  migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}-impl/drizzle` },
  ...(vocabulary ? { vocabulary } : {}),
});

describe("vocabularyOwners", () => {
  it("skips a module with no declaration and derives the package dir for one with", () => {
    expect(vocabularyOwners([mod("core"), mod("regime", ["alpha", "beta"])])).toEqual([
      { module: "regime", packageDir: "regime-impl", terms: ["alpha", "beta"] },
    ]);
  });

  it("returns an empty declaration as an owner with no terms, rejectable by name", () => {
    expect(vocabularyOwners([mod("regime", [])])).toEqual([
      { module: "regime", packageDir: "regime-impl", terms: [] },
    ]);
  });

  it("refuses a declaring module whose migrations.from is not ../<pkg>/drizzle", () => {
    const bad = {
      ...mod("regime", ["alpha"]),
      migrations: { ...mod("regime").migrations, from: "./x" },
    };
    expect(() => vocabularyOwners([bad])).toThrow(/regime.*\.\.\/<pkg>\/drizzle/);
  });
});

describe("forbiddenVocabulary", () => {
  it("unions the base list with every declaration, without mutating the base", () => {
    const base = new Set(["gamma"]);
    const all = forbiddenVocabulary(base, [mod("core"), mod("regime", ["alpha", "beta"])]);
    expect([...all].sort()).toEqual(["alpha", "beta", "gamma"]);
    expect([...base]).toEqual(["gamma"]);
  });
});
