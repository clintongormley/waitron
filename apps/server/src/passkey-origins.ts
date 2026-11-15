import { readNodeMembership, type Database } from "@waitron/db";
import { BOX_HOSTNAME } from "./box-name.js";

/**
 * The origins a passkey made on this box's dashboard may come from: the management origin, and,
 * when that is the venue's shared name, each box's own name in the held chart, read per call so a
 * box that joins after this start counts at once.
 */
export function venuePasskeyOrigins(
  db: Database,
  managementOrigin: string,
): () => Promise<readonly string[]> {
  return async () => {
    if (new URL(managementOrigin).hostname !== BOX_HOSTNAME) return [managementOrigin];
    const held = await readNodeMembership(db);
    const boxes = (held?.body.nodes ?? [])
      .filter((n) => n.standing !== "evicted" && n.contactUrl !== "")
      .map((n) => n.contactUrl);
    return [...new Set([managementOrigin, ...boxes])];
  };
}
