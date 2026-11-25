export function mergeColumnOrder(
  stored: readonly string[],
  reordered: readonly string[],
): string[] {
  const current = new Set(reordered);
  const remaining = reordered.values();
  // A view can omit columns. Keep their slots while replacing the order of the ones it shows.
  const merged = [...new Set(stored)].map((key) =>
    current.has(key) ? remaining.next().value! : key,
  );
  return [...merged, ...remaining];
}
