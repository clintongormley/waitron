import multicastDns from "multicast-dns";
import { askedAndHeardOthers, type MdnsQuerySocket } from "./box-lookup.js";
import type { Logger } from "./logger.js";
import { isLoopbackHost } from "./primary-url.js";

// A thin mDNS responder so a box answers to its names on the LAN. It holds no cache.

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
  /** The names to answer for, read per query so a name dropped from the list stops being answered. */
  names: () => readonly string[];
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

function respondsOnLan(deps: { devMode: boolean; httpHost: string }): boolean {
  // Development must not compete with a real box for its LAN name. A loopback-only listener
  // cannot serve the LAN addresses advertised here either.
  return !deps.devMode && !isLoopbackHost(deps.httpHost);
}

/** Outside development, answer mDNS A queries for a non-loopback HTTP listener. */
export function startMdnsResponder(deps: MdnsDeps): MdnsResponder {
  if (!respondsOnLan(deps)) {
    return { stop: () => Promise.resolve() };
  }
  const { names, getAddresses, log } = deps;
  const makeSocket = deps.makeSocket ?? (() => multicastDns() as MdnsSocket);
  const socket = makeSocket();

  socket.on("query", (query) => {
    const ours = names();
    const asked = new Set(
      query.questions
        .filter((q) => ours.includes(q.name) && (q.type === "A" || q.type === "ANY"))
        .map((q) => q.name),
    );
    if (asked.size === 0) return;
    const addresses = getAddresses();
    const answers = [...asked].flatMap((name) => buildMdnsAnswers(name, addresses));
    if (answers.length === 0) return;
    socket.respond({ answers });
  });

  // A failed discovery socket must not stop the HTTP server from serving its IP address.
  socket.on("error", (err) => {
    log("warn", "mdns.socket_error", { message: err.message });
  });

  log("info", "mdns.responding", { hostnames: [...names()] });

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

export const SETUP_ASK_INTERVAL_MS = 30_000;
export const SETUP_ASK_JITTER_MS = 10_000;

export interface VenueNameWatchDeps {
  hostname: string;
  devMode: boolean;
  httpHost: string;
  /** In [0, 1); draws the delay added to each wait between asks. */
  random: () => number;
  makeSocket?: () => MdnsQuerySocket;
  ownAddresses?: () => string[];
  log: Logger;
}

export interface VenueNameWatch {
  /** `[hostname]` while the last ask heard no other box answer it, else none. */
  names(): readonly string[];
  stop(): Promise<void>;
}

/**
 * A box in setup mode answers the venue's name only while no other box does. The random delay
 * keeps two boxes switched on together from asking in step for ever.
 */
export function watchVenueNameInSetup(deps: VenueNameWatchDeps): VenueNameWatch {
  const { hostname, log } = deps;
  let heardOthers = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const ask = async (): Promise<void> => {
    let failed = false;
    heardOthers = await askedAndHeardOthers(hostname, {
      makeSocket: deps.makeSocket,
      ownAddresses: deps.ownAddresses,
      onSocketError: (err) => {
        if (failed) return;
        failed = true;
        log("warn", "mdns.ask_failed", { message: err.message });
      },
    });
    if (stopped) return;
    timer = setTimeout(
      () => {
        inFlight = ask();
      },
      SETUP_ASK_INTERVAL_MS + Math.floor(deps.random() * SETUP_ASK_JITTER_MS),
    );
    timer.unref();
  };

  if (respondsOnLan(deps)) inFlight = ask();

  return {
    names: () => (heardOthers ? [] : [hostname]),
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
