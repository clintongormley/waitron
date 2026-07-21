import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { describeEachTarget, dockerAvailable, resolveTargets } from "./harness.js";

describe("dockerAvailable", () => {
  it("memoizes: a second call returns the same result without spawning docker again", () => {
    // Vitest isolates each test file's module graph, so within this file
    // dockerAvailable's module-level cache starts empty regardless of any
    // other file (describeEachTarget above already primed it once via its
    // own call) — calling it again here is what exercises the cache-hit
    // branch at all, rather than only ever the first-call miss.
    const first = dockerAvailable();
    const second = dockerAvailable();
    expect(second).toBe(first);
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
    // quietly halve the suite.
    expect(() => resolveTargets({ dockerAvailable: false, requireDocker: true })).toThrow(
      /REQUIRE_DOCKER/,
    );
  });

  it("skips postgres locally but warns unmissably", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const targets = resolveTargets({ dockerAvailable: false, requireDocker: false });
    expect(targets.map((t) => t.name)).toEqual(["pglite"]);
    expect(warn).toHaveBeenCalledOnce();
    // Asserting on the content, not just that something was logged: a warning
    // that does not say which properties went uncovered is a warning people
    // read past.
    expect(warn.mock.calls[0][0]).toMatch(/lock contention|FOR UPDATE/i);
    warn.mockRestore();
  });
});
