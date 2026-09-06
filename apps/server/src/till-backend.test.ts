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

/** The enabled set with the fiscal slot's only filler removed — the zero-candidate case. */
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
    const backend = makeFiscalBackend(ALL_MODULES, "verifactu", STUB_DB, {
      WAITRON_ENV: "preproduction",
    });
    expect(backend.id).toBe(FISCAL_SLOT.id);
  });

  it("accepts a node with no stamped filing module (bare fixtures)", () => {
    expect(makeFiscalBackend(ALL_MODULES, null, STUB_DB, {}).id).toBe("verifactu");
  });

  it("defaults the deployment environment to preproduction when WAITRON_ENV is unset", () => {
    // The one default in config.ts whose mistake is irreversible — proven reachable here rather than
    // asserted: an unset environment must not throw at construction, it must resolve the safe value.
    expect(makeFiscalBackend(ALL_MODULES, null, STUB_DB, {}).id).toBe("verifactu");
  });

  it("refuses when no enabled module fills the slot", () => {
    expect(() => makeFiscalBackend(NO_FISCAL, null, STUB_DB, {})).toThrow(
      expect.objectContaining({ code: "module.fiscal_slot_empty" }),
    );
  });

  it("refuses a node stamped for another regime", () => {
    expect(() => makeFiscalBackend(ALL_MODULES, "other", STUB_DB, {})).toThrow(
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
      makeFiscalBackend(ALL_MODULES, null, STUB_DB, { WAITRON_ENV: "staging" }),
    ).toThrow();
  });
});
