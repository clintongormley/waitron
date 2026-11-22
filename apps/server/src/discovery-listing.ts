export const DISCOVERED_TTL_MS = 15_000;
const SCANNING_TTL_MS = 45_000;

/** Report times and the discovery deadline use the same steady clock. */
export function withinTtl(at: number | undefined, now: number, ttl: number): boolean {
  return at !== undefined && now - at <= ttl;
}

export function isListed(at: number | undefined, now: number, discoveryEnd: number): boolean {
  return withinTtl(at, now, now < discoveryEnd ? SCANNING_TTL_MS : DISCOVERED_TTL_MS);
}
