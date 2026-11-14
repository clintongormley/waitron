export const DISCOVERED_TTL_MS = 15_000;
const SCANNING_TTL_MS = 45_000;

/** A report taken at `at` (epoch ms) is within `ttl` of `now`, on either side: one stamped further
 * ahead than its limit predates a backward step of the clock. */
export function withinTtl(at: number | undefined, now: number, ttl: number): boolean {
  return at !== undefined && now - at <= ttl && at - now <= ttl;
}

/** The discovered list's freshness: a report taken at `at` (epoch ms) is still listed at `now`. */
export function isListed(at: number | undefined, now: number, discoveryUntil: number): boolean {
  return withinTtl(at, now, now < discoveryUntil ? SCANNING_TTL_MS : DISCOVERED_TTL_MS);
}
