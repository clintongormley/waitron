import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import multicastDns from "multicast-dns";
import { AppError } from "@waitron/shared";
import { isLoopbackHost } from "./primary-url.js";
import { ownInterfaceAddresses } from "./request-from-box.js";
import "./errors.js";

/**
 * The lifetime this box gives its own A records, and the longest a kept answer lives: short so a
 * moved box is re-resolved quickly.
 */
export const MDNS_TTL_SECONDS = 120;

/** A venue has a handful of boxes; asking for many different names cannot grow the store past this. */
const MAX_KEPT_NAMES = 64;

/** A minimal view of a multicast-dns instance used for asking, so lookups can be tested with a fake. */
export interface MdnsQuerySocket {
  on(
    event: "response",
    handler: (response: {
      answers: { name: string; type: string; data: unknown; ttl?: number }[];
    }) => void,
  ): void;
  on(event: "error", handler: (err: Error) => void): void;
  query(query: { questions: { name: string; type: "A" }[] }): void;
  destroy(cb?: () => void): void;
}

export interface BoxLookupOptions {
  timeoutMs?: number;
  makeSocket?: () => MdnsQuerySocket;
  /** Addresses that are this box's own; an answer from one of them is never another box. */
  ownAddresses?: () => string[];
  /** Where answers are kept, so a name is asked once while its kept answer lives. */
  remembered?: RememberedAnswers;
  /** Forget any answer kept for the name and ask the network. */
  fresh?: boolean;
}

/** The addresses a name answered to, and whether they were kept from an earlier ask. */
export interface BoxAddresses {
  addresses: string[];
  remembered: boolean;
}

interface Heard {
  address: string;
  ttlSeconds: number | undefined;
}

/**
 * Answers heard for each name, each kept until the shortest lifetime among its records ends, and
 * never longer than the lifetime a Waitron box gives its own records. Lifetimes are measured on a
 * clock that setting the box's time of day does not move.
 */
export class RememberedAnswers {
  private readonly kept = new Map<string, { addresses: string[]; untilMs: number }>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  get size(): number {
    return this.kept.size;
  }

  recall(hostname: string): string[] | undefined {
    const entry = this.kept.get(hostname.toLowerCase());
    if (entry === undefined) return undefined;
    if (this.now() < entry.untilMs) return entry.addresses;
    this.forget(hostname);
    return undefined;
  }

  forget(hostname: string): void {
    this.kept.delete(hostname.toLowerCase());
  }

  keep(hostname: string, heard: readonly Heard[]): void {
    const lifetimes = heard.map((h) => h.ttlSeconds);
    if (heard.length === 0 || lifetimes.some((ttl) => ttl === undefined || ttl <= 0)) return;
    const shortest = Math.min(MDNS_TTL_SECONDS, ...(lifetimes as number[]));
    const nowMs = this.now();
    const key = hostname.toLowerCase();
    for (const [name, entry] of this.kept) if (nowMs >= entry.untilMs) this.kept.delete(name);
    if (!this.kept.has(key) && this.kept.size >= MAX_KEPT_NAMES) this.dropSoonestToEnd();
    this.kept.set(key, {
      addresses: heard.map((h) => h.address),
      untilMs: nowMs + shortest * 1000,
    });
  }

  private dropSoonestToEnd(): void {
    let soonest: [string, number] | undefined;
    for (const [name, { untilMs }] of this.kept)
      if (soonest === undefined || untilMs < soonest[1]) soonest = [name, untilMs];
    if (soonest !== undefined) this.kept.delete(soonest[0]);
  }
}

const DEFAULT_TIMEOUT_MS = 2000;

/** Read when asked, so an address this box has taken since an answer was kept counts as its own. */
function ownAddressCheck(opts: BoxLookupOptions): (ip: string) => boolean {
  const own = new Set(opts.ownAddresses?.() ?? ownInterfaceAddresses());
  return (ip) => own.has(ip) || isLoopbackHost(ip);
}

/**
 * Asks once for `hostname`'s A record and gathers every other box's IPv4 answered within the time
 * limit. The socket hears this box's own answers too (multicast-dns loops them back), and leaving
 * them out here, rather than switching loopback off, is what lets a box in setup mode hear others
 * answering for the venue's name it also answers for. A socket error rejects with that error: an
 * ask that could not be made heard nothing about who answers.
 */
function askNetwork(
  hostname: string,
  opts: BoxLookupOptions,
  isOwn = ownAddressCheck(opts),
): Promise<Heard[]> {
  const wanted = hostname.toLowerCase();
  const socket = (opts.makeSocket ?? (() => multicastDns() as MdnsQuerySocket))();
  const heard: Heard[] = [];
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (failure?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy(() => (failure === undefined ? resolve(heard) : reject(failure)));
    };
    const timer = setTimeout(finish, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    socket.on("response", (response) => {
      for (const answer of response.answers) {
        if (answer.type !== "A" || answer.name.toLowerCase() !== wanted) continue;
        const ip = answer.data;
        if (typeof ip !== "string" || isIP(ip) !== 4) continue;
        if (isOwn(ip) || heard.some((h) => h.address === ip)) continue;
        heard.push({ address: ip, ttlSeconds: answer.ttl });
      }
    });
    socket.on("error", finish);
    socket.query({ questions: [{ name: hostname, type: "A" }] });
  });
}

/**
 * The addresses another box answers to: a `.local` name is asked of the network and never resolves
 * to this box; any other name goes to the system's lookup; a literal address is itself.
 */
export async function lookupBoxName(
  hostname: string,
  opts: BoxLookupOptions = {},
): Promise<BoxAddresses> {
  if (isIP(hostname) !== 0) return { addresses: [hostname], remembered: false };
  if (!hostname.toLowerCase().endsWith(".local")) {
    const found = await lookup(hostname, { all: true });
    return { addresses: found.map((entry) => entry.address), remembered: false };
  }
  if (opts.fresh === true) opts.remembered?.forget(hostname);
  const isOwn = ownAddressCheck(opts);
  const recalled = opts.remembered?.recall(hostname)?.filter((ip) => !isOwn(ip));
  if (recalled !== undefined && recalled.length > 0)
    return { addresses: recalled, remembered: true };
  if (recalled !== undefined) opts.remembered?.forget(hostname);
  const heard = await askNetwork(hostname, opts, isOwn).catch((): Heard[] => []);
  if (heard.length === 0) throw new AppError("mirror.peer_unresolved", {});
  opts.remembered?.keep(hostname, heard);
  return { addresses: heard.map((h) => h.address), remembered: false };
}

/** Whether any box but this one answers for `hostname`; rejects when the ask could not be made. */
export async function askedAndHeardOthers(
  hostname: string,
  opts: BoxLookupOptions = {},
): Promise<boolean> {
  return (await askNetwork(hostname, opts)).length > 0;
}
