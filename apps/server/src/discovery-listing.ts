export const DISCOVERED_TTL_MS = 15_000;
// While a discovery window is open an agent reports a pass's devices once per pass, on the pull after
// it ends, not every 2 s; a pass whose Bluetooth `info` call is killed at 15 s runs past 15 s.
const SCANNING_TTL_MS = 45_000;

/** The discovered list's freshness: a report taken at `at` (epoch ms) is still listed at `now`. */
export function isListed(at: number | undefined, now: number, discoveryUntil: number): boolean {
  return (
    at !== undefined && now - at <= (now < discoveryUntil ? SCANNING_TTL_MS : DISCOVERED_TTL_MS)
  );
}
