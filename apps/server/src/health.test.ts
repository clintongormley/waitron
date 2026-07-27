import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_TICK_MS } from "./config.js";
import { DRAIN_DUTY, RECONCILE_DUTY, type DutyReport, type PassReport } from "./pass.js";
import type { Logger } from "./logger.js";
import {
  createHealthState,
  healthApp,
  healthSnapshot,
  logDegradedDuties,
  recordPass,
  DUTY_BUDGET_MS,
} from "./health.js";

/** A duty name nobody has declared a budget for — stands in for "someone added duty #3 to pass.ts
 * and forgot health.ts." */
const UNBUDGETED_DUTY = "made.up.duty";

const BOOT = new Date("2026-07-26T08:00:00Z");
const AT = new Date("2026-07-26T08:00:05Z");
/** Alias for `AT` used by the `recordPass`/`logDegradedDuties` tests below, matching the name those
 * tests are written against — same value, so it composes with the rest of the file's fixtures
 * rather than introducing a second point in time. */
const NOW = AT;

/** One `DutyReport` entry, defaulted to a clean pass so a caller only names what it overrides —
 * e.g. `duty(DRAIN_DUTY, { skipped: 1 })`. */
function duty(name: string, overrides: Partial<DutyReport> = {}): DutyReport {
  return { duty: name, ok: true, nextDueAt: null, durationMs: 0, ...overrides };
}

/** Builds a `PassReport`. Called with an array of `duty(...)` entries for a report naming exactly
 * the duties a test cares about, or with the original `(drainOk, reconcileOk)` booleans for the
 * two-duty default most existing tests below still use — one builder, not two parallel ones. */
function report(entries: DutyReport[]): PassReport;
function report(drainOk: boolean, reconcileOk?: boolean): PassReport;
function report(drainOkOrEntries: boolean | DutyReport[], reconcileOk = true): PassReport {
  if (Array.isArray(drainOkOrEntries)) {
    return { duties: drainOkOrEntries, nextDueAt: null };
  }
  const drainOk = drainOkOrEntries;
  return {
    duties: [
      {
        duty: DRAIN_DUTY,
        ok: drainOk,
        nextDueAt: null,
        durationMs: 0,
        ...(drainOk ? {} : { errorCode: "x" }),
      },
      { duty: RECONCILE_DUTY, ok: reconcileOk, nextDueAt: null, durationMs: 0 },
    ],
    nextDueAt: null,
  };
}

/** A `Logger` that appends `"<level> <event> <fields json>"` to `lines` instead of writing
 * anywhere real, so `logDegradedDuties`'s tests can assert on level and content without a sink. */
function collect(lines: string[]): Logger {
  return (level, event, fields) => {
    lines.push(`${level} ${event} ${JSON.stringify(fields ?? {})}`);
  };
}

describe("health state", () => {
  it("starts unhealthy, because a host that has never passed has never submitted", () => {
    const state = createHealthState(BOOT);
    const snap = healthSnapshot(state, AT);
    expect(snap.ok).toBe(false);
    expect(snap.body).toMatchObject({ ok: false, lastPassAt: null });
  });

  it("is unhealthy on a null lastPassAt alone, even when every duty is fresh", () => {
    // Isolates the `lastPassAt` clause from per-duty staleness, which the boot test above cannot:
    // at boot every duty is ALSO stale (never-succeeded), so either mechanism alone would already
    // fail that test. `recordPass` always sets `lastPassAt` in the same call that freshens the
    // duties, so there is no way to reach "duties fresh, lastPassAt null" through the public API —
    // reaching it means writing the field directly, which pins the guard as real rather than dead.
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    state.lastPassAt = null;
    const snap = healthSnapshot(state, AT);
    expect(snap.body).toMatchObject({
      duties: {
        [DRAIN_DUTY]: { stale: false },
        [RECONCILE_DUTY]: { stale: false },
      },
    });
    expect(snap.ok).toBe(false);
  });

  it("is healthy after a clean pass", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    expect(healthSnapshot(state, AT).ok).toBe(true);
  });

  it("counts consecutive failures and resets them on success", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(false), AT);
    recordPass(state, report(false), AT);
    expect(state.duties[DRAIN_DUTY]?.consecutiveFailures).toBe(2);
    recordPass(state, report(true), AT);
    expect(state.duties[DRAIN_DUTY]?.consecutiveFailures).toBe(0);
    expect(state.duties[DRAIN_DUTY]?.lastOkAt).toEqual(AT);
  });

  it("goes 503 when drain's last success is older than its budget", () => {
    // Drain's budget IS the legal cadence, plus I1's deliberate slack over the sleep ceiling — see
    // DUTY_BUDGET_MS's own comment in health.ts. Up-but-stale is the failure mode this endpoint
    // exists to make visible, and it looks identical to healthy in a log. Read from DUTY_BUDGET_MS
    // rather than a hardcoded hour: hardcoding it here would silently stop testing the real boundary
    // the moment health.ts's own constant changed, which is exactly how I1 happened in the first
    // place (two independently-chosen literals that agreed by coincidence, not construction).
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    const budget = DUTY_BUDGET_MS[DRAIN_DUTY];
    expect(healthSnapshot(state, new Date(AT.getTime() + budget - 60_000)).ok).toBe(true);
    expect(healthSnapshot(state, new Date(AT.getTime() + budget + 60_000)).ok).toBe(false);
  });

  it("gives drain a budget with slack over the default max tick (I1)", () => {
    // An idle host with nothing due anywhere sleeps exactly maxTickMs (loop.ts's sleepMsFor) and the
    // next pass lands right at that ceiling — a budget equal to or below it flips 503 once per cycle
    // BY CONSTRUCTION, on a host doing exactly what it was designed to do. This is the regression
    // this test exists to catch: reverting DUTY_BUDGET_MS[DRAIN_DUTY] back to a bare HOUR_MS (or any
    // value <= DEFAULT_MAX_TICK_MS) fails this assertion even though every other health.test.ts case
    // could still pass.
    expect(DUTY_BUDGET_MS[DRAIN_DUTY]).toBeGreaterThan(DEFAULT_MAX_TICK_MS);
  });

  it("gives reconcile a daily-plus-slack budget, not drain's hourly one", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    const within = new Date(AT.getTime() + 25 * 60 * 60 * 1000);
    const beyond = new Date(AT.getTime() + 27 * 60 * 60 * 1000);
    // Drain is stale at both, so isolate reconcile by reading its own entry.
    expect(healthSnapshot(state, within).body).toMatchObject({
      duties: { [RECONCILE_DUTY]: { stale: false } },
    });
    expect(healthSnapshot(state, beyond).body).toMatchObject({
      duties: { [RECONCILE_DUTY]: { stale: true } },
    });
  });

  it("treats a duty absent from the budget map as stale, not exempt", () => {
    // A duty added to pass.ts without a matching DUTY_BUDGET_MS entry must not go quiet: this is
    // the one surface that exists to be fail-visible, so an undeclared budget reads as loud
    // (permanently stale) rather than as "this host does not pace it."
    const state = createHealthState(BOOT);
    const withExtra: PassReport = {
      duties: [
        ...report(true).duties,
        { duty: UNBUDGETED_DUTY, ok: true, nextDueAt: null, durationMs: 0 },
      ],
      nextDueAt: null,
    };
    recordPass(state, withExtra, AT);
    const snap = healthSnapshot(state, AT);
    expect(snap.ok).toBe(false);
    expect(snap.body).toMatchObject({ duties: { [UNBUDGETED_DUTY]: { stale: true } } });
    // Still stale on a second success, and immediately — no budget means no grace period either.
    recordPass(state, withExtra, AT);
    expect(healthSnapshot(state, AT).body).toMatchObject({
      duties: { [UNBUDGETED_DUTY]: { stale: true } },
    });
  });

  it("serialises dates as ISO strings and nothing else", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    expect(healthSnapshot(state, AT).body).toEqual({
      ok: true,
      startedAt: "2026-07-26T08:00:00.000Z",
      lastPassAt: "2026-07-26T08:00:05.000Z",
      duties: {
        [DRAIN_DUTY]: {
          lastOkAt: "2026-07-26T08:00:05.000Z",
          consecutiveFailures: 0,
          skipped: 0,
          parked: 0,
          stale: false,
        },
        [RECONCILE_DUTY]: {
          lastOkAt: "2026-07-26T08:00:05.000Z",
          consecutiveFailures: 0,
          skipped: 0,
          parked: 0,
          stale: false,
        },
      },
    });
  });

  // C2: `attempt` (pass.ts) only ever sets `ok: false` on a THROW, so a `drain` or `runDue` call
  // that returns normally with tenants in its `skipped` list still reports `ok: true` — a tenant
  // with due fiscal work and no usable certificate is exactly this shape, every pass, forever,
  // until this is read. These are the paths that would go quiet again if `recordPass`'s
  // `duty.skipped === 0` check were reverted.
  describe("a duty that reports ok:true with a non-empty skipped count (C2)", () => {
    it("does not refresh lastOkAt and increments consecutiveFailures for drain", () => {
      const state = createHealthState(BOOT);
      const withSkip: PassReport = {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 1, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 0, durationMs: 0 },
        ],
        nextDueAt: null,
      };
      recordPass(state, withSkip, AT);
      expect(state.duties[DRAIN_DUTY]).toMatchObject({
        lastOkAt: null,
        consecutiveFailures: 1,
        skipped: 1,
      });
      // Reconcile had nothing skipped this pass, so it is unaffected — the failure this test
      // triggers is per-DUTY (drain's own entry), not a global flag that both entries share.
      expect(state.duties[RECONCILE_DUTY]).toMatchObject({ lastOkAt: AT, consecutiveFailures: 0 });
      expect(healthSnapshot(state, AT).ok).toBe(false);
    });

    it("does the identical thing for reconcile — the check is not drain-specific", () => {
      const state = createHealthState(BOOT);
      const withSkip: PassReport = {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 0, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 2, durationMs: 0 },
        ],
        nextDueAt: null,
      };
      recordPass(state, withSkip, AT);
      expect(state.duties[RECONCILE_DUTY]).toMatchObject({
        lastOkAt: null,
        consecutiveFailures: 1,
        skipped: 2,
      });
      expect(state.duties[DRAIN_DUTY]).toMatchObject({ lastOkAt: AT, consecutiveFailures: 0 });
      expect(healthSnapshot(state, AT).ok).toBe(false);
    });

    it("clears once a later pass reports the same duty clean", () => {
      const state = createHealthState(BOOT);
      recordPass(
        state,
        {
          duties: [
            { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 1, durationMs: 0 },
            { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 0, durationMs: 0 },
          ],
          nextDueAt: null,
        },
        AT,
      );
      expect(healthSnapshot(state, AT).ok).toBe(false);
      const later = new Date(AT.getTime() + 60_000);
      recordPass(state, report(true), later);
      expect(state.duties[DRAIN_DUTY]).toMatchObject({ lastOkAt: later, consecutiveFailures: 0 });
      expect(healthSnapshot(state, later).ok).toBe(true);
    });
  });

  // CRITICAL pre-merge finding: the IDENTICAL C2 gap one duty over, on the money path. A parked
  // reconcile run (`RunRecord.outcome === "parked"`, @waitron/scheduler) is terminal — nothing will
  // claim that period again — but `runDue` still returns normally, so without this,
  // `entry.ok: true` alone would refresh `lastOkAt` forever while a settlement audit sits
  // permanently abandoned. These are the tests that would go red if `recordPass`'s
  // `duty.parked === 0` check (or `pass.ts`'s own `DutyReport.parked` field) were reverted.
  describe("a duty that reports ok:true with a non-empty parked count (pre-merge review)", () => {
    it("does not refresh lastOkAt and increments consecutiveFailures for reconcile", () => {
      const state = createHealthState(BOOT);
      const withParked: PassReport = {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 0, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 1, durationMs: 0 },
        ],
        nextDueAt: null,
      };
      recordPass(state, withParked, AT);
      expect(state.duties[RECONCILE_DUTY]).toMatchObject({
        lastOkAt: null,
        consecutiveFailures: 1,
        parked: 1,
      });
      // Drain had nothing parked this pass, so it is unaffected — per-DUTY, not a shared flag.
      expect(state.duties[DRAIN_DUTY]).toMatchObject({ lastOkAt: AT, consecutiveFailures: 0 });
      expect(healthSnapshot(state, AT).ok).toBe(false);
    });

    it("clears once a later pass reports the same duty with nothing parked", () => {
      const state = createHealthState(BOOT);
      recordPass(
        state,
        {
          duties: [
            { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 0, durationMs: 0 },
            {
              duty: RECONCILE_DUTY,
              ok: true,
              nextDueAt: null,
              skipped: 0,
              parked: 2,
              durationMs: 0,
            },
          ],
          nextDueAt: null,
        },
        AT,
      );
      expect(healthSnapshot(state, AT).ok).toBe(false);
      const later = new Date(AT.getTime() + 60_000);
      recordPass(state, report(true), later);
      expect(state.duties[RECONCILE_DUTY]).toMatchObject({
        lastOkAt: later,
        consecutiveFailures: 0,
      });
      expect(healthSnapshot(state, later).ok).toBe(true);
    });

    // The other half of the finding: `failed` must NOT flip health, or an ordinary still-retrying
    // run would produce the same 503 as a genuine, permanent abandonment — the false-alarm noise
    // that would make a real park easy to ignore. `pass.ts`'s own `DutyReport.parked` already
    // excludes `outcome: "failed"` by construction (pinned directly in pass.test.ts); this is the
    // health.ts-side half of that guarantee — a report shaped exactly like what a failed-only pass
    // produces (`parked: 0`, indistinguishable here from a clean sweep) must stay healthy.
    it("does not flip health for a failed-only run (parked stays 0)", () => {
      const state = createHealthState(BOOT);
      const failedOnly: PassReport = {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 0, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 0, durationMs: 0 },
        ],
        nextDueAt: null,
      };
      recordPass(state, failedOnly, AT);
      recordPass(state, failedOnly, new Date(AT.getTime() + 60_000));
      expect(state.duties[RECONCILE_DUTY]?.consecutiveFailures).toBe(0);
      expect(healthSnapshot(state, AT).ok).toBe(true);
    });
  });
});

describe("healthApp", () => {
  it("answers 200 when healthy and 503 when not", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);

    const before = await app.request("/health");
    expect(before.status).toBe(503);

    recordPass(state, report(true), AT);
    const after = await app.request("/health");
    expect(after.status).toBe(200);
    expect(((await after.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("serves nothing else", async () => {
    const app = healthApp(createHealthState(BOOT), () => AT);
    expect((await app.request("/")).status).toBe(404);
    expect((await app.request("/metrics")).status).toBe(404);
  });

  it("answers 503 for an unbudgeted duty even though both real duties are healthy", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);
    recordPass(
      state,
      {
        duties: [
          ...report(true).duties,
          { duty: UNBUDGETED_DUTY, ok: true, nextDueAt: null, durationMs: 0 },
        ],
        nextDueAt: null,
      },
      AT,
    );
    const res = await app.request("/health");
    expect(res.status).toBe(503);
  });

  // C2, at the route: the status CODE is the thing an uptime check actually reads (spec §9's whole
  // point), so this asserts `res.status`, not merely the body's `ok` field the way the unit-level
  // health.test.ts cases above do.
  it("answers 503, not 200, when drain reports ok:true but skipped a tenant", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);
    recordPass(
      state,
      {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 1, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 0, durationMs: 0 },
        ],
        nextDueAt: null,
      },
      AT,
    );
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { duties: Record<string, { skipped: number }> };
    // Self-explaining without log archaeology: the count itself is in the body, not just the fact
    // of unhealthiness.
    expect(body.duties[DRAIN_DUTY]?.skipped).toBe(1);
  });

  it("answers 503, not 200, when reconcile reports ok:true but skipped a pair", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);
    recordPass(
      state,
      {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 0, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 3, durationMs: 0 },
        ],
        nextDueAt: null,
      },
      AT,
    );
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { duties: Record<string, { skipped: number }> };
    expect(body.duties[RECONCILE_DUTY]?.skipped).toBe(3);
  });

  // CRITICAL pre-merge finding, at the route: the status CODE — not merely the body's `ok` field —
  // is what an uptime check actually reads, mirroring the `skipped` case above for the identical
  // reason. This is the test the finding's own reachable scenario (a key rotated out from under
  // reconcile, parking every period after three attempts) shows up as: `lastOkAt` still advances
  // and `consecutiveFailures` stays 0 unless this reaches `/health`'s status code, not just its body.
  it("answers 503, not 200, when reconcile reports ok:true but parked a run", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);
    recordPass(
      state,
      {
        duties: [
          { duty: DRAIN_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 0, durationMs: 0 },
          { duty: RECONCILE_DUTY, ok: true, nextDueAt: null, skipped: 0, parked: 1, durationMs: 0 },
        ],
        nextDueAt: null,
      },
      AT,
    );
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { duties: Record<string, { parked: number }> };
    expect(body.duties[RECONCILE_DUTY]?.parked).toBe(1);
  });

  // The other half, at the route: a still-retrying `failed` run must not produce the same 503 a
  // genuine park does — asserting the STATUS here, not just `recordPass`'s in-memory state, is
  // what actually proves the false-alarm noise finding 3 warns against does not reach an uptime
  // check. `pass.ts` never lets a failed-only run set `parked` above 0 (pinned in pass.test.ts);
  // this is the shape that guarantee produces once it reaches `/health`.
  it("stays 200 when reconcile has failed runs but nothing parked", async () => {
    const state = createHealthState(BOOT);
    const app = healthApp(state, () => AT);
    recordPass(state, report(true), AT);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});

describe("recordPass returns what it recorded", () => {
  it("marks a duty with skips degraded even though its report reads ok", () => {
    const state = createHealthState(NOW);
    const records = recordPass(state, report([duty(DRAIN_DUTY, { ok: true, skipped: 1 })]), NOW);

    expect(records).toHaveLength(1);
    expect(records[0]!.degraded).toBe(true);
    expect(records[0]!.consecutiveFailures).toBe(1);
  });

  it("marks a clean duty not degraded", () => {
    const state = createHealthState(NOW);
    const records = recordPass(state, report([duty(DRAIN_DUTY, { ok: true })]), NOW);

    expect(records[0]!.degraded).toBe(false);
  });
});

describe("logDegradedDuties", () => {
  it("says nothing for a clean pass", () => {
    const lines: string[] = [];
    const state = createHealthState(NOW);
    logDegradedDuties(collect(lines), recordPass(state, report([duty(DRAIN_DUTY)]), NOW));

    expect(lines).toEqual([]);
  });

  // Level from staleness, not from a count: a count threshold means a different amount of TIME at
  // a different retry cadence, while `stale` is already the 503 criterion — so an `error` line and
  // a 503 are the same condition by construction rather than two thresholds that can disagree.
  it("logs error when the duty is stale and warn when it is not", () => {
    const lines: string[] = [];
    const state = createHealthState(NOW);
    // First: a duty that has succeeded recently, then fails — not yet stale.
    recordPass(state, report([duty(DRAIN_DUTY, { ok: true })]), NOW);
    logDegradedDuties(
      collect(lines),
      recordPass(state, report([duty(DRAIN_DUTY, { ok: false })]), NOW),
    );
    expect(lines[0]).toContain("warn duty.degraded");

    // Then: far enough past the budget that the same duty is stale.
    const late = new Date(NOW.getTime() + DUTY_BUDGET_MS[DRAIN_DUTY] + 1);
    lines.length = 0;
    logDegradedDuties(
      collect(lines),
      recordPass(state, report([duty(DRAIN_DUTY, { ok: false })]), late),
    );
    expect(lines[0]).toContain("error duty.degraded");
  });

  // A host that has never had a successful pass reads as stale (`lastOkAt === null`), which is
  // exactly when `/health` returns 503 — so the first failing pass after boot is an `error`, and
  // the two agree.
  it("logs error on the first failing pass after boot", () => {
    const lines: string[] = [];
    const state = createHealthState(NOW);
    logDegradedDuties(
      collect(lines),
      recordPass(state, report([duty(DRAIN_DUTY, { ok: false })]), NOW),
    );

    expect(lines[0]).toContain("error duty.degraded");
  });
});

// DUTY_BUDGET_MS's exhaustiveness against pass.ts's duty set is no longer a runtime-testable
// property — it is enforced at `pnpm typecheck` by DUTY_BUDGET_MS's `Record<Duty, number>` typing
// (see health.ts). A test here comparing against a hardcoded literal could only catch someone
// editing its own literal, never the omission it would claim to catch; see the type instead.
