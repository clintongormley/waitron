import { describe, expect, it } from "vitest";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import { fiscalSlot, selectFiscalModule } from "./fiscal-slot.js";
import { enabledModules, parseModuleConfig } from "./config.js";
import { fakeModule } from "./testing/fake-module.js";

const contribution = (id: string): FiscalContribution => ({
  id,
  activationReadiness: "not-applicable",
  makeBackend: () => ({ id }) as unknown as FiscalBackend,
  // These tests exercise slot SELECTION only; the runtime submission seat is never invoked here.
  drain: () => Promise.reject(new Error("fiscal-slot selection tests never run the drain seat")),
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

describe("selectFiscalModule", () => {
  const MODULES = [CORE, A, B];
  const empty = parseModuleConfig({}, MODULES);

  it("enables the matching slot member and disables every other one", () => {
    const config = selectFiscalModule(MODULES, "a", empty);
    expect(config.overrides.get("a")).toBe(true);
    expect(config.overrides.get("b")).toBe(false);
    // The resolved slot is exactly the selected member — no ambiguity for the boot-time check.
    expect(fiscalSlot(enabledModules(MODULES, config), null)).toBe(A.fiscal);
  });

  it("overrides an operator base that had disabled the selected member (territory is authoritative)", () => {
    const base = parseModuleConfig({ modules: { a: false, b: true, core: true } }, MODULES);
    const config = selectFiscalModule(MODULES, "a", base);
    expect(config.overrides.get("a")).toBe(true);
    expect(config.overrides.get("b")).toBe(false);
    // A non-fiscal override in the base is carried through untouched.
    expect(config.overrides.get("core")).toBe(true);
  });

  it("leaves the slot empty for a filing id no member declares — fiscalSlot then refuses it", () => {
    const config = selectFiscalModule(MODULES, "no-such-regime", empty);
    expect(config.overrides.get("a")).toBe(false);
    expect(config.overrides.get("b")).toBe(false);
    expect(() => fiscalSlot(enabledModules(MODULES, config), null)).toThrow(
      expect.objectContaining({ code: "module.fiscal_slot_empty" }),
    );
  });
});
