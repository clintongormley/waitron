import type { Context } from "hono";
import { readNodeMembership, type Database } from "@waitron/db";
import { routableServers } from "@waitron/membership";
import { BOX_HOSTNAME } from "./box-name.js";
import { isRemoteStaffRequest, managementSite } from "./request-from-box.js";

function boxOrigin(contactUrl: string): string | undefined {
  const url = URL.parse(contactUrl);
  if (url?.protocol !== "https:") return undefined;
  const underVenueName = url.hostname === BOX_HOSTNAME || url.hostname.endsWith(`.${BOX_HOSTNAME}`);
  return underVenueName ? url.origin : undefined;
}

/**
 * The origins a passkey check accepts: the management origin, and, when its host is the venue's
 * shared name, the https origin of each routable chart row at or under that name, read per call.
 */
export function venuePasskeyOrigins(
  db: Database,
  managementOrigin: string,
): () => Promise<string[]> {
  return async () => {
    if (new URL(managementOrigin).hostname !== BOX_HOSTNAME) return [managementOrigin];
    const boxes = routableServers(await readNodeMembership(db)).flatMap((server) => {
      const origin = boxOrigin(server.url);
      return origin === undefined ? [] : [origin];
    });
    return [...new Set([managementOrigin, ...boxes])];
  };
}

/** {@link managementSite} for verifying a passkey, where a local request may name any of the
 * origins `localOrigins` answers. */
export async function passkeyVerifySite(
  c: Context,
  local: { rpId: string; origin: string },
  localOrigins: () => Promise<string[]>,
): Promise<{ rpId: string; origin: string | string[] }> {
  if (isRemoteStaffRequest(c)) return managementSite(c, local);
  return { rpId: local.rpId, origin: await localOrigins() };
}
