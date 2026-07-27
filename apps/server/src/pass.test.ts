import { describe, expect, it } from "vitest";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { DrainResult } from "@waitron/fiscal";
import type { RunRecord, TickResult } from "@waitron/scheduler";
import { DRAIN_DUTY, RECONCILE_DUTY, runPass, type PassDeps } from "./pass.js";

const NOW = new Date("2026-07-26T09:00:00Z");
const SOON = new Date("2026-07-26T09:10:00Z");
const LATER = new Date("2026-07-26T23:00:00Z");
// Branded, never a bare `as TenantId`: the brand is what stops a raw string reaching a
// tenant-scoped call site, and casting past it in a test teaches the wrong pattern (see
// reconcile-duty.test.ts's identical comment).
const TENANT = brandTenantId("22222222-2222-2222-2222-222222222222");
const PERIOD = { from: new Date("2026-07-25T00:00:00Z"), to: new Date("2026-07-26T00:00:00Z") };

function drainResult(over: Partial<DrainResult> = {}): DrainResult {
  return {
    nextDueAt: null,
    batchesSent: 0,
    recordsSubmitted: 0,
    recordsAccepted: 0,
    recordsHalted: 0,
    incidentsRaised: 0,
    skipped: [],
    ...over,
  };
}

function tickResult(over: Partial<TickResult> = {}): TickResult {
  return { ran: [], deferred: 0, beyondHorizon: 0, skipped: [], nextDueAt: null, ...over };
}

function runRecord(over: Partial<RunRecord> = {}): RunRecord {
  return {
    tenantId: TENANT,
    duty: RECONCILE_DUTY,
    period: PERIOD,
    generation: 1,
    outcome: "succeeded",
    ...over,
  };
}

function deps(over: Partial<PassDeps> = {}): PassDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    drain: () => Promise.resolve(drainResult()),
    reconcile: () => Promise.resolve(tickResult()),
    log: (level, event, fields) => lines.push(`${level} ${event} ${JSON.stringify(fields ?? {})}`),
    ...over,
  };
}

describe("runPass", () => {
  it("runs drain before reconcile, always", async () => {
    const order: string[] = [];
    const d = deps({
      drain: () => {
        order.push("drain");
        return Promise.resolve(drainResult());
      },
      reconcile: () => {
        order.push("reconcile");
        return Promise.resolve(tickResult());
      },
    });
    await runPass(d, NOW);
    // Not an aesthetic preference: drain is the duty with a legal clock, so a reconcile sweep that
    // is behind must never delay it.
    expect(order).toEqual(["drain", "reconcile"]);
  });

  it("folds the minimum of the non-null answers", async () => {
    const d = deps({
      drain: () => Promise.resolve(drainResult({ nextDueAt: SOON })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: LATER })),
    });
    expect((await runPass(d, NOW)).nextDueAt).toEqual(SOON);
  });

  it("folds the minimum even when reconcile answers earlier than drain", async () => {
    // Pairs with the test above so the fold is proven order-free: that one only ever has drain's
    // own answer be the smaller of the two, so alone it cannot tell a true cross-duty minimum
    // apart from a bug that just prefers drain's non-null answer outright. This one has reconcile
    // answer first, which only a genuine `Math.min` — not a drain-favouring shortcut — gets right.
    const d = deps({
      drain: () => Promise.resolve(drainResult({ nextDueAt: LATER })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: SOON })),
    });
    expect((await runPass(d, NOW)).nextDueAt).toEqual(SOON);
  });

  it("ignores a null rather than letting it win the comparison", async () => {
    // A null means "no work exists at all" — not a time. Treating it as one would sleep the whole
    // MAX_TICK while drain had a batch due in ten minutes.
    const d = deps({
      drain: () => Promise.resolve(drainResult({ nextDueAt: SOON })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: null })),
    });
    expect((await runPass(d, NOW)).nextDueAt).toEqual(SOON);
  });

  it("folds reconcile's answer when drain has none", async () => {
    // The mirror of the test above, completing the null-fold matrix: both non-null (x2, order-free),
    // drain-only, reconcile-only, both-null.
    const d = deps({
      drain: () => Promise.resolve(drainResult({ nextDueAt: null })),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: SOON })),
    });
    expect((await runPass(d, NOW)).nextDueAt).toEqual(SOON);
  });

  it("reports null only when neither duty has any work", async () => {
    expect((await runPass(deps(), NOW)).nextDueAt).toBeNull();
  });

  it("contains a throwing duty, still runs the other, and records the code", async () => {
    const d = deps({
      drain: () =>
        Promise.reject(
          new AppError("server.credential_unusable", {
            tenantId: "t",
            purpose: "fiscal.aeat",
            field: "certKind",
          }),
        ),
      reconcile: () => Promise.resolve(tickResult({ nextDueAt: LATER })),
    });
    const report = await runPass(d, NOW);

    // The loop must survive a duty that throws: one transient database blip ending the hourly retry
    // is precisely the failure the scheduler's nextDueAt semantics were written to prevent.
    const drainReport = report.duties.find((entry) => entry.duty === DRAIN_DUTY)!;
    expect(drainReport).toEqual({
      duty: DRAIN_DUTY,
      ok: false,
      errorCode: "server.credential_unusable",
      // A duty that threw has no answer about when it is next due, and a failed drain is due
      // immediately — the pass reports `now` so the loop retries on its floor rather than sleeping.
      nextDueAt: NOW,
    });
    expect(report.duties.find((entry) => entry.duty === RECONCILE_DUTY)?.ok).toBe(true);
    expect(report.nextDueAt).toEqual(NOW);
  });

  it("codes an unstructured throw as unknown", async () => {
    const d = deps({ drain: () => Promise.reject(new Error("socket hang up")) });
    const report = await runPass(d, NOW);
    expect(report.duties[0]?.errorCode).toBe("unknown");
  });

  it("logs drain's skipped tenants at warn, because an unsubmittable tenant is never silent", async () => {
    const d = deps({
      drain: () =>
        Promise.resolve(
          // `DrainResult`'s own invariant (packages/fiscal/src/backend.ts): `nextDueAt` is never
          // null while `skipped` is non-empty — a real drain reports `now` instead, so a host
          // sleeping on the field cannot sleep past a skipped tenant's art. 16.4 hour. The fixture
          // matches that shape rather than teaching a producer-impossible one.
          drainResult({
            nextDueAt: NOW,
            skipped: [{ tenantId: TENANT, errorCode: "credentials.missing" }],
          }),
        ),
    });
    await runPass(d, NOW);
    expect(d.lines.some((line) => line.startsWith("warn drain.tenant_skipped"))).toBe(true);
    expect(d.lines.some((line) => line.includes("credentials.missing"))).toBe(true);
  });

  it("logs drain's own summary counts", async () => {
    // The mirror of "logs runDue's skipped pairs and its deferred count" below, for drain's own
    // `drain.complete` line — otherwise half of "each duty logs its own summary" goes unverified.
    const d = deps({
      drain: () =>
        Promise.resolve(
          drainResult({
            batchesSent: 3,
            recordsSubmitted: 10,
            recordsAccepted: 9,
            recordsHalted: 1,
            incidentsRaised: 1,
          }),
        ),
    });
    await runPass(d, NOW);
    const line = d.lines.find((l) => l.startsWith("info drain.complete"));
    expect(line).toBeDefined();
    expect(line).toContain('"batchesSent":3');
    expect(line).toContain('"recordsSubmitted":10');
    expect(line).toContain('"recordsAccepted":9');
    expect(line).toContain('"recordsHalted":1');
    expect(line).toContain('"incidentsRaised":1');
  });

  it("logs runDue's skipped pairs and its deferred count", async () => {
    const d = deps({
      reconcile: () =>
        Promise.resolve(
          tickResult({
            deferred: 4,
            beyondHorizon: 2,
            skipped: [{ tenantId: TENANT, duty: RECONCILE_DUTY, errorCode: "unknown" }],
          }),
        ),
    });
    await runPass(d, NOW);
    expect(d.lines.some((line) => line.startsWith("warn reconcile.pair_skipped"))).toBe(true);
    expect(d.lines.some((line) => line.includes('"deferred":4'))).toBe(true);
    expect(d.lines.some((line) => line.includes('"beyondHorizon":2'))).toBe(true);
  });

  // A parked reconcile run is the CRITICAL pre-merge finding this suite exists to close: a bare
  // `ran: result.ran.length` cannot tell "every run swept clean" apart from "every run was
  // abandoned for good" — see health.test.ts's own describe block for how this reaches /health.
  describe("breaks TickResult.ran down by outcome (pre-merge review, terminal reconcile runs)", () => {
    it("counts succeeded, failed and parked separately in reconcile.complete, not a bare total", async () => {
      const d = deps({
        reconcile: () =>
          Promise.resolve(
            tickResult({
              ran: [
                runRecord({ outcome: "succeeded" }),
                runRecord({ outcome: "failed", errorCode: "unknown" }),
                runRecord({ outcome: "parked", errorCode: "credentials.key_version_unknown" }),
                runRecord({ outcome: "parked", errorCode: "credentials.key_version_unknown" }),
              ],
            }),
          ),
      });
      await runPass(d, NOW);
      const line = d.lines.find((l) => l.startsWith("info reconcile.complete"));
      expect(line).toBeDefined();
      const fields = JSON.parse(line!.slice(line!.indexOf("{"))) as {
        ran: { succeeded: number; failed: number; parked: number };
      };
      expect(fields.ran).toEqual({ succeeded: 1, failed: 1, parked: 2 });
    });

    it("logs one warn line per failed run, and one error line per parked run, each with errorCode/tenant/duty/period", async () => {
      const d = deps({
        reconcile: () =>
          Promise.resolve(
            tickResult({
              ran: [
                runRecord({ outcome: "succeeded" }),
                runRecord({ outcome: "failed", errorCode: "server.unavailable" }),
                runRecord({ outcome: "parked", errorCode: "credentials.key_version_unknown" }),
              ],
            }),
          ),
      });
      await runPass(d, NOW);

      const failedLine = d.lines.find((l) => l.startsWith("warn reconcile.run_failed"));
      expect(failedLine).toBeDefined();
      expect(failedLine).toContain('"tenantId":"22222222-2222-2222-2222-222222222222"');
      expect(failedLine).toContain(`"duty":"${RECONCILE_DUTY}"`);
      expect(failedLine).toContain('"errorCode":"server.unavailable"');
      expect(failedLine).toContain(PERIOD.from.toISOString());

      const parkedLine = d.lines.find((l) => l.startsWith("error reconcile.run_parked"));
      expect(parkedLine).toBeDefined();
      expect(parkedLine).toContain('"errorCode":"credentials.key_version_unknown"');

      // Never a line for the succeeded run — that would defeat the point of a per-anomaly line.
      expect(d.lines.some((l) => l.includes("reconcile.run_succeeded"))).toBe(false);
    });

    it("carries the parked count into DutyReport.parked, alongside skipped", async () => {
      const d = deps({
        reconcile: () =>
          Promise.resolve(
            tickResult({
              ran: [
                runRecord({ outcome: "parked", errorCode: "unknown" }),
                runRecord({ outcome: "failed", errorCode: "unknown" }),
              ],
            }),
          ),
      });
      const report = await runPass(d, NOW);
      const reconcileReport = report.duties.find((entry) => entry.duty === RECONCILE_DUTY);
      // `ok: true` — `runDue` returned normally, exactly like a skipped pair — but `parked: 1`
      // is what health.ts's recordPass must treat as not-ok; `failed` never contributes to it.
      expect(reconcileReport).toMatchObject({ ok: true, parked: 1 });
    });

    it("reports drain's own parked count as a fixed 0 — DrainResult has no run-level outcome", async () => {
      const report = await runPass(deps(), NOW);
      const drainReport = report.duties.find((entry) => entry.duty === DRAIN_DUTY);
      expect(drainReport).toMatchObject({ ok: true, parked: 0 });
    });

    it("leaves DutyReport.parked undefined for a duty that threw, mirroring skipped", async () => {
      const d = deps({ reconcile: () => Promise.reject(new Error("socket hang up")) });
      const report = await runPass(d, NOW);
      const reconcileReport = report.duties.find((entry) => entry.duty === RECONCILE_DUTY);
      expect(reconcileReport?.ok).toBe(false);
      expect(reconcileReport?.parked).toBeUndefined();
    });
  });

  it("emits exactly one pass.complete line carrying both summaries", async () => {
    const d = deps();
    await runPass(d, NOW);
    const passComplete = d.lines.filter((line) => line.startsWith("info pass.complete"));
    expect(passComplete).toHaveLength(1);

    // The count alone would stay green if one duty's entry silently dropped out of the summary —
    // parse the line and check both duties actually made it into `duties`, not just that some
    // pass.complete line was emitted.
    const fields = JSON.parse(passComplete[0]!.slice(passComplete[0]!.indexOf("{"))) as {
      duties: { duty: string; ok: boolean }[];
    };
    expect(fields.duties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ duty: DRAIN_DUTY, ok: true }),
        expect.objectContaining({ duty: RECONCILE_DUTY, ok: true }),
      ]),
    );
  });
});
