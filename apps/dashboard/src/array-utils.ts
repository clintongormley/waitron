export function toggleMembership<T>(
  current: readonly T[],
  all: readonly T[],
  value: T,
  checked: boolean,
): T[] {
  const set = new Set(current);
  if (checked) set.add(value);
  else set.delete(value);
  return all.filter((x) => set.has(x));
}
