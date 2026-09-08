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
  /** The environment the agent joined against. Unset until the first successful probe fixes it. */
  environment?: string;
  probe: AgentClient["probeNode"];
}

/**
 * The till's follow-the-primary rule (till-reroute design §4.1), for a Node process: probe every known
 * server, point `current` at the one accepting sales (highest term on a tie), and when none does keep
 * `current` and keep probing — there is no giving up and no failure count. The configured address is
 * always a member, so a bad server list can never strand the agent. A server answering another
 * environment is skipped: an agent must never pull a preproduction venue's jobs from a production node
 * or the reverse (CLAUDE.md §5). Which environment gets fixed can never depend on probe latency: probes
 * run concurrently, but `probe()` applies their results in list order, so a fastest-answering standby
 * can never win the race against the configured address — `#servers[0]`, the venue's own address of
 * record — for deciding it.
 */
export class Router {
  #servers: TrackedServer[] = [];
  #current: string;
  #environment: string | undefined;
  readonly #configured: string;
  readonly #probe: AgentClient["probeNode"];

  constructor(opts: RouterOptions) {
    let parsed: URL;
    try {
      parsed = new URL(opts.configuredUrl);
    } catch {
      throw new Error(
        `RouterOptions.configuredUrl must be an http(s) URL, got ${JSON.stringify(opts.configuredUrl)}`,
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `RouterOptions.configuredUrl must be an http(s) URL, got ${JSON.stringify(opts.configuredUrl)}`,
      );
    }
    this.#configured = parsed.origin;
    this.#current = this.#configured;
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
      let origin: string;
      try {
        const parsed = new URL(entry.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        origin = parsed.origin;
      } catch {
        return;
      }
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

  /** One round: probe every server concurrently, then apply the results IN LIST ORDER — `#servers[0]`
   * is always the configured address (`merge` guarantees it), so which probe resolves first can never
   * decide the environment pin below; only the venue's own address of record can. */
  async probe(): Promise<{ moved: boolean; anyAccepting: boolean }> {
    const results = await Promise.all(this.#servers.map((s) => this.#probe(s.url)));
    results.forEach((result, i) => {
      const s = this.#servers[i];
      if (!result.ok) {
        s.state = "unreachable";
        s.term = null;
        return;
      }
      const node = result.value;
      this.#environment ??= node.environment;
      s.nodeId = node.nodeId;
      s.term = node.term;
      s.state =
        node.acceptingSales && node.environment === this.#environment ? "primary" : "standby";
    });
    const accepting = this.#servers.filter((s) => s.state === "primary");
    if (accepting.length === 0) return { moved: false, anyAccepting: false };
    // Equal terms keep the list-order incumbent (the earlier server), never `#current` itself —
    // deliberate, matching the till's `ServerRouter` (apps/till/src/api/server-router.ts): two
    // implementations of this rule disagreeing on a tie would be worse than the wart.
    const best = accepting.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
    const moved = best.url !== this.#current;
    this.#current = best.url;
    return { moved, anyAccepting: true };
  }
}
