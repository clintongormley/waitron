// Imports nothing, so the dashboard shows the same default the server will store.

export function effectiveDefaultLabelId(
  labels: readonly { id: string; available: boolean }[],
  named: string | null,
): string | null {
  if (labels.some((label) => label.id === named && label.available)) return named;
  return labels.find((label) => label.available)?.id ?? null;
}
