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

/** A request with no connection to read, as from `app.request` with no socket, counts as the box's. */
export function requestFromBox(c: Context, deps: RequestSourceDeps = {}): boolean {
  return addressIsBox(requestAddress(c), deps);
}
