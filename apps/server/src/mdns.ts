import multicastDns from "multicast-dns";
import type { Logger } from "./logger.js";
import { isLoopbackHost } from "./primary-url.js";

// A thin mDNS responder so a box answers to `waitron.local` on the LAN. It only answers; it never
// queries and holds no cache.

/** One mDNS answer record — the subset of multicast-dns's ResourceRecord this module emits. */
export interface MdnsAnswer {
  name: string;
  type: "A";
  ttl: number;
  data: string;
}

/** A minimal view of a multicast-dns instance, so the responder can be unit-tested with a fake. */
export interface MdnsSocket {
  on(
    event: "query",
    handler: (query: { questions: { name: string; type: string }[] }) => void,
  ): void;
  /** A bind failure (EADDRINUSE/EACCES) arrives here; unhandled, it would throw and kill the process. */
  on(event: "error", handler: (err: Error) => void): void;
  respond(response: { answers: MdnsAnswer[] }): void;
  destroy(cb?: () => void): void;
}

export interface MdnsResponder {
  stop(): Promise<void>;
}

export interface MdnsDeps {
  devMode: boolean;
  httpHost: string;
  /** The name to answer for, e.g. "waitron.local". */
  hostname: string;
  /** Current box IPv4s, read per query (not cached) so a DHCP change is reflected. */
  getAddresses: () => string[];
  log: Logger;
  /** Socket factory, injected for tests. Default: the real multicast-dns instance. */
  makeSocket?: () => MdnsSocket;
}

/** TTL (seconds) on the A records — short so a moved box is re-resolved quickly. */
export const MDNS_TTL_SECONDS = 120;

export function buildMdnsAnswers(hostname: string, addresses: string[]): MdnsAnswer[] {
  return addresses.map((data) => ({ name: hostname, type: "A", ttl: MDNS_TTL_SECONDS, data }));
}

/** Outside development, answer mDNS A queries for a non-loopback HTTP listener. */
export function startMdnsResponder(deps: MdnsDeps): MdnsResponder {
  // Development must not compete with a real box for its LAN name. A loopback-only listener
  // cannot serve the LAN addresses advertised here either.
  if (deps.devMode || isLoopbackHost(deps.httpHost)) {
    return { stop: () => Promise.resolve() };
  }
  const { hostname, getAddresses, log } = deps;
  const makeSocket = deps.makeSocket ?? (() => multicastDns() as MdnsSocket);
  const socket = makeSocket();

  socket.on("query", (query) => {
    const wantsUs = query.questions.some(
      (q) => q.name === hostname && (q.type === "A" || q.type === "ANY"),
    );
    if (!wantsUs) return;
    const answers = buildMdnsAnswers(hostname, getAddresses());
    if (answers.length === 0) return;
    socket.respond({ answers });
  });

  // A failed discovery socket must not stop the HTTP server from serving its IP address.
  socket.on("error", (err) => {
    log("warn", "mdns.socket_error", { message: err.message });
  });

  log("info", "mdns.responding", { hostname });

  let stopped = false;
  return {
    stop() {
      if (stopped) return Promise.resolve();
      stopped = true;
      return new Promise<void>((resolve) => {
        socket.destroy(() => {
          log("info", "mdns.stopped", {});
          resolve();
        });
      });
    },
  };
}
