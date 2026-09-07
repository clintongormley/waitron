export type ServerState = "unknown" | "unreachable" | "standby" | "primary";
export interface ServerEntry {
  nodeId?: string;
  url: string;
}
export interface ServerStatus {
  url: string;
  label: string;
  state: ServerState;
  term: number | null;
}
export interface RouterOptions {
  origin: string;
  fetchImpl: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
  intervalMs?: number;
  timeoutMs?: number;
}

export const SERVERS_STORAGE_KEY = "waitron.servers";

/** The bare `localStorage` access itself throws (SecurityError) in a browser that blocks site data, so
 * the default acquisition degrades to memory-only exactly like `#load`/`#save`. */
function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

interface Tracked extends ServerEntry {
  label: string;
  state: ServerState;
  term: number | null;
}

/**
 * The one place the till knows more than one server exists (till-reroute design §4.1). It holds the
 * venue's server list, probes every server each round, and points `current` at whichever answered
 * `acceptingSales: true` — the highest `term` if several. If none did, `current` stays where it is and
 * the till keeps probing: there is no giving up on a server and no failure count (owner, 2026-09-05).
 * The page's own origin is always listed, so a stale or empty cache still reaches the box.
 */
export class ServerRouter extends EventTarget {
  #servers: Tracked[];
  #current: string;
  #waiting = false;
  #inFlight = 0;
  #round: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;

  constructor(opts: RouterOptions) {
    super();
    this.#origin = opts.origin;
    this.#fetch = opts.fetchImpl;
    this.#storage = opts.storage ?? defaultStorage();
    this.#intervalMs = opts.intervalMs ?? 5_000;
    this.#timeoutMs = opts.timeoutMs ?? 3_000;
    this.#current = opts.origin;
    this.#servers = this.#merge(this.#load());
  }

  get current(): string {
    return this.#current;
  }
  get waiting(): boolean {
    return this.#waiting;
  }

  statuses(): ServerStatus[] {
    return this.#servers.map((s) => ({
      url: s.url,
      label: s.label,
      state: s.state,
      term: s.term,
    }));
  }

  setServers(list: ServerEntry[]): void {
    this.#servers = this.#merge(list);
    this.#save(list);
    this.dispatchEvent(new Event("state-changed"));
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => void this.probeNow(), this.#intervalMs);
    void this.probeNow();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  beginRequest(): void {
    this.#inFlight += 1;
  }
  endRequest(): void {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
  }

  /** One probe round over every listed server, then the target rule (§4.1). Overlapping calls share
   * the in-flight round: two rounds mutating `#servers[].state` in place would let an older round
   * resolving last overwrite a newer round's target and undo a move (reachable once S5 calls this while
   * the interval round is in flight). */
  probeNow(): Promise<void> {
    if (this.#round === undefined) {
      this.#round = this.#runRound().finally(() => {
        this.#round = undefined;
      });
    }
    return this.#round;
  }

  async #runRound(): Promise<void> {
    await Promise.all(this.#servers.map((s) => this.#probe(s)));
    const yes = this.#servers.filter((s) => s.state === "primary");
    this.#waiting = yes.length === 0;
    if (yes.length > 0) {
      const best = yes.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
      if (best.url !== this.#current) this.#move(best.url);
    }
    this.dispatchEvent(new Event("state-changed"));
  }

  #move(to: string): void {
    if (this.#inFlight > 0) return; // a later round recomputes the target once #inFlight hits 0
    const from = this.#current;
    this.#current = to;
    this.dispatchEvent(new CustomEvent("server-changed", { detail: { from, to } }));
  }

  async #probe(s: Tracked): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const res = await this.#fetch(`${s.url}/api/node`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        s.state = "unreachable";
        s.term = null;
        return;
      }
      const body = (await res.json()) as {
        acceptingSales?: unknown;
        term?: unknown;
        nodeId?: unknown;
      };
      s.state = body.acceptingSales === true ? "primary" : "standby";
      s.term = typeof body.term === "number" ? body.term : null;
      if (typeof body.nodeId === "string") s.nodeId = body.nodeId;
    } catch {
      s.state = "unreachable";
      s.term = null;
    } finally {
      clearTimeout(timer);
    }
  }

  #merge(list: ServerEntry[]): Tracked[] {
    const byUrl = new Map<string, Tracked>();
    for (const s of this.#servers ?? []) byUrl.set(s.url, s);
    const next: Tracked[] = [];
    const push = (e: ServerEntry) => {
      const parsed = new URL(e.url);
      // Opaque-origin URLs (mailto:/data:/file:) yield the literal origin "null", which statuses()
      // would later feed to new URL() and crash the render — treat them like a malformed URL: drop.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      const url = parsed.origin;
      if (next.some((n) => n.url === url)) return;
      const prev = byUrl.get(url);
      next.push({
        url,
        label: parsed.hostname,
        nodeId: e.nodeId ?? prev?.nodeId,
        state: prev?.state ?? "unknown",
        term: prev?.term ?? null,
      });
    };
    push({ url: this.#origin });
    for (const e of list) {
      try {
        push(e);
      } catch {
        /* a malformed url is dropped, never fatal */
      }
    }
    return next;
  }

  #load(): ServerEntry[] {
    try {
      const raw = this.#storage?.getItem(SERVERS_STORAGE_KEY);
      if (raw === null || raw === undefined) return [];
      const parsed = JSON.parse(raw) as { servers?: unknown };
      return Array.isArray(parsed.servers)
        ? (parsed.servers as ServerEntry[]).filter((e) => typeof e?.url === "string")
        : [];
    } catch {
      return []; // unreadable/blocked storage or bad JSON: start empty (the page origin still merges in)
    }
  }

  #save(list: ServerEntry[]): void {
    try {
      this.#storage?.setItem(SERVERS_STORAGE_KEY, JSON.stringify({ servers: list }));
    } catch {
      /* private window / blocked storage: the list lives in memory for this page */
    }
  }
}

/** Apply the router as a fetch wrapper (§4.1): the TillApi keeps `baseUrl = ""` and never learns that
 * more than one server exists. Only an absolute-path (`/`-rooted, not `//`) relative request is
 * rewritten; the TillApi issues only those, and each is unchanged while `current` is the page origin. */
export function withServerTarget(fetchImpl: typeof fetch, router: ServerRouter): typeof fetch {
  return async (input, init) => {
    const target =
      typeof input === "string" && input.startsWith("/") ? `${router.current}${input}` : input;
    router.beginRequest();
    try {
      return await fetchImpl(target, init);
    } finally {
      router.endRequest();
    }
  };
}
