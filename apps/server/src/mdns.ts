import multicastDns from "multicast-dns";
import type { Logger } from "./logger.js";

/**
 * A thin mDNS responder so a freshly-installed box answers to `waitron.local` on the LAN without a
 * router config or a manual `/etc/hosts` edit. It only ANSWERS — on each multicast query for our
 * hostname it replies with the box's current IPv4 addresses; it never queries and holds no cache.
 *
 * The addresses are read PER QUERY (via `getAddresses`), not captured at start, so a DHCP lease
 * change is reflected on the next resolve rather than pinning a stale address for the life of the
 * process. The socket is INJECTED (`makeSocket`) so the unit test drives a fake and needs no real
 * multicast; the default is a real `multicast-dns` instance.
 */

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
  /** A bind/membership failure (EADDRINUSE/EACCES) arrives here — see `startMdnsResponder`. The real
   *  instance emits `'error'` on the same EventEmitter, so an unhandled one would throw and kill the
   *  process; the responder registers a handler that logs and swallows it. */
  on(event: "error", handler: (err: Error) => void): void;
  respond(response: { answers: MdnsAnswer[] }): void;
  destroy(cb?: () => void): void;
}

export interface MdnsResponder {
  stop(): Promise<void>;
}

export interface MdnsDeps {
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

/** Pure: the A answers for `hostname` over `addresses` (empty when there are no addresses). */
export function buildMdnsAnswers(hostname: string, addresses: string[]): MdnsAnswer[] {
  return addresses.map((data) => ({ name: hostname, type: "A", ttl: MDNS_TTL_SECONDS, data }));
}

/**
 * Start answering mDNS A queries for `hostname`. On each `"query"`, if any question asks for our
 * hostname by an A or ANY record AND we currently have at least one address, respond with one A
 * record per address; otherwise stay silent (an empty answer set is never sent — mDNS treats a
 * responder that answers with nothing as noise). `stop()` destroys the socket once and is idempotent.
 */
export function startMdnsResponder(deps: MdnsDeps): MdnsResponder {
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

  // mDNS advertisement is NON-load-bearing — a device still reaches the box by its LAN IP whether or
  // not `waitron.local` resolves — so a socket failure must never crash boot. The real
  // `multicast-dns` instance emits `'error'` on a bind/membership failure (EADDRINUSE/EACCES on a
  // host with no multicast route, seen in some CI/containers), and an unhandled `'error'` on an
  // EventEmitter is rethrown by Node and takes the process down. Log it and swallow it: the box keeps
  // trading, just without name-based discovery on that host.
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
