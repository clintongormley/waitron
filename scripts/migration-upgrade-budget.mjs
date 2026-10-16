// `workMs` is processor time, so other work on the machine does not spend it; `timeoutMs` is wall
// time and only a backstop. Receipt: docs/developers/ci-and-gates.md, "The upgrade budget counts
// the walk's own processor time".
export function migrationUpgradeBudget(stepCount) {
  return { workMs: 30_000 + stepCount * 500, idleMs: 120_000, timeoutMs: 1_800_000 };
}
