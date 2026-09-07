import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { DASHBOARD_MODULES } from "./index.js";

// The honesty pin (spec §10, forward-only): every registry entry names a REAL server module and is
// unique. The reverse — a UI-bearing module silently MISSING from the registry — is NOT mechanically
// checkable: by design §3.3 the server descriptor carries no dashboard seat, so "UI-bearing" is not a
// queryable property of ALL_MODULES. This is the feasible guard; the gap is recorded, not faked.
describe("DASHBOARD_MODULES honesty", () => {
  it("every contribution names a real module in ALL_MODULES, and is unique", () => {
    const names = new Set(ALL_MODULES.map((m) => m.name));
    const ids = DASHBOARD_MODULES.map((c) => c.module);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(names.has(id)).toBe(true);
  });

  it("registers the bookings contribution (not vacuous)", () => {
    expect(DASHBOARD_MODULES.map((c) => c.module)).toContain("bookings");
  });
});
