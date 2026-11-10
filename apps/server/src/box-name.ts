/**
 * The venue's mDNS name. The name the responder answers for, discovery advertises and the leaf's
 * SANs cover must agree, or the trust flow hits a certificate-hostname mismatch.
 *
 * Copies outside this process (the image's `WAITRON_MANAGEMENT_RP_ID` / `WAITRON_MANAGEMENT_ORIGIN`,
 * compose's defaults, `waitron.sh`'s QR URL) are pinned to this line, read as text, by
 * `scripts/deploy-image-env.test.ts`.
 */
export const BOX_HOSTNAME = "waitron.local";

/** This box's own network name, which tells it apart from the venue's other boxes. */
export function boxHostnameFor(nodeId: string): string {
  return `box-${nodeId.slice(0, 4).toLowerCase()}.${BOX_HOSTNAME}`;
}

/** The dNSName SANs on the box's self-signed leaf, whether minted or re-issued after a restore. */
export const BOX_LEAF_HOSTNAMES = [BOX_HOSTNAME, "localhost"];

/** The dNSName SANs on the leaf of the box `nodeId` names: its own name, then {@link BOX_LEAF_HOSTNAMES}. */
export function leafHostnamesFor(nodeId: string): string[] {
  return [boxHostnameFor(nodeId), ...BOX_LEAF_HOSTNAMES];
}

/**
 * The address this box puts in its own chart row: its advertised origin with the venue's shared
 * name replaced by its own. An origin at any other host (a development or Cloud profile) is left as
 * configured.
 */
export function ownContactUrl(advertisedOrigin: string, nodeId: string): string {
  const url = new URL(advertisedOrigin);
  if (url.hostname !== BOX_HOSTNAME) return advertisedOrigin;
  url.hostname = boxHostnameFor(nodeId);
  return url.origin;
}

/** Whether two node ids give the same box name. */
export function sameBoxName(a: string, b: string): boolean {
  return boxHostnameFor(a) === boxHostnameFor(b);
}
