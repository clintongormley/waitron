import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { DrainResult } from "@waitron/fiscal";
import type { RunRecord, TickResult } from "@waitron/payments";
import { DRAIN_DUTY, RECONCILE_DUTY } from "./pass.js";
import { drainJob, reconcileJob } from "./fiscal-jobs.js";
import { createHealthState } from "./health.js";
import { DEFAULT_DUTY_TIMINGS } from "./config.js";

type TestDeps = Parameters<typeof drainJob>[0] & Parameters<typeof reconcileJob>[0];

const NOW = new Date("2026-07-26T09:00:00Z");
const SOON = new Date("2026-07-26T09:10:00Z");
const LATER = new Date("2026-07-26T23:00:00Z");
const PERIOD = { from: new Date("2026-07-25T00:00:00Z"), to: new Date("2026-07-26T00:00:00Z") };

function drainResult(over: Partial<DrainResult> = {}): DrainResult {
  return {
    nextDueAt: null,
    tenantsWithWork: 0,
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

/** Log lines carry the provider's own `reconciliation_runs` key, never the `/health` label `RECONCILE_DUTY`. */
const STRIPE_RUN = "payments.reconcile.stripe";

function runRecord(over: Partial<RunRecord> = {}): RunRecord {
  return {
    duty: STRIPE_RUN,
    period: PERIOD,
    generation: 1,
    outcome: "succeeded",
    ...over,
  };
}

function deps(over: Partial<TestDeps> = {}): TestDeps & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    drain: () => Promise.resolve(drainResult()),
    reconcile: () => Promise.resolve(tickResult()),
    awaitingCert: { current: false },
    getRole: () => "primary",
    health: createHealthState(NOW),
    timings: DEFAULT_DUTY_TIMINGS,
    log: (level, event, fields) => lines.push(`${level} ${event} ${JSON.stringify(fields ?? {})}`),
    ...over,
  };
}

const ctx = { now: NOW, signal: new AbortController().signal };
const runDrain = (d: TestDeps) => drainJob(d).pass(ctx);
const runReconcile = (d: TestDeps) => reconcileJob(d).pass(ctx);

describe("fiscal and payment job reports", () => {
  it.each([
    [SOON, LATER],
    [LATER, SOON],
    [SOON, null],
    [null, SOON],
    [null, null],
  ])("keeps each job's due time: %s and %s", async (filingDue, paymentDue) => {
    const d = deps({
      drain: async () => drainResult({ nextDueAt: filingDue }),
      reconcile: async () => tickResult({ nextDueAt: paymentDue }),
    });
    expect((await runDrain(d)).nextDueAt).toEqual(filingDue);
    expect((await runReconcile(d)).nextDueAt).toEqual(paymentDue);
  });

  it("records the failed filing duty without changing the payment check's result", async () => {
    const d = deps({
      drain: () =>
        Promise.reject(
          new AppError("server.credential_unusable", {
            purpose: "fiscal.aeat",
            field: "certKind",
          }),
        ),
      reconcile: async () => tickResult({ nextDueAt: LATER }),
    });
    await expect(runDrain(d)).rejects.toMatchObject({ code: "server.credential_unusable" });
    expect(d.health.duties[DRAIN_DUTY]?.consecutiveFailures).toBe(1);
    expect(d.lines).toContain(
      'error duty.failed {"duty":"fiscal.drain","errorCode":"server.credential_unusable"}',
    );
    expect(await runReconcile(d)).toEqual({ nextDueAt: LATER, degraded: false });
    expect(d.health.duties[RECONCILE_DUTY]?.lastOkAt).toEqual(NOW);
  });

  it("codes an unstructured throw as unknown", async () => {
    const d = deps({ drain: () => Promise.reject(new Error("socket hang up")) });
    await expect(runDrain(d)).rejects.toThrow("socket hang up");
    expect(d.lines).toContain('error duty.failed {"duty":"fiscal.drain","errorCode":"unknown"}');
  });

  it("logs drain's skipped taxpayer at warn, because an unsubmittable taxpayer is never silent", async () => {
    const d = deps({
      drain: () =>
        Promise.resolve(
          // `DrainResult` never has a null `nextDueAt` while `skipped` is non-empty
          // (packages/fiscal/src/backend.ts), so the fixture keeps that shape.
          drainResult({
            nextDueAt: NOW,
            skipped: [{ errorCode: "credentials.missing" }],
          }),
        ),
    });
    await runDrain(d);
    expect(d.lines.some((line) => line.startsWith("warn drain.tenant_skipped"))).toBe(true);
    expect(d.lines.some((line) => line.includes("credentials.missing"))).toBe(true);
  });

  it("sets the awaiting-cert flag and logs fiscal.awaiting_certificate for a credentials.missing skip, without failing the drain", async () => {
    // A missing fiscal.aeat cert is a skip, not a throw: the pass does not fail, the flag flips true,
    // and the once-only awaiting line is logged beside the per-pass skip trace.
    const d = deps({
      drain: () =>
        Promise.resolve(
          drainResult({
            nextDueAt: NOW,
            tenantsWithWork: 1,
            skipped: [{ errorCode: "credentials.missing" }],
          }),
        ),
    });
    await expect(runDrain(d)).resolves.toEqual({ nextDueAt: NOW, degraded: true });
    expect(d.awaitingCert.current).toBe(true);
    expect(d.lines.some((line) => line.startsWith("warn fiscal.awaiting_certificate"))).toBe(true);
    expect(d.lines.some((line) => line.startsWith("warn drain.tenant_skipped"))).toBe(true);
    // It counts toward the duty's skipped total, so /health sees the unmet obligation.
    expect(d.health.duties[DRAIN_DUTY]?.skipped).toBe(1);
  });

  it("logs fiscal.awaiting_certificate ONCE across repeated passes with the cert still missing", async () => {
    const d = deps({
      drain: () =>
        Promise.resolve(
          drainResult({
            nextDueAt: NOW,
            tenantsWithWork: 1,
            skipped: [{ errorCode: "credentials.missing" }],
          }),
        ),
    });
    await runDrain(d);
    await runDrain(d);
    await runDrain(d);
    expect(
      d.lines.filter((line) => line.startsWith("warn fiscal.awaiting_certificate")),
    ).toHaveLength(1);
  });

  it("clears the awaiting-cert flag and logs recovery once when the cert appears, re-arming for a later loss", async () => {
    let missing = true;
    const d = deps({
      drain: () =>
        Promise.resolve(
          missing
            ? drainResult({
                nextDueAt: NOW,
                tenantsWithWork: 1,
                skipped: [{ errorCode: "credentials.missing" }],
              })
            : drainResult({ nextDueAt: SOON, tenantsWithWork: 1, batchesSent: 1 }),
        ),
    });
    await runDrain(d); // missing → flag true, one warn
    missing = false;
    await runDrain(d); // cert present, work drained → flag false, one recovery info
    expect(d.awaitingCert.current).toBe(false);
    expect(
      d.lines.filter((line) => line.startsWith("info fiscal.certificate_available")),
    ).toHaveLength(1);
    missing = true;
    await runDrain(d); // lost again → flag true, a SECOND warn (one line per episode)
    expect(d.awaitingCert.current).toBe(true);
    expect(
      d.lines.filter((line) => line.startsWith("warn fiscal.awaiting_certificate")),
    ).toHaveLength(2);
  });

  it("leaves the awaiting-cert flag UNCHANGED on a no-work pass — does not clear it, does not log recovery", async () => {
    // A no-work pass read no certificate, so it must not clear a flag an earlier missing-cert pass
    // set, nor log `fiscal.certificate_available`.
    let missing = true;
    const d = deps({
      // First pass: due work, cert missing. Later passes: no due work at all.
      drain: () =>
        Promise.resolve(
          missing
            ? drainResult({
                nextDueAt: NOW,
                tenantsWithWork: 1,
                skipped: [{ errorCode: "credentials.missing" }],
              })
            : drainResult(),
        ),
    });
    await runDrain(d); // missing → flag true
    expect(d.awaitingCert.current).toBe(true);
    missing = false;
    await runDrain(d); // no work → flag must stay true
    await runDrain(d);
    expect(d.awaitingCert.current).toBe(true);
    expect(
      d.lines.filter((line) => line.startsWith("info fiscal.certificate_available")),
    ).toHaveLength(0);
  });

  it("clears the awaiting-cert flag on a pass that genuinely resolves the cert — due work, no missing-cert skip", async () => {
    // A pass with due work that submitted does clear the flag and logs recovery once.
    let missing = true;
    const d = deps({
      drain: () =>
        Promise.resolve(
          missing
            ? drainResult({
                nextDueAt: NOW,
                tenantsWithWork: 1,
                skipped: [{ errorCode: "credentials.missing" }],
              })
            : drainResult({
                nextDueAt: SOON,
                tenantsWithWork: 1,
                batchesSent: 1,
                recordsSubmitted: 1,
              }),
        ),
    });
    await runDrain(d); // missing → flag true
    missing = false;
    await runDrain(d); // due work, cert resolved → flag clears
    expect(d.awaitingCert.current).toBe(false);
    expect(
      d.lines.filter((line) => line.startsWith("info fiscal.certificate_available")),
    ).toHaveLength(1);
  });

  it("logs drain's own summary counts", async () => {
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
    await runDrain(d);
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
            skipped: [{ duty: STRIPE_RUN, errorCode: "unknown" }],
          }),
        ),
    });
    await runReconcile(d);
    const skippedLine = d.lines.find((line) => line.startsWith("warn reconcile.pair_skipped"));
    expect(skippedLine).toContain(`"duty":"${STRIPE_RUN}"`);
    expect(d.lines.some((line) => line.includes('"deferred":4'))).toBe(true);
    expect(d.lines.some((line) => line.includes('"beyondHorizon":2'))).toBe(true);
  });

  // A bare `result.ran.length` cannot tell a clean sweep from runs abandoned for good; health.test.ts
  // pins how `parked` reaches /health.
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
      await runReconcile(d);
      const line = d.lines.find((l) => l.startsWith("info reconcile.complete"));
      expect(line).toBeDefined();
      const fields = JSON.parse(line!.slice(line!.indexOf("{"))) as {
        ran: { succeeded: number; failed: number; parked: number };
      };
      expect(fields.ran).toEqual({ succeeded: 1, failed: 1, parked: 2 });
    });

    it("logs one warn line per failed run, and one error line per parked run, each with errorCode/duty/period", async () => {
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
      await runReconcile(d);

      const failedLine = d.lines.find((l) => l.startsWith("warn reconcile.run_failed"));
      expect(failedLine).toBeDefined();
      expect(failedLine).toContain(`"duty":"${STRIPE_RUN}"`);
      expect(failedLine).toContain('"errorCode":"server.unavailable"');
      expect(failedLine).toContain(PERIOD.from.toISOString());

      const parkedLine = d.lines.find((l) => l.startsWith("error reconcile.run_parked"));
      expect(parkedLine).toBeDefined();
      expect(parkedLine).toContain(`"duty":"${STRIPE_RUN}"`);
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
      await expect(runReconcile(d)).resolves.toEqual({ nextDueAt: null, degraded: true });
      expect(d.health.duties[RECONCILE_DUTY]?.parked).toBe(1);
    });

    it("reports drain's own parked count as a fixed 0", async () => {
      const d = deps();
      await expect(runDrain(d)).resolves.toEqual({ nextDueAt: null, degraded: false });
      expect(d.health.duties[DRAIN_DUTY]?.parked).toBe(0);
    });

    it("clears the prior parked count and preserves the last success when the duty throws", async () => {
      const d = deps({
        reconcile: () => Promise.reject(new Error("socket hang up")),
      });
      const state = d.health.duties[RECONCILE_DUTY]!;
      state.parked = 1;
      state.lastOkAt = new Date("2026-07-25T09:00:00Z");
      await expect(runReconcile(d)).rejects.toThrow("socket hang up");
      expect(state.parked).toBe(0);
      expect(state.lastOkAt).toEqual(new Date("2026-07-25T09:00:00Z"));
    });
  });
});
