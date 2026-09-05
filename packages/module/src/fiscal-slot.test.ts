import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import { fiscalSlot } from "./fiscal-slot.js";
import type { WaitronModule } from "./module.js";

const contribution = (id: string): FiscalContribution => ({
  id,
  makeBackend: () => ({ id }) as unknown as FiscalBackend,
});

function module(name: string, fiscal?: FiscalContribution): WaitronModule {
  return {
    name,
    version: "0.0.0",
    tier: "toggleable",
    migrations: { name, table: `__drizzle_migrations_${name}`, from: `../${name}/drizzle` },
    ...(fiscal === undefined ? {} : { fiscal }),
  };
}

const CORE = module("core");
const A = module("a", contribution("a"));
const B = module("b", contribution("b"));

describe("fiscalSlot", () => {
  it("selects the one module declaring a fiscal contribution", () => {
    expect(fiscalSlot([CORE, A], null)).toBe(A.fiscal);
  });

  it("accepts a stamped filing module that matches the selected id", () => {
    expect(fiscalSlot([CORE, A], "a")).toBe(A.fiscal);
  });

  it("throws module.fiscal_slot_empty when no module contributes", () => {
    const err = (() => {
      try {
        fiscalSlot([CORE], null);
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(isAppError(err) && err.code).toBe("module.fiscal_slot_empty");
  });

  it("throws module.fiscal_slot_ambiguous naming both candidates when two contribute", () => {
    expect(() => fiscalSlot([A, B], null)).toThrow(
      expect.objectContaining({
        code: "module.fiscal_slot_ambiguous",
        params: { candidates: ["a", "b"] },
      }),
    );
  });

  it("throws module.fiscal_slot_mismatch when the node was stamped for another regime", () => {
    expect(() => fiscalSlot([CORE, A], "b")).toThrow(
      expect.objectContaining({
        code: "module.fiscal_slot_mismatch",
        params: { stamped: "b", enabled: "a" },
      }),
    );
  });
});
