import { describe, expect, it } from "vitest";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import type { WaitronModule } from "@waitron/module";
import type { Database } from "@waitron/db";
import { ALL_MODULES } from "./modules.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";

// `makeFiscalBackend` only constructs the backend, so a bare stub stands in for the database.
const STUB_DB = {} as Database;

// `ALL_MODULES` carries two fiscal-slot members; a boot feeds `makeFiscalBackend` the enabled set,
// with exactly one selected by `modules.json`.
/** A Spanish box's enabled set: `fiscal-none` disabled, Veri*Factu fills the slot. */
const VERIFACTU_ENABLED: readonly WaitronModule[] = ALL_MODULES.filter(
  (m) => m.name !== "fiscal-none",
);
/** A GB (no-regime) box's enabled set: `fiscal-verifactu` disabled, `fiscal-none` fills the slot. */
const NONE_ENABLED: readonly WaitronModule[] = ALL_MODULES.filter(
  (m) => m.name !== "fiscal-verifactu",
);
/** The enabled set with every fiscal-slot filler removed — the zero-candidate case. */
const NO_FISCAL: readonly WaitronModule[] = ALL_MODULES.filter((m) => m.fiscal === undefined);

describe("systemClock", () => {
  it("reports the wall clock as already confident and anchored, with a real instant", () => {
    const reading = systemClock().now();
    expect(reading.instant).toBeInstanceOf(Date);
    expect(reading.confident).toBe(true);
    expect(reading.confidence).toBe("anchored");
    expect(reading.anchorAgeSeconds).toBe(0);
    expect(reading.offsetMinutes).toBe(-reading.instant.getTimezoneOffset());
  });

  it("throws from anchor() — recordSale never calls it, so reaching it is a bug, not a fallback", () => {
    expect(() =>
      systemClock().anchor({ instant: new Date(), offsetMinutes: 0, source: "upstream" }),
    ).toThrow();
  });

  it("has no prior anchor to restore (currentAnchor is null)", () => {
    expect(systemClock().currentAnchor()).toBeNull();
  });
});

describe("makeFiscalBackend", () => {
  it("builds the enabled slot's backend without touching the database", () => {
    const backend = makeFiscalBackend(VERIFACTU_ENABLED, "verifactu", STUB_DB, {
      WAITRON_ENV: "preproduction",
    });
    expect(backend.id).toBe(FISCAL_SLOT.id);
  });

  it("a GB (no-regime) box boots with fiscal-none filling the slot — no fiscal_slot_ambiguous", () => {
    const backend = makeFiscalBackend(NONE_ENABLED, "none", STUB_DB, {
      WAITRON_ENV: "preproduction",
    });
    expect(backend.id).toBe("none");
  });

  it("refuses when BOTH fiscal-slot members are enabled (the default-on set, never persisted)", () => {
    // Provisioning's `modules.json` write exists to prevent this.
    expect(() => makeFiscalBackend(ALL_MODULES, null, STUB_DB, {})).toThrow(
      expect.objectContaining({
        code: "module.fiscal_slot_ambiguous",
        params: { candidates: ["fiscal-verifactu", "fiscal-none"] },
      }),
    );
  });

  it("accepts a node with no stamped filing module (bare fixtures)", () => {
    expect(makeFiscalBackend(VERIFACTU_ENABLED, null, STUB_DB, {}).id).toBe("verifactu");
  });

  it("defaults the deployment environment to preproduction when WAITRON_ENV is unset", () => {
    expect(makeFiscalBackend(VERIFACTU_ENABLED, null, STUB_DB, {}).id).toBe("verifactu");
  });

  it("refuses when no enabled module fills the slot", () => {
    expect(() => makeFiscalBackend(NO_FISCAL, null, STUB_DB, {})).toThrow(
      expect.objectContaining({ code: "module.fiscal_slot_empty" }),
    );
  });

  it("refuses a node stamped for another regime", () => {
    expect(() => makeFiscalBackend(VERIFACTU_ENABLED, "other", STUB_DB, {})).toThrow(
      expect.objectContaining({
        code: "module.fiscal_slot_mismatch",
        params: { stamped: "other", enabled: "verifactu" },
      }),
    );
  });

  it("refuses an unrepresentable WAITRON_ENV, the same guard loadConfig uses", () => {
    // Refused at construction rather than by `registros_entorno_ck` mid-sale.
    expect(() =>
      makeFiscalBackend(VERIFACTU_ENABLED, null, STUB_DB, { WAITRON_ENV: "staging" }),
    ).toThrow();
  });
});
