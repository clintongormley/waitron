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

export interface ProbeRound {
  moved: boolean;
  anyAccepting: boolean;
}

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
 * The till's follow-the-primary rule, for a Node process. The configured address is always a
 * member, so a bad server list can never strand the agent.
 *
 * A server answering another environment is skipped (CLAUDE.md §5). Unless `environment` is
 * supplied, the pin is taken ONLY from the configured address's own response, and until then the
 * router follows nobody, not even a server that accepts sales: the two environments live in
 * separate databases whose records cannot afterwards be unmixed.
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

  /** The configured address stays first and is never dropped. */
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

  /** Overlapping calls share the round in flight: an older round resolving last would otherwise undo a
   * newer round's move. */
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
      // Keyed by URL, never by list position, so a `merge` mid-round cannot hand one server's
      // answer to another.
      const result = results.get(s.url);
      if (result === undefined) continue;
      if (!result.ok) {
        s.state = "unreachable";
        s.term = null;
        continue;
      }
      const node = result.value;
      if (s.url === this.#configured) this.#environment ??= node.environment;
      s.nodeId = node.nodeId;
      s.term = node.term;
      s.state =
        node.acceptingSales && node.environment === this.#environment ? "primary" : "standby";
    }
    if (this.#environment === undefined) return { moved: false, anyAccepting: false };
    const accepting = this.#servers.filter((s) => s.state === "primary");
    if (accepting.length === 0) return { moved: false, anyAccepting: false };
    // Equal terms take the earlier list entry, never `#current`, to match the till's
    // `ServerRouter`.
    const best = accepting.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
    const moved = best.url !== this.#current;
    this.#current = best.url;
    return { moved, anyAccepting: true };
  }
}
