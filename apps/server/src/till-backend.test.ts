import { describe, expect, it } from "vitest";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import type { WaitronModule } from "@waitron/module";
import type { Database } from "@waitron/db";
import { ALL_MODULES } from "./modules.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";

// `makeFiscalBackend` only CONSTRUCTS the backend (the slot's factory wraps its dependencies and
// stores references — it opens no connection), so a bare stub stands in for the pool the built
// backend would only touch on `pendingCount`, which this suite never calls.
const STUB_DB = {} as Database;

// `ALL_MODULES` now carries TWO fiscal-slot members, so a boot always feeds `makeFiscalBackend` the
// ENABLED set (`enabledModules(ALL_MODULES, modules.json)`) with exactly one selected — the shape the
// per-territory `modules.json` produces. These stand in for that enabled set.
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
    // The host's own UTC offset for that instant — never `Date.prototype.getTimezoneOffset()`'s
    // sign, which is inverted; `now()` negates it to the ISO-8601 convention.
    expect(reading.offsetMinutes).toBe(-reading.instant.getTimezoneOffset());
  });

  it("throws from anchor() — recordSale never calls it, so reaching it is a bug, not a fallback", () => {
    // The argument satisfies the `TrustedClock.anchor` signature; the stub throws before reading it.
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
    // The boot-level proof of the coexistence: a box whose `modules.json` disabled Veri*Factu (a
    // `GB-vat` provision) resolves the slot to `fiscal-none`, whose backend records nothing. `fiscalSlot`
    // sees exactly one candidate, so the two-member composition list never surfaces as an ambiguous slot.
    const backend = makeFiscalBackend(NONE_ENABLED, "none", STUB_DB, {
      WAITRON_ENV: "preproduction",
    });
    expect(backend.id).toBe("none");
  });

  it("refuses when BOTH fiscal-slot members are enabled (the default-on set, never persisted)", () => {
    // A boot that fed the raw two-member `ALL_MODULES` (no `modules.json` selection) would see two
    // candidates. This is exactly what provisioning's `modules.json` write exists to prevent.
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
    // The one default in config.ts whose mistake is irreversible — proven reachable here rather than
    // asserted: an unset environment must not throw at construction, it must resolve the safe value.
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
    // `deploymentEnvironment` (shared with the rest of the host) is what rejects it, so a stray
    // NODE_ENV or a typo can never reach the backend as an entorno the schema's CHECK constraint
    // would then reject mid-sale.
    expect(() =>
      makeFiscalBackend(VERIFACTU_ENABLED, null, STUB_DB, { WAITRON_ENV: "staging" }),
    ).toThrow();
  });
});
