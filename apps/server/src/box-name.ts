export const VENUE_HOSTNAME = "waitron.local";

/** This box's own network name, which tells it apart from the venue's other boxes. */
export function boxHostnameFor(nodeId: string): string {
  return `box-${nodeId.slice(0, 4).toLowerCase()}.${VENUE_HOSTNAME}`;
}

/**
 * The address this box puts in its own chart row: its advertised origin with the venue's shared
 * name replaced by its own. An origin at any other host (a development or Cloud profile) is left as
 * configured.
 */
export function ownContactUrl(advertisedOrigin: string, nodeId: string): string {
  const url = new URL(advertisedOrigin);
  if (url.hostname !== VENUE_HOSTNAME) return advertisedOrigin;
  url.hostname = boxHostnameFor(nodeId);
  return url.origin;
}

/** Whether two node ids give the same box name. */
export function sameBoxName(a: string, b: string): boolean {
  return boxHostnameFor(a) === boxHostnameFor(b);
}
