export function migrationUpgradeBudget(stepCount) {
  const deadlineMs = 30_000 + stepCount * 500;
  return { deadlineMs, timeoutMs: deadlineMs + 10_000 };
}
