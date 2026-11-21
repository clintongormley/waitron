import multicastDns from "multicast-dns";
import { askedAndHeardOthers, MDNS_TTL_SECONDS, type MdnsQuerySocket } from "./box-lookup.js";
import type { Logger } from "./logger.js";
import { isLoopbackHost } from "./primary-url.js";

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
  /** `sent` is called once the send has finished, or failed. */
  respond(response: { answers: MdnsAnswer[] }, sent?: (err?: Error | null) => void): void;
  destroy(cb?: () => void): void;
}

export interface MdnsResponder {
  /** Tells every device now, unasked, that `name` is at this box's addresses. */
  announce(name: string): void;
  /** Tells every device to drop each answer for `name` this box gave since `announce(name)`. */
  withdraw(name: string): void;
  /** Withdraws every announced name, as `withdraw` does, before closing the socket. */
  stop(): Promise<void>;
}

export interface MdnsDeps {
  devMode: boolean;
  httpHost: string;
  /**
   * The names to answer for, read per query so a name dropped from the list stops being answered.
   * Called for every query on the network, so it returns a list built beforehand.
   */
  names: () => readonly string[];
  /** Current box IPv4s, read per query (not cached) so a DHCP change is reflected. */
  getAddresses: () => string[];
  log: Logger;
  /** Socket factory, injected for tests. Default: the real multicast-dns instance. */
  makeSocket?: () => MdnsSocket;
}

/** How long `stop()` waits for its goodbyes to be sent before closing the socket regardless. */
export const MDNS_GOODBYE_WAIT_MS = 1_000;

export function buildMdnsAnswers(
  hostname: string,
  addresses: string[],
  ttl: number = MDNS_TTL_SECONDS,
): MdnsAnswer[] {
  return addresses.map((data) => ({ name: hostname, type: "A", ttl, data }));
}

function respondsOnLan(deps: { devMode: boolean; httpHost: string }): boolean {
  // Development must not compete with a real box for its LAN name. A loopback-only listener
  // cannot serve the LAN addresses advertised here either.
  return !deps.devMode && !isLoopbackHost(deps.httpHost);
}

/** Outside development, answer mDNS A queries for a non-loopback HTTP listener. */
export function startMdnsResponder(deps: MdnsDeps): MdnsResponder {
  if (!respondsOnLan(deps)) {
    return { announce: () => {}, withdraw: () => {}, stop: () => Promise.resolve() };
  }
  const { names, getAddresses, log } = deps;
  const makeSocket = deps.makeSocket ?? (() => multicastDns() as MdnsSocket);
  const socket = makeSocket();

  // Every address each announced name was given at, so its goodbye reaches a device holding an
  // address this box no longer has.
  const givenAt = new Map<string, Set<string>>();
  // Goodbyes `withdraw` started, which `stop()` waits for before closing the socket.
  const sending = new Set<Promise<void>>();
  let stopped = false;

  socket.on("query", (query) => {
    // A stopping responder's answer would re-cache a name its goodbye has just withdrawn.
    if (stopped) return;
    const ours = names();
    // Every query on the network arrives here, so one asking for none of ours allocates nothing.
    let asked: Set<string> | undefined;
    for (const q of query.questions) {
      if ((q.type === "A" || q.type === "ANY") && ours.includes(q.name)) {
        (asked ??= new Set()).add(q.name);
      }
    }
    if (asked === undefined) return;
    const addresses = getAddresses();
    const answers = [...asked].flatMap((name) => buildMdnsAnswers(name, addresses));
    if (answers.length === 0) return;
    for (const name of asked) for (const a of addresses) givenAt.get(name)?.add(a);
    socket.respond({ answers });
  });

  // A failed discovery socket must not stop the HTTP server from serving its IP address.
  socket.on("error", (err) => {
    log("warn", "mdns.socket_error", { message: err.message });
  });

  log("info", "mdns.responding", { hostnames: [...names()] });

  const goodbye = (name: string): Promise<void> => {
    const addresses = givenAt.get(name);
    givenAt.delete(name);
    if (addresses === undefined) return Promise.resolve();
    return new Promise((resolve) => {
      socket.respond({ answers: buildMdnsAnswers(name, [...addresses], 0) }, () => resolve());
    });
  };
  let stopping: Promise<void> | undefined;
  return {
    announce(name) {
      const addresses = getAddresses();
      if (stopped || addresses.length === 0) return;
      const held = givenAt.get(name) ?? new Set();
      for (const a of addresses) held.add(a);
      givenAt.set(name, held);
      socket.respond({ answers: buildMdnsAnswers(name, addresses) });
    },
    withdraw(name) {
      if (stopped) return;
      const sent = goodbye(name).finally(() => sending.delete(sent));
      sending.add(sent);
    },
    stop() {
      stopping ??= (async () => {
        stopped = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.all([...sending, ...[...givenAt.keys()].map(goodbye)]),
          new Promise((resolve) => (timer = setTimeout(resolve, MDNS_GOODBYE_WAIT_MS))),
        ]);
        clearTimeout(timer);
        await new Promise<void>((resolve) => socket.destroy(() => resolve()));
        log("info", "mdns.stopped", {});
      })();
      return stopping;
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
}

export type VenueNameState = "other-box-answers" | "no-other-box" | "not-asked" | "ask-failed";

export interface VenueNameWatch {
  /** `[hostname]` only while the last ask finished and heard no other box, else none. */
  names(): readonly string[];
  state(): VenueNameState;
  stop(): Promise<void>;
}

/** The random delay keeps two boxes switched on together from asking in step for ever. */
export function watchVenueNameInSetup(deps: VenueNameWatchDeps): VenueNameWatch {
  const { hostname } = deps;
  const answering: readonly string[] = [hostname];
  const silent: readonly string[] = [];
  let state: VenueNameState = "not-asked";
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const ask = async (): Promise<void> => {
    try {
      const heardOthers = await askedAndHeardOthers(hostname, {
        makeSocket: deps.makeSocket,
        ownAddresses: deps.ownAddresses,
      });
      state = heardOthers ? "other-box-answers" : "no-other-box";
    } catch {
      // A failed ask is no evidence that the other box has gone.
      if (state !== "other-box-answers") state = "ask-failed";
    }
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
    // Only a finished ask that heard nobody shows that no other box answers the name.
    names: () => (state === "no-other-box" ? answering : silent),
    state: () => state,
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
