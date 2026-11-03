import { describe, expect, it } from "vitest";
import { emptyDrainResult } from "@waitron/fiscal";
import type { TickResult } from "@waitron/scheduler";
import { DRAIN_DUTY, RECONCILE_DUTY, runPass, type PassDeps } from "./pass.js";

const NOW = new Date("2026-07-26T09:00:00Z");

function deps(
  controller: AbortController | null,
  reconciled: string[],
): PassDeps & { lines: string[] } {
  const lines: string[] = [];
  const tick: TickResult = { ran: [], deferred: 0, beyondHorizon: 0, skipped: [], nextDueAt: null };
  return {
    lines,
    drain: async () => {
      controller?.abort();
      return emptyDrainResult();
    },
    reconcile: async () => {
      reconciled.push("reconcile");
      return tick;
    },
    awaitingCert: { current: false },
    monotonicMs: () => 0,
    log: (level, event) => lines.push(`${level} ${event}`),
    ...(controller === null ? {} : { signal: controller.signal }),
  };
}

describe("runPass told to stop", () => {
  it("control: with no signal, the reconcile runs after the drain", async () => {
    const reconciled: string[] = [];
    const report = await runPass(deps(null, reconciled), NOW);

    expect(reconciled).toEqual(["reconcile"]);
    expect(report.duties.map((duty) => duty.duty)).toEqual([DRAIN_DUTY, RECONCILE_DUTY]);
  });

  it("a signal raised during the drain skips the reconcile", async () => {
    const reconciled: string[] = [];
    const d = deps(new AbortController(), reconciled);
    const report = await runPass(d, NOW);

    expect(reconciled).toEqual([]);
    expect(report.duties.map((duty) => duty.duty)).toEqual([DRAIN_DUTY]);
    expect(d.lines).not.toContain("info reconcile.complete");
  });

  it("a signal that was never raised lets the reconcile run", async () => {
    const reconciled: string[] = [];
    const d = deps(null, reconciled);
    await runPass({ ...d, signal: new AbortController().signal }, NOW);

    expect(reconciled).toEqual(["reconcile"]);
  });
});
