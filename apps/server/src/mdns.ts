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
