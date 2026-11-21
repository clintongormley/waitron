import dgram from "node:dgram";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { buildAddressQuery, parseAddressAnswers } from "./network.js";

const MDNS_PORT = 5353;
const MDNS_GROUP = "224.0.0.251";
const DEFAULT_TIMEOUT_MS = 2_000;
/** One lost packet must not fail the connection, so the question goes out again inside the wait. */
const ASK_AGAIN_AFTER_MS = [250, 1_000];

/** The part of a `dgram` socket the lookup uses, so a test can hand it a fake. */
export interface MdnsSocket {
  on(event: "message", listener: (msg: Buffer) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  bind(port: number, callback: () => void): unknown;
  addMembership(group: string): unknown;
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
 * the first reply naming it answers, with every IPv4 address that reply gives for it (the box's
 * responder can give several in one reply); any other name goes to `fallback`. Neither the agent's
 * container nor the box's system lookup resolves a three-part `.local` name.
 *
 * The socket listens on 5353 in the group because the box's server (`multicast-dns`) answers to
 * the group whatever port the question came from; an answer sent straight back arrives on the
 * same socket. Address reuse lets it share 5353 with avahi and the server.
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
    const question = buildAddressQuery(hostname);
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (addresses: string[]): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      if (addresses[0] === undefined) callback(notFound(hostname), "");
      else if (options.all === true)
        callback(
          null,
          addresses.map((address) => ({ address, family: 4 })),
        );
      else callback(null, addresses[0], 4);
    };
    const askNetwork = (): void => {
      socket.send(question, MDNS_PORT, MDNS_GROUP);
    };
    timers.push(setTimeout(() => finish([]), timeoutMs));
    socket.on("message", (msg) => {
      const addresses = parseAddressAnswers(msg, hostname);
      if (addresses.length > 0) finish(addresses);
    });
    socket.on("error", () => finish([]));
    socket.bind(MDNS_PORT, () => {
      if (settled) return;
      try {
        socket.addMembership(MDNS_GROUP);
      } catch {
        finish([]);
        return;
      }
      askNetwork();
      for (const after of ASK_AGAIN_AFTER_MS) timers.push(setTimeout(askNetwork, after));
    });
  };
}
