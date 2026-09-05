/**
 * Shared array helpers for the dashboard screens. `toggleMembership` is the checkbox/switch write-back
 * used by the canvas editor (a card's `visibleWhen` states) and the device-profile editor (a profile's
 * capabilities); it lives here rather than being copy-pasted per screen.
 */

/**
 * Toggle `value`'s membership of `current`, returning a NEW array ordered by `all` (deterministic, not
 * click order): add it when `checked`, drop it otherwise, then filter `all` to what remains.
 */
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
