// Imports nothing, so browser code can import it by path and share it with the server.

export function effectiveDefaultLabelId(
  labels: readonly { id: string; available: boolean }[],
  named: string | null,
): string | null {
  if (labels.some((label) => label.id === named && label.available)) return named;
  return labels.find((label) => label.available)?.id ?? null;
}
