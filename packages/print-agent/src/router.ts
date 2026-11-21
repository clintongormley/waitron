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
  initialServers?: ServerEntry[];
  probe: AgentClient["probeNode"];
  /** Asked on the configured address in a round where it answers as the spare. */
  mainServer?: AgentClient["mainServer"];
}

export interface ProbeRound {
  moved: boolean;
  anyAccepting: boolean;
  /** Set only when, in this round, the configured address is this box's own loopback and answered
   * as the venue's spare in the pinned environment, whether or not the main box accepts. An agent on
   * a separate machine following the spare is not on the spare itself. */
  configuredIsSpare?: true;
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

/** Matches the hostname the URL parser prints: dotted decimal for any IPv4 spelling, lower case,
 * and an IPv4-mapped IPv6 address in hex (`[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`). */
function isLoopbackOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return (
    host === "localhost" ||
    host === "localhost." ||
    host === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(host) ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(host)
  );
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
  readonly #configuredIsLoopback: boolean;
  readonly #probe: AgentClient["probeNode"];
  readonly #mainServer: AgentClient["mainServer"] | undefined;

  constructor(opts: RouterOptions) {
    const origin = parseHttpOrigin(opts.configuredUrl);
    if (origin === undefined) {
      throw new Error(
        `RouterOptions.configuredUrl must be an http(s) URL, got ${JSON.stringify(opts.configuredUrl)}`,
      );
    }
    this.#configured = origin;
    this.#configuredIsLoopback = isLoopbackOrigin(origin);
    this.#current = origin;
    this.#environment = opts.environment;
    this.#probe = opts.probe;
    this.#mainServer = opts.mainServer;
    this.merge(opts.initialServers ?? []);
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
    const configuredIsSpare = await this.#probeAll(this.#servers);
    if (configuredIsSpare && this.#mainServer !== undefined) {
      const main = await this.#mainServer(this.#configured);
      const origin = main.ok && main.value !== null ? parseHttpOrigin(main.value) : undefined;
      if (origin !== undefined && !this.#servers.some((s) => s.url === origin)) {
        this.merge([...this.#servers, { url: origin }]);
        await this.#probeAll(this.#servers.filter((s) => s.url === origin));
      }
    }
    if (this.#environment === undefined) return { moved: false, anyAccepting: false };
    const spare = configuredIsSpare ? { configuredIsSpare: true as const } : {};
    const accepting = this.#servers.filter((s) => s.state === "primary");
    if (accepting.length === 0) return { moved: false, anyAccepting: false, ...spare };
    // Equal terms take the earlier list entry, never `#current`, to match the till's
    // `ServerRouter`.
    const best = accepting.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
    const moved = best.url !== this.#current;
    this.#current = best.url;
    return { moved, anyAccepting: true, ...spare };
  }

  /** Returns whether the configured address answered as this box's spare. */
  async #probeAll(servers: TrackedServer[]): Promise<boolean> {
    const results = new Map(
      await Promise.all(servers.map(async (s) => [s.url, await this.#probe(s.url)] as const)),
    );
    let configuredIsSpare = false;
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
      if (s.url === this.#configured && this.#configuredIsLoopback) {
        configuredIsSpare =
          !node.acceptingSales &&
          node.environment === this.#environment &&
          node.standing === "serving-secondary";
      }
    }
    return configuredIsSpare;
  }
}
