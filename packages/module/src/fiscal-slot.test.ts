import { describe, expect, it } from "vitest";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import { fiscalSlot } from "./fiscal-slot.js";
import { fakeModule } from "./testing/fake-module.js";

const contribution = (id: string): FiscalContribution => ({
  id,
  makeBackend: () => ({ id }) as unknown as FiscalBackend,
});

const CORE = fakeModule("core");
const A = fakeModule("a", { fiscal: contribution("a") });
const B = fakeModule("b", { fiscal: contribution("b") });

describe("fiscalSlot", () => {
  it("selects the one module declaring a fiscal contribution", () => {
    expect(fiscalSlot([CORE, A], null)).toBe(A.fiscal);
  });

  it("accepts a stamped filing module that matches the selected id", () => {
    expect(fiscalSlot([CORE, A], "a")).toBe(A.fiscal);
  });

  it("throws module.fiscal_slot_empty when no module contributes", () => {
    expect(() => fiscalSlot([CORE], null)).toThrow(
      expect.objectContaining({ code: "module.fiscal_slot_empty" }),
    );
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
