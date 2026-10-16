// `workMs` is processor time, so other work on the machine does not spend it; `timeoutMs` is wall
// time and only a backstop. The receipts are in
// docs/superpowers/plans/2026-10-16-a751-root-guard-time-limits.md.
export function migrationUpgradeBudget(stepCount) {
  return { workMs: 30_000 + stepCount * 500, idleMs: 120_000, timeoutMs: 1_800_000 };
}
