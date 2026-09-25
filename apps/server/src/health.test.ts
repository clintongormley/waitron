import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import type { StreamStatus, StreamView } from "@waitron/stream";
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

/** A duty name nobody has declared a budget for. */
const UNBUDGETED_DUTY = "made.up.duty";

const BOOT = new Date("2026-07-26T08:00:00Z");
const AT = new Date("2026-07-26T08:00:05Z");
const NOW = AT;

/** One `DutyReport` entry, defaulted to a clean pass so a caller only names what it overrides —
 * e.g. `duty(DRAIN_DUTY, { skipped: 1 })`. */
function duty(name: string, overrides: Partial<DutyReport> = {}): DutyReport {
  return { duty: name, ok: true, nextDueAt: null, durationMs: 0, ...overrides };
}

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
    // At boot every duty is also stale, so this isolates the `lastPassAt` clause; `recordPass`
    // cannot reach this state, hence the direct write.
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
    // Read from DUTY_BUDGET_MS, so the test follows the real boundary if the constant changes.
    const state = createHealthState(BOOT);
    recordPass(state, report(true), AT);
    const budget = DUTY_BUDGET_MS[DRAIN_DUTY];
    expect(healthSnapshot(state, new Date(AT.getTime() + budget - 60_000)).ok).toBe(true);
    expect(healthSnapshot(state, new Date(AT.getTime() + budget + 60_000)).ok).toBe(false);
  });

  it("gives drain a budget with slack over the default max tick (I1)", () => {
    // An idle host sleeps exactly maxTickMs, so a budget at or below it flips 503 once per cycle.
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
      stream: { state: "off" },
    });
  });

  // `ok` is false only on a throw, so a duty that skipped work still reports `ok: true`.
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
      // Per-DUTY, not a shared flag.
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

  // A parked run is never claimed again, yet `runDue` returns normally, so the duty reports
  // `ok: true`.
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

    // A still-retrying `failed` run must not look like a park; `pass.ts` keeps it out of `parked`
    // (pinned in pass.test.ts), so it arrives here as `parked: 0`.
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

  // The status CODE is what an uptime check reads, so these assert it, not only the body.
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

  // A failed-only reconcile arrives as `parked: 0` (pinned in pass.test.ts).
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

  // `lastOkAt === null` reads as stale, the same instant `/health` answers 503.
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

describe("/health reports who holds the venue folder", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function venueDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "wt-health-venue-"));
    dirs.push(dir);
    return dir;
  }
  async function holderFile(dir: string, heartbeatAt: Date): Promise<void> {
    await writeFile(
      join(dir, "venue.holder.json"),
      JSON.stringify({
        kind: "server",
        pid: 4242,
        host: "container-id",
        lockedAt: BOOT.toISOString(),
        heartbeatAt: heartbeatAt.toISOString(),
      }),
    );
  }
  const body = async (app: ReturnType<typeof healthApp>) =>
    (await (await app.request("/health")).json()) as Record<string, unknown>;

  it("names the holder this process wrote when it took the folder, and never its pid or host", async () => {
    const dir = await venueDir();
    const lock = await lockVenueDatabase(dir);
    try {
      const now = new Date();
      const { venueHolder } = await body(
        healthApp(createHealthState(BOOT), () => now, { venueDir: dir }),
      );
      expect(Object.keys(venueHolder as object).sort()).toEqual([
        "heartbeatAt",
        "kind",
        "lockedAt",
        "stale",
      ]);
      expect(venueHolder).toMatchObject({ kind: "script", stale: false });
    } finally {
      lock.release();
    }
  });

  it("reads a heartbeat 30 seconds old as stale", async () => {
    const dir = await venueDir();
    await holderFile(dir, new Date(AT.getTime() - 30_000));
    expect(
      (await body(healthApp(createHealthState(BOOT), () => AT, { venueDir: dir }))).venueHolder,
    ).toEqual({
      kind: "server",
      lockedAt: BOOT.toISOString(),
      heartbeatAt: new Date(AT.getTime() - 30_000).toISOString(),
      stale: true,
    });
  });

  it("reads the file on every request", async () => {
    const dir = await venueDir();
    const app = healthApp(createHealthState(BOOT), () => AT, { venueDir: dir });
    expect((await body(app)).venueHolder).toBeNull();
    await holderFile(dir, new Date(AT.getTime() - 1_000));
    expect((await body(app)).venueHolder).toMatchObject({ stale: false });
  });

  it("does not change the status code either way", async () => {
    const dir = await venueDir();
    await holderFile(dir, new Date(AT.getTime() - 60_000));
    const healthy = createHealthState(BOOT);
    recordPass(healthy, report(true), AT);
    expect((await healthApp(healthy, () => AT, { venueDir: dir }).request("/health")).status).toBe(
      200,
    );

    await holderFile(dir, AT);
    const unhealthy = createHealthState(BOOT);
    expect(
      (await healthApp(unhealthy, () => AT, { venueDir: dir }).request("/health")).status,
    ).toBe(503);
  });
});

describe("the bucket copy on /health", () => {
  const refused: StreamStatus = {
    state: "refused",
    generation: "gen-0-node-a-20260726T075000Z",
    reason: "pointer_changed",
    stateSince: AT.toISOString(),
    bucketProblem: { reason: "create_only_ignored", since: AT.toISOString() },
    lagMs: 3_600_000,
    lastConfirmedUploadAt: null,
  };

  it("reports the bucket copy's state, lag and last upload, but not the generation's name", () => {
    const state = createHealthState(BOOT);
    recordPass(state, report(true, true), AT);
    state.readStream = () => refused;
    expect(healthSnapshot(state, AT).body.stream).toEqual({
      state: "refused",
      reason: "pointer_changed",
      stateSince: AT.toISOString(),
      bucketProblem: { reason: "create_only_ignored", since: AT.toISOString() },
      lagMs: 3_600_000,
      lastConfirmedUploadAt: null,
    });
  });

  it("reports the bucket copy as off before anything set it", () => {
    const state = createHealthState(BOOT);
    expect(healthSnapshot(state, AT).body.stream).toEqual({ state: "off" });
  });

  it("reports a copy that is set up but could not start as it is", () => {
    const state = createHealthState(BOOT);
    const notStarted: StreamView = {
      state: "off",
      reason: "no_membership",
      stateSince: AT.toISOString(),
    };
    state.readStream = () => notStarted;
    expect(healthSnapshot(state, AT).body.stream).toEqual(notStarted);
  });

  it("names the fields of a copy that is off, so a field added later stays off this route", () => {
    const state = createHealthState(BOOT);
    const since = AT.toISOString();
    const extra = { nodeId: "node-a" };
    state.readStream = () =>
      ({ state: "off", reason: "no_membership", stateSince: since, ...extra }) as StreamView;
    expect(healthSnapshot(state, AT).body.stream).toEqual({
      state: "off",
      reason: "no_membership",
      stateSince: since,
    });
    state.readStream = () => ({ state: "off", ...extra }) as StreamView;
    expect(healthSnapshot(state, AT).body.stream).toEqual({ state: "off" });
  });

  // A bucket is external. /health failing on it would stall an install or an update
  // (`deploy/waitron.sh` waits for a healthy container) on someone else's outage.
  const badCopies: [string, StreamView][] = [
    ["behind", { ...refused, state: "streaming", reason: null, bucketProblem: null }],
    ["refused", refused],
    ["stopped", { ...refused, state: "off", reason: "supervisor_failed" }],
    ["not started", { state: "off", reason: "start_failed", stateSince: AT.toISOString() }],
  ];
  for (const [name, view] of badCopies) {
    it(`keeps a healthy box at 200 with a bucket copy that is ${name}`, async () => {
      const state = createHealthState(BOOT);
      recordPass(state, report(true, true), AT);
      state.readStream = () => view;
      const res = await healthApp(state, () => AT).request("/health");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    });
  }

  it("keeps an unhealthy box at 503 however current its bucket copy is", async () => {
    const state = createHealthState(BOOT);
    state.readStream = () => ({
      ...refused,
      state: "streaming",
      reason: null,
      bucketProblem: null,
      lagMs: 0,
    });
    const res = await healthApp(state, () => AT).request("/health");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });
});
