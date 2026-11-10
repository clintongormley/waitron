import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import multicastDns from "multicast-dns";
import { AppError } from "@waitron/shared";
import { isLoopbackHost } from "./primary-url.js";
import { ownInterfaceAddresses } from "./request-from-box.js";
import "./errors.js";

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
  /** Where answers are kept for the lifetime their records give, so a name is asked once in it. */
  remembered?: RememberedAnswers;
}

interface Heard {
  address: string;
  ttlSeconds: number | undefined;
}

/** Answers heard for each name, each kept until the shortest lifetime among its records ends. */
export class RememberedAnswers {
  private readonly kept = new Map<string, { addresses: string[]; untilMs: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  recall(hostname: string): string[] | undefined {
    const entry = this.kept.get(hostname.toLowerCase());
    if (entry === undefined) return undefined;
    if (this.now() < entry.untilMs) return entry.addresses;
    this.kept.delete(hostname.toLowerCase());
    return undefined;
  }

  keep(hostname: string, heard: readonly Heard[]): void {
    const lifetimes = heard.map((h) => h.ttlSeconds);
    if (heard.length === 0 || lifetimes.some((ttl) => ttl === undefined || ttl <= 0)) return;
    const shortest = Math.min(...(lifetimes as number[]));
    this.kept.set(hostname.toLowerCase(), {
      addresses: heard.map((h) => h.address),
      untilMs: this.now() + shortest * 1000,
    });
  }
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Asks once for `hostname`'s A record and gathers every other box's IPv4 answered within the time
 * limit. The socket hears this box's own answers too (multicast-dns loops them back), and leaving
 * them out here, rather than switching loopback off, is what lets a box in setup mode hear others
 * answering for the venue's name it also answers for. A socket error rejects with that error: an
 * ask that could not be made heard nothing about who answers.
 */
function askNetwork(hostname: string, opts: BoxLookupOptions): Promise<Heard[]> {
  const own = new Set(opts.ownAddresses?.() ?? ownInterfaceAddresses());
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
        if (own.has(ip) || isLoopbackHost(ip) || heard.some((h) => h.address === ip)) continue;
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
): Promise<string[]> {
  if (isIP(hostname) !== 0) return [hostname];
  if (!hostname.toLowerCase().endsWith(".local")) {
    const found = await lookup(hostname, { all: true });
    return found.map((entry) => entry.address);
  }
  const recalled = opts.remembered?.recall(hostname);
  if (recalled !== undefined) return recalled;
  const heard = await askNetwork(hostname, opts).catch((): Heard[] => []);
  if (heard.length === 0) throw new AppError("mirror.peer_unresolved", {});
  opts.remembered?.keep(hostname, heard);
  return heard.map((h) => h.address);
}

/** Whether any box but this one answers for `hostname`; rejects when the ask could not be made. */
export async function askedAndHeardOthers(
  hostname: string,
  opts: BoxLookupOptions = {},
): Promise<boolean> {
  return (await askNetwork(hostname, opts)).length > 0;
}
