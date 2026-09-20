// Real PostgreSQL: tests both target factories, including creation of a real PostgreSQL database.
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { describeEachTarget, dockerAvailable, resolveTargets } from "./harness.js";

describe("dockerAvailable", () => {
  it("recognizes the container supplied by this package's global setup", () => {
    expect(dockerAvailable()).toBe(true);
  });
});

// A smoke test that actually calls target.create() for both targets. Without
// this, describeEachTarget/pgliteTarget/postgresTarget/migrated were written
// but never executed by any test in this package — CORE_MIGRATIONS pointed
// at packages/db/drizzle, which did not exist until this commit created it,
// so both targets' create() threw `Can't find meta/_journal.json file`. A
// broken harness that never runs is worse than an absent one: every later
// package would find this defect via its own tests instead of here.
describeEachTarget("Target.create()", (target) => {
  it("returns a working, migrated database", async () => {
    const db = await target.create();
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
    await db.close();
  });
});

describe("resolveTargets", () => {
  it("covers both targets when Docker is available", () => {
    const targets = resolveTargets({ dockerAvailable: true, requireDocker: false });
    expect(targets.map((t) => t.name)).toEqual(["pglite", "postgres"]);
  });

  it("throws rather than skipping when Docker is required", () => {
    // CI sets REQUIRE_DOCKER=1. A missing daemon there must fail the job, not
    // quietly halve the suite. The whole sentence is pinned, not the flag's
    // name alone: the half that says WHY — lock contention goes unchecked —
    // is the half a reader needs and the half a careless edit drops.
    expect(() => resolveTargets({ dockerAvailable: false, requireDocker: true })).toThrow(
      "REQUIRE_DOCKER is set but Docker is not available. The real-Postgres target is required " +
        "for lock contention; skipping it would leave concurrency unchecked.",
    );
  });

  it("skips postgres locally but warns unmissably", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const targets = resolveTargets({ dockerAvailable: false, requireDocker: false });
    expect(targets.map((t) => t.name)).toEqual(["pglite"]);
    expect(warn).toHaveBeenCalledOnce();
    // The whole banner, line for line. Matching a phrase or two instead leaves
    // most of it free to be emptied: the rules of the banner are that it is
    // impossible to read past (the two rows of exclamation marks and the blank
    // line around them) and that it says what the run no longer proves.
    const bar = "!".repeat(78);
    expect(warn.mock.calls[0][0]).toBe(
      "\n" +
        bar +
        "\n! DOCKER NOT AVAILABLE — the real-Postgres target is SKIPPED.\n" +
        "! Lock contention is NOT covered by this run.\n" +
        "! PGlite serialises onto one backend, so FOR UPDATE never blocks there.\n" +
        "! This run cannot be used as evidence for database concurrency.\n" +
        bar +
        "\n",
    );
    warn.mockRestore();
  });
});
