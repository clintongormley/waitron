import { networkInterfaces } from "node:os";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { isLoopbackHost } from "./primary-url.js";

export interface RequestSourceDeps {
  interfaces?: typeof networkInterfaces;
}

/**
 * A request whose source address is loopback or one of the box's own interface addresses
 * (internal ones and Docker bridges included) came from the box.
 */
export function addressIsBox(address: string | undefined, deps: RequestSourceDeps = {}): boolean {
  if (address === undefined) return true;
  const bare = plainAddress(address);
  if (isLoopbackHost(bare)) return true;
  return Object.values((deps.interfaces ?? networkInterfaces)()).some((entries) =>
    (entries ?? []).some((entry) => entry.address.replace(/%.*$/, "") === bare),
  );
}

/** An IPv4 address mapped into IPv6, or one carrying a `%scope`, written as its plain form. */
function plainAddress(address: string): string {
  return address.replace(/%.*$/, "").replace(/^::ffff:/i, "");
}

/** The request's source address in plain form, or `undefined` when it has no connection to read. */
export function requestAddress(c: Context): string | undefined {
  let address: string | undefined;
  try {
    address = getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
  return address === undefined ? undefined : plainAddress(address);
}

export function isRemoteStaffRequest(c: Context): boolean {
  return c.env?.remoteStaff === true;
}

export function managementOriginFor(c: Context, localOrigin: string): string {
  return isRemoteStaffRequest(c) ? new URL(c.req.url).origin : localOrigin;
}

export function managementSite(
  c: Context,
  local: { rpId: string; origin: string },
): { rpId: string; origin: string } {
  const url = new URL(c.req.url);
  return isRemoteStaffRequest(c) ? { rpId: url.hostname, origin: url.origin } : local;
}

/** A missing socket is local unless the staff listener marked the request remote. */
export function requestFromBox(c: Context, deps: RequestSourceDeps = {}): boolean {
  return !isRemoteStaffRequest(c) && addressIsBox(requestAddress(c), deps);
}
