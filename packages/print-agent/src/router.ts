import type { AgentClient, ServerEntry } from "./client.js";

export type ServerState = "unknown" | "unreachable" | "standby" | "primary";

export interface TrackedServer {
  url: string;
  nodeId?: string;
  state: ServerState;
  term: number | null;
}

export interface RouterOptions {
  configuredUrl: string;
  /** The environment the agent joined against. Unset until the CONFIGURED address's own first
   * successful probe fixes it. */
  environment?: string;
  probe: AgentClient["probeNode"];
}

/** What one {@link Router.probe} round decided: whether `current` changed, and whether any server in
 * this agent's environment is accepting sales. */
export interface ProbeRound {
  moved: boolean;
  anyAccepting: boolean;
}

/** The origin of an http(s) URL, `undefined` for anything else. The constructor turns that into a
 * throw naming the option; `merge` turns it into a silent skip. */
function parseHttpOrigin(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return parsed.origin;
}

/**
 * The till's follow-the-primary rule (till-reroute design §4.1), for a Node process: probe every known
 * server, point `current` at the one accepting sales (highest term on a tie), and when none does keep
 * `current` and keep probing — there is no giving up and no failure count. The configured address is
 * always a member, so a bad server list can never strand the agent.
 *
 * A server answering another environment is skipped: an agent must never pull a preproduction venue's
 * jobs from a production node or the reverse (CLAUDE.md §5). When no environment was supplied, the pin
 * is taken ONLY from a successful response by the configured address — `#servers[0]`, the venue's own
 * address of record — and until that has happened the router follows nobody, not even a server that
 * accepts sales. The availability cost is deliberate and bounded: an agent that has never once reached
 * its own address of record cannot know which environment it belongs to, and the two live in separate
 * databases whose records cannot afterwards be unmixed.
 *
 * Rounds are ordered even though the probes within one run concurrently: overlapping `probe()` calls
 * share the single in-flight round (as the till's `ServerRouter.probeNow` does), and each result is
 * applied to the URL it was issued for. So a `merge` landing mid-round can neither hand one server's
 * answer to another nor let an older round undo a newer round's move.
 */
export class Router {
  #servers: TrackedServer[] = [];
  #current: string;
  #environment: string | undefined;
  #round: Promise<ProbeRound> | undefined;
  readonly #configured: string;
  readonly #probe: AgentClient["probeNode"];

  constructor(opts: RouterOptions) {
    const origin = parseHttpOrigin(opts.configuredUrl);
    if (origin === undefined) {
      throw new Error(
        `RouterOptions.configuredUrl must be an http(s) URL, got ${JSON.stringify(opts.configuredUrl)}`,
      );
    }
    this.#configured = origin;
    this.#current = origin;
    this.#environment = opts.environment;
    this.#probe = opts.probe;
    this.merge([]);
  }

  get current(): string {
    return this.#current;
  }
  get environment(): string | undefined {
    return this.#environment;
  }
  servers(): TrackedServer[] {
    return this.#servers.map((s) => ({ ...s }));
  }

  /** Merge a server list into the known set: by origin, the configured address first and never dropped,
   * earlier state kept for a server already known, malformed and non-http entries ignored. */
  merge(list: ServerEntry[]): void {
    const byUrl = new Map(this.#servers.map((s) => [s.url, s]));
    const next: TrackedServer[] = [];
    const push = (entry: ServerEntry): void => {
      const origin = parseHttpOrigin(entry.url);
      if (origin === undefined) return;
      if (next.some((n) => n.url === origin)) return;
      const prev = byUrl.get(origin);
      next.push({
        url: origin,
        nodeId: entry.nodeId ?? prev?.nodeId,
        state: prev?.state ?? "unknown",
        term: prev?.term ?? null,
      });
    };
    push({ url: this.#configured });
    for (const entry of list) push(entry);
    this.#servers = next;
  }

  /** One probe round over every known server. Overlapping calls share the round already in flight
   * rather than starting a second: two rounds mutating `#servers[].state` in place would let the older
   * one, resolving last, overwrite the newer one's target and undo a move — the till guards this the
   * same way (`ServerRouter.probeNow`, apps/till/src/api/server-router.ts). */
  probe(): Promise<ProbeRound> {
    this.#round ??= this.#runRound().finally(() => {
      this.#round = undefined;
    });
    return this.#round;
  }

  async #runRound(): Promise<ProbeRound> {
    const results = new Map(
      await Promise.all(this.#servers.map(async (s) => [s.url, await this.#probe(s.url)] as const)),
    );
    for (const s of this.#servers) {
      // Keyed by URL, never by list position: a `merge` that landed while this round was in flight
      // leaves a server with no result of its own (left `unknown` — applying another server's answer
      // to it is the defect this lookup prevents), and drops the result of a server it removed.
      const result = results.get(s.url);
      if (result === undefined) continue;
      if (!result.ok) {
        s.state = "unreachable";
        s.term = null;
        continue;
      }
      const node = result.value;
      // Only the venue's own address of record fixes the pin (see the class header).
      if (s.url === this.#configured) this.#environment ??= node.environment;
      s.nodeId = node.nodeId;
      s.term = node.term;
      s.state =
        node.acceptingSales && node.environment === this.#environment ? "primary" : "standby";
    }
    // Stated as its own rule rather than left to fall out of the state assignment above: while the
    // environment is unpinned the agent follows nobody, whatever any server answered.
    if (this.#environment === undefined) return { moved: false, anyAccepting: false };
    const accepting = this.#servers.filter((s) => s.state === "primary");
    if (accepting.length === 0) return { moved: false, anyAccepting: false };
    // Equal terms take the earlier list entry, never `#current` itself — deliberate, matching the
    // till's `ServerRouter` (apps/till/src/api/server-router.ts): two implementations of this rule
    // disagreeing on a tie would be worse than the wart.
    const best = accepting.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
    const moved = best.url !== this.#current;
    this.#current = best.url;
    return { moved, anyAccepting: true };
  }
}
