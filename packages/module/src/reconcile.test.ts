import { describe, expect, it } from "vitest";
import { reconcile } from "./index.js";

describe("reconcile", () => {
  it("classifies each module into exactly one of toMigrate / steady / softDisabled", () => {
    // enabled: core (already migrated), payments (not yet migrated)
    // migrated: core, scheduler (scheduler is migrated but no longer enabled → soft-disabled)
    const r = reconcile(["core", "payments"], new Set(["core", "scheduler"]));
    expect(r.toMigrate).toEqual(["payments"]);
    expect(r.steady).toEqual(["core"]);
    expect(r.softDisabled).toEqual(["scheduler"]);
  });
  it("empty when nothing is enabled or migrated", () => {
    const r = reconcile([], new Set());
    expect(r).toEqual({ toMigrate: [], steady: [], softDisabled: [] });
  });
});
