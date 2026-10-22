import { networkInterfaces } from "node:os";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { isLoopbackHost } from "./primary-url.js";

export interface RequestSourceDeps {
  interfaces?: typeof networkInterfaces;
}

/**
 * Every address any interface holds counts, internal ones and Docker bridges included: a browser
 * reaching the box over any of them runs on the box, so its clock is the box's own.
 */
export function addressIsBox(address: string | undefined, deps: RequestSourceDeps = {}): boolean {
  if (address === undefined) return true;
  const bare = address.replace(/%.*$/, "").replace(/^::ffff:/i, "");
  if (isLoopbackHost(bare)) return true;
  return Object.values((deps.interfaces ?? networkInterfaces)()).some((entries) =>
    (entries ?? []).some((entry) => entry.address.replace(/%.*$/, "") === bare),
  );
}

/** A request with no connection to read, as from `app.request` with no socket, counts as the box's. */
export function requestFromBox(c: Context, deps: RequestSourceDeps = {}): boolean {
  let address: string | undefined;
  try {
    address = getConnInfo(c).remote.address;
  } catch {
    address = undefined;
  }
  return addressIsBox(address, deps);
}
