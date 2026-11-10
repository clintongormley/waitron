import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import multicastDns from "multicast-dns";
import { AppError } from "@waitron/shared";
import { isLoopbackHost } from "./primary-url.js";
import "./errors.js";

/** A minimal view of a multicast-dns instance used for asking, so lookups can be tested with a fake. */
export interface MdnsQuerySocket {
  on(
    event: "response",
    handler: (response: { answers: { name: string; type: string; data: unknown }[] }) => void,
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
}

const DEFAULT_TIMEOUT_MS = 2000;

function interfaceAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? []).map((entry) => entry.address.replace(/%.*$/, "")),
  );
}

/**
 * Asks once for `hostname`'s A record and gathers every other box's IPv4 answered within the time
 * limit. The socket hears this box's own answers too (multicast-dns loops them back), and leaving
 * them out here, rather than switching loopback off, is what lets a box in setup mode hear others
 * answering for the venue's name it also answers for.
 */
function askNetwork(hostname: string, opts: BoxLookupOptions): Promise<string[]> {
  const own = new Set((opts.ownAddresses ?? interfaceAddresses)());
  const wanted = hostname.toLowerCase();
  const socket = (opts.makeSocket ?? (() => multicastDns() as MdnsQuerySocket))();
  const heard: string[] = [];
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy(() => resolve(heard));
    };
    const timer = setTimeout(finish, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    socket.on("response", (response) => {
      for (const answer of response.answers) {
        if (answer.type !== "A" || answer.name.toLowerCase() !== wanted) continue;
        const ip = answer.data;
        if (typeof ip !== "string" || isIP(ip) !== 4) continue;
        if (own.has(ip) || isLoopbackHost(ip) || heard.includes(ip)) continue;
        heard.push(ip);
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
  const heard = await askNetwork(hostname, opts);
  if (heard.length === 0) throw new AppError("mirror.peer_unresolved", { hostname });
  return heard;
}

/** Whether any box but this one answers for `hostname`. */
export async function askedAndHeardOthers(
  hostname: string,
  opts: BoxLookupOptions = {},
): Promise<boolean> {
  return (await askNetwork(hostname, opts)).length > 0;
}
