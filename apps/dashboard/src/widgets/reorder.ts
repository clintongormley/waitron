/** Move the item at `from` to index `to`, returning a new array. Out-of-range `to` is a no-op. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
