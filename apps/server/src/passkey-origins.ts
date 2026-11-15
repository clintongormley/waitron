import { readNodeMembership, type Database } from "@waitron/db";
import { routableServers } from "@waitron/membership";
import { BOX_HOSTNAME } from "./box-name.js";

function boxOrigin(contactUrl: string): string | undefined {
  const url = URL.parse(contactUrl);
  if (url?.protocol !== "https:") return undefined;
  const underVenueName = url.hostname === BOX_HOSTNAME || url.hostname.endsWith(`.${BOX_HOSTNAME}`);
  return underVenueName ? url.origin : undefined;
}

/**
 * The origins a passkey made on this box's dashboard may come from: the management origin, and,
 * when that is the venue's shared name, each routable box's own name in the held chart, read per
 * call so a box that joins after this start counts at once.
 */
export function venuePasskeyOrigins(
  db: Database,
  managementOrigin: string,
): () => Promise<readonly string[]> {
  return async () => {
    if (new URL(managementOrigin).hostname !== BOX_HOSTNAME) return [managementOrigin];
    const boxes = routableServers(await readNodeMembership(db)).flatMap((server) => {
      const origin = boxOrigin(server.url);
      return origin === undefined ? [] : [origin];
    });
    return [...new Set([managementOrigin, ...boxes])];
  };
}
