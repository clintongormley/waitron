import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      ["DEFAULTS", "SCHEDULER_MIGRATIONS", "runDue", "scheduledRuns"].sort(),
    );
  });

  // The store is deliberately NOT public: a host claims and completes runs through runDue, never
  // by hand. Exposing the claim statements would make it possible to run a duty without recording
  // it, which is the one thing this ledger exists to prevent.
  it("does not export the ledger store", () => {
    expect(Object.keys(api)).not.toContain("claimGap");
    expect(Object.keys(api)).not.toContain("completeRun");
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import never
 * runs it, which is why scheduled-runs.ts's FK/index/check block shows as uncovered even though
 * every other test in this package imports the table. Calling `getTableConfig` forces the callback
 * to run, and the assertions below are the meaningful check that scheduled_runs' constraints
 * actually exist under the names the runner's claim-by-INSERT and the migration
 * depend on — not a coverage stunt. Mirrors packages/payments/src/index.test.ts, and reached here
 * through the package root, which is the surface a host actually gets.
 */
describe("scheduled_runs constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares scheduled_runs' unique index, foreign key and check constraints", () => {
    const config = getTableConfig(api.scheduledRuns);

    // `scheduled_runs_key` is a `uniqueIndex(...)`, not a `unique(...)` table constraint — it
    // shows up in `config.indexes` (with `unique: true`), not in `config.uniqueConstraints`.
    const key = config.indexes.find((i) => i.config.name === "scheduled_runs_key");
    expect(key?.config.unique).toBe(true);

    // And it is the ONLY index on this table: derivation reads by the unique key's own leading
    // columns and filters `next_attempt_at` in JavaScript, every claim keys on `id`, so a second
    // index would be read by nothing while costing every INSERT and claim UPDATE its maintenance.
    expect(config.indexes.map((i) => i.config.name)).toEqual(["scheduled_runs_key"]);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("scheduled_runs_tenant_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("scheduled_runs_state_ck");
    expect(checkNames).toContain("scheduled_runs_period_ck");
    expect(checkNames).toContain("scheduled_runs_generation_ck");
    expect(checkNames).toContain("scheduled_runs_attempts_ck");
  });
});
