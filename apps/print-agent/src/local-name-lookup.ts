import dgram from "node:dgram";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { buildAddressQuery, parseAddressAnswer } from "./network.js";

const MDNS_PORT = 5353;
const MDNS_GROUP = "224.0.0.251";
const DEFAULT_TIMEOUT_MS = 2_000;

/** The part of a `dgram` socket the lookup uses, so a test can hand it a fake. */
export interface MdnsSocket {
  on(event: "message", listener: (msg: Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  bind(callback: () => void): unknown;
  send(msg: Buffer, port: number, address: string): unknown;
  close(): unknown;
}

export interface LocalNameLookupDeps {
  openSocket?: () => MdnsSocket;
  fallback?: LookupFunction;
  timeoutMs?: number;
}

function isLocalName(hostname: string): boolean {
  return /\.local\.?$/i.test(hostname);
}

function notFound(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
    code: "ENOTFOUND",
    hostname,
    syscall: "getaddrinfo",
  });
}

/**
 * A `lookup` for a connection: a `.local` name is asked on the local network by multicast DNS and
 * the first matching IPv4 answer wins; any other name goes to `fallback`. Neither the agent's
 * container nor the box's system lookup resolves a three-part `.local` name.
 */
export function createLocalNameLookup(deps: LocalNameLookupDeps = {}): LookupFunction {
  const openSocket =
    deps.openSocket ?? ((): MdnsSocket => dgram.createSocket({ type: "udp4", reuseAddr: true }));
  const fallback = deps.fallback ?? (dns.lookup as LookupFunction);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return (hostname, options, callback) => {
    if (!isLocalName(hostname)) {
      fallback(hostname, options, callback);
      return;
    }
    if (options.family === 6) {
      callback(notFound(hostname), "");
      return;
    }
    const socket = openSocket();
    let settled = false;
    const finish = (address: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      if (address === undefined) callback(notFound(hostname), "");
      else if (options.all === true) callback(null, [{ address, family: 4 }]);
      else callback(null, address, 4);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    socket.on("message", (msg) => {
      const address = parseAddressAnswer(msg, hostname);
      if (address !== undefined) finish(address);
    });
    socket.on("error", () => finish(undefined));
    socket.bind(() => {
      if (!settled) socket.send(buildAddressQuery(hostname), MDNS_PORT, MDNS_GROUP);
    });
  };
}
