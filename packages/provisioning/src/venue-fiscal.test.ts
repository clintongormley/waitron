import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { FiscalBackend, FiscalContribution } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { venueFiscalSelection } from "./venue-fiscal.js";

/** A minimal fiscal contribution for a given slot id — only its `id` matters to the selection. */
function contribution(id: string): FiscalContribution {
  return {
    id,
    activationReadiness: "not-applicable",
    makeBackend: () => ({ id }) as unknown as FiscalBackend,
    drain: async () => ({
      nextDueAt: null,
      tenantsWithWork: 0,
      batchesSent: 0,
      recordsSubmitted: 0,
      recordsAccepted: 0,
      recordsHalted: 0,
      incidentsRaised: 0,
      skipped: [],
    }),
  };
}

/** The real ALL_MODULES shape: a non-fiscal member plus BOTH fiscal-slot members. */
const MODULES: readonly WaitronModule[] = [
  fakeModule("core"),
  fakeModule("fiscal-verifactu", { fiscal: contribution("verifactu") }),
  fakeModule("fiscal-none", { fiscal: contribution("none") }),
];

describe("venueFiscalSelection", () => {
  it("ES-common enables verifactu, disables the other slot member, and returns its contribution", () => {
    const { config, contribution: resolved } = venueFiscalSelection(MODULES, "ES-common");
    expect(config.overrides.get("fiscal-verifactu")).toBe(true);
    expect(config.overrides.get("fiscal-none")).toBe(false);
    expect(config.overrides.has("core")).toBe(false);
    expect(resolved?.id).toBe("verifactu");
  });

  it("GB-vat enables none, disables verifactu, and returns the none contribution", () => {
    const { config, contribution: resolved } = venueFiscalSelection(MODULES, "GB-vat");
    expect(config.overrides.get("fiscal-none")).toBe(true);
    expect(config.overrides.get("fiscal-verifactu")).toBe(false);
    expect(resolved?.id).toBe("none");
  });

  it("carries non-fiscal base overrides through untouched", () => {
    const base = { overrides: new Map([["probe", false]]) };
    const { config } = venueFiscalSelection(MODULES, "ES-common", base);
    expect(config.overrides.get("probe")).toBe(false);
    expect(config.overrides.get("fiscal-verifactu")).toBe(true);
  });

  it("returns no contribution when no slot member declares the territory's filing id", () => {
    const noSlotMembers: readonly WaitronModule[] = [fakeModule("core")];
    const { config, contribution: resolved } = venueFiscalSelection(noSlotMembers, "ES-common");
    expect(resolved).toBeUndefined();
    // Empty slot — every fiscal member (there are none here) would be `false`; the caller's
    // `fiscalSlot` refuses it downstream.
    expect(config.overrides.size).toBe(0);
  });

  it("throws fiscal.regime_not_implemented for an unimplemented territory, before building either half", () => {
    expect(() => venueFiscalSelection(MODULES, "FR-tva")).toThrow(AppError);
    expect(() => venueFiscalSelection(MODULES, "FR-tva")).toThrow(/regime_not_implemented/);
  });
});
