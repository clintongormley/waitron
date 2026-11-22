export type ServerState = "unknown" | "unreachable" | "standby" | "primary";
export type ServerStanding = "serving-primary" | "serving-secondary" | "sell-only";
export interface ServerEntry {
  nodeId?: string;
  url: string;
  standing?: ServerStanding;
}
export interface ServerStatus {
  url: string;
  label: string;
  state: ServerState;
  term: number | null;
}
/** A signed membership chart as the start read carries it. The till reads only its term; the box
 * it is handed to verifies it. */
export interface HeldChart {
  readonly body: { readonly term: number };
}
export interface RouterOptions {
  origin: string;
  fetchImpl: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
  intervalMs?: number;
  timeoutMs?: number;
}

export const SERVERS_STORAGE_KEY = "waitron.servers";

/** How long the main box stays silent before the till offers the spare. */
export const MAIN_SILENT_MS = 20_000;

export const NO_BOX_ANSWERING = "server.waiting_sales";

/** Reading `localStorage` itself throws in a browser that blocks site data. */
function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const STANDINGS: readonly unknown[] = ["serving-primary", "serving-secondary", "sell-only"];

interface Tracked {
  url: string;
  nodeId?: string;
  standing?: ServerStanding;
  label: string;
  state: ServerState;
  term: number | null;
  /** Whether the latest probe got any HTTP answer; `null` before the first. */
  answered: boolean | null;
  /** The first unanswered probe since the latest answered one. */
  silentSince: number | null;
  /** When a probe last got an HTTP answer from this box, or from the page origin answering as the
   * box it last said it was. */
  lastAnsweredAt: number | null;
}

/** No failure count ends probing (owner decision, 2026-09-05). */
export class ServerRouter extends EventTarget {
  #servers: Tracked[];
  #current: string;
  #waiting = false;
  /** Set when the latest round found a box taking sales but an in-flight request kept the till where
   * it was. */
  #moveHeld = false;
  /** The initial `""` never equals a real signature, so the first change always dispatches. */
  #stateSignature = "";
  #chart: HeldChart | null = null;
  /** The node id the page origin's latest probe answered with; an entry the chart gives that id is
   * neither probed, drawn nor chosen while it holds. */
  #originNodeId: string | undefined;
  #emergencyMainId: string | undefined;
  /** `url chart-term answered-term` triples already posted: a server is handed each held chart
   * once per answer, so a box that refused it while answering no term is handed it again once it
   * answers its own older term. */
  readonly #chartSent = new Set<string>();
  #inFlight = 0;
  #round: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #started = false;
  #live = false;
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
    const saved = this.#load();
    this.#rememberEmergencyMain(saved);
    this.#servers = this.#merge(saved);
  }

  get current(): string {
    return this.#current;
  }
  get waiting(): boolean {
    return this.#waiting;
  }

  /** The box requests go to did not answer its latest probe, and either no box took sales in the
   * latest round or an in-flight request kept the till from moving to the one that did. */
  get refusesNewRequests(): boolean {
    if (!this.#waiting && !this.#moveHeld) return false;
    return this.#servers.find((s) => s.url === this.#current)?.answered === false;
  }

  get mainSilentSince(): number | null {
    const main = this.#withStanding("serving-primary");
    return main === undefined || this.#hidden(main) ? null : main.silentSince;
  }

  get mainLastAnsweredAt(): number | null {
    return this.#withStanding("serving-primary")?.lastAnsweredAt ?? null;
  }

  get spare(): { url: string; answering: boolean } | undefined {
    const spare = this.#withStanding("serving-secondary");
    if (spare === undefined) return undefined;
    return { url: spare.url, answering: this.#hidden(spare) || spare.answered === true };
  }

  /** One probe of the main box that leaves the router's states alone. */
  async probeMain(): Promise<boolean> {
    const main = this.#withStanding("serving-primary");
    if (main === undefined) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const fetchImpl = this.#fetch;
      await fetchImpl(`${main.url}/api/node`, { signal: controller.signal, cache: "no-store" });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async probeEmergencyMain(): Promise<boolean> {
    const mainId = this.#emergencyMainId;
    if (mainId === undefined) return false;
    const urls = new Set([
      this.#origin,
      ...this.#servers
        .filter((s) => s.nodeId === mainId || s.standing === "serving-primary")
        .map((s) => s.url),
    ]);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const answers = new Promise<boolean>((resolve) => {
        void Promise.all(
          [...urls].map(async (url) => {
            try {
              const fetchImpl = this.#fetch;
              const response = await fetchImpl(`${url}/api/node`, {
                signal: controller.signal,
                cache: "no-store",
              });
              if (!response.ok) return false;
              const body: unknown = await response.json();
              const matched =
                body !== null &&
                typeof body === "object" &&
                "nodeId" in body &&
                body.nodeId === mainId;
              if (matched) resolve(true);
              return matched;
            } catch {
              return false;
            }
          }),
        ).then(() => resolve(false));
      });
      return await Promise.race([
        answers,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), this.#timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  #rememberEmergencyMain(list: ServerEntry[]): void {
    const id = list.find((s) => s.standing === "serving-primary")?.nodeId;
    this.#emergencyMainId = typeof id === "string" && id !== "" ? id : undefined;
  }

  #withStanding(standing: ServerStanding): Tracked | undefined {
    return this.#servers.find((s) => s.standing === standing);
  }

  /** A hidden entry is the node the page's origin just answered as. */
  #hidden(s: Tracked): boolean {
    return s.nodeId !== undefined && s.nodeId === this.#originNodeId;
  }

  statuses(): ServerStatus[] {
    return this.#shown().map((s) => ({
      url: s.url,
      label: s.label,
      state: s.state,
      term: s.term,
    }));
  }

  setServers(list: ServerEntry[]): void {
    this.#rememberEmergencyMain(list);
    this.#servers = this.#merge(list);
    this.#save(list);
    this.#syncTimer();
    this.#emitStateChanged();
  }

  setLive(up: boolean): void {
    if (this.#live === up) return;
    this.#live = up;
    this.#syncTimer();
  }

  /** Keeps the newer of this chart and the one held, to hand to a server that answers an older term
   * or none. */
  offerChart(chart: HeldChart | null | undefined): void {
    if (typeof chart?.body?.term !== "number") return;
    if (this.#chart === null || chart.body.term > this.#chart.body.term) this.#chart = chart;
  }

  start(): void {
    this.#started = true;
    this.#syncTimer();
  }

  stop(): void {
    this.#started = false;
    this.#syncTimer();
  }

  #syncTimer(): void {
    if (!this.#started || (this.#live && !this.#waiting && this.#shown().length === 1)) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    } else if (this.#timer === undefined) {
      this.#timer = setInterval(() => void this.probeNow(), this.#intervalMs);
      void this.probeNow();
    }
  }

  beginRequest(): void {
    this.#inFlight += 1;
  }
  endRequest(): void {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
  }

  /** Overlapping calls share the in-flight round: two rounds mutating `#servers[].state` in place would
   * let an older round resolving last undo a newer round's move. */
  probeNow(): Promise<void> {
    if (this.#round === undefined) {
      this.#round = this.#runRound().finally(() => {
        this.#round = undefined;
      });
    }
    return this.#round;
  }

  async #runRound(): Promise<void> {
    const probed = this.#shown();
    // A hidden line keeps no old answer to be drawn with once the page's answer unhides it.
    for (const s of this.#servers) {
      if (!probed.includes(s)) {
        s.state = "unknown";
        s.term = null;
        s.answered = null;
        s.silentSince = null;
      }
    }
    await Promise.all(probed.map((s) => this.#probe(s)));
    // The page's probe can unhide a box's line; probe it now so the till can follow that box in
    // this round.
    await Promise.all(
      this.#shown()
        .filter((s) => !probed.includes(s))
        .map((s) => this.#probe(s)),
    );
    const yes = this.#shown().filter((s) => s.state === "primary");
    this.#waiting = yes.length === 0;
    this.#moveHeld = false;
    if (yes.length > 0) {
      const best = yes.reduce((a, b) => ((b.term ?? -1) > (a.term ?? -1) ? b : a));
      if (best.url !== this.#current) this.#move(best.url);
    }
    this.#syncTimer();
    this.#emitStateChanged();
  }

  #shown(): Tracked[] {
    const own = this.#originNodeId;
    if (own === undefined) return this.#servers;
    return this.#servers.filter((s) => s.nodeId !== own);
  }

  /** Dispatch only when the rendered state changed, so a steady probe round drives no repaint. */
  #emitStateChanged(): void {
    const signature = JSON.stringify({
      statuses: this.statuses(),
      waiting: this.#waiting,
      current: this.#current,
      standings: this.#servers.map((s) => s.standing ?? null),
      mainSilentSince: this.mainSilentSince,
      spare: this.spare ?? null,
    });
    if (signature === this.#stateSignature) return;
    this.#stateSignature = signature;
    this.dispatchEvent(new Event("state-changed"));
  }

  #move(to: string): void {
    if (this.#inFlight > 0) {
      this.#moveHeld = true; // a later round recomputes the target once #inFlight hits 0
      return;
    }
    const from = this.#current;
    this.#current = to;
    this.dispatchEvent(new CustomEvent("server-changed", { detail: { from, to } }));
  }

  async #probe(s: Tracked): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let answered = false;
    try {
      // Call the injected fetch as a plain function. `this.#fetch(...)` would bind `this` to the router;
      // Chromium's native window.fetch rejects that receiver before sending the request.
      const fetchImpl = this.#fetch;
      const res = await fetchImpl(`${s.url}/api/node`, {
        signal: controller.signal,
        cache: "no-store",
      });
      answered = true;
      s.answered = true;
      s.silentSince = null;
      s.lastAnsweredAt = Date.now();
      if (!res.ok) {
        this.#heardThroughOrigin(s);
        this.#forgetOriginNode(s);
        s.state = "unreachable";
        s.term = null;
        return;
      }
      const body = (await res.json()) as {
        acceptingSales?: unknown;
        term?: unknown;
        nodeId?: unknown;
      };
      if (s.url === this.#origin) {
        this.#originNodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
        this.#heardThroughOrigin(s);
      }
      s.state = body.acceptingSales === true ? "primary" : "standby";
      s.term = typeof body.term === "number" ? body.term : null;
      this.#handChart(s.url, s.term);
    } catch {
      if (!answered) {
        s.answered = false;
        s.silentSince ??= startedAt;
      } else {
        this.#heardThroughOrigin(s);
      }
      this.#forgetOriginNode(s);
      s.state = "unreachable";
      s.term = null;
    } finally {
      clearTimeout(timer);
    }
  }

  #heardThroughOrigin(s: Tracked): void {
    const own = this.#originNodeId;
    if (s.url !== this.#origin || own === undefined) return;
    for (const hidden of this.#servers) {
      if (hidden.nodeId === own && hidden !== s) hidden.lastAnsweredAt = s.lastAnsweredAt;
    }
  }

  /** The entry the origin stood in for inherits the origin's silence, so a silent main box is
   * counted from the origin's first unanswered probe, not from its own first probe after this. */
  #forgetOriginNode(s: Tracked): void {
    if (s.url !== this.#origin) return;
    const own = this.#originNodeId;
    this.#originNodeId = undefined;
    if (own === undefined || s.silentSince === null) return;
    for (const hidden of this.#servers) {
      if (hidden.nodeId === own && hidden !== s) hidden.silentSince ??= s.silentSince;
    }
  }

  /** Fire and forget, and never moves the till. A post answered with a 2xx or 4xx status is not sent
   * again for the same answer; one answered with a 5xx status, or that failed in transit, is tried
   * again on a later probe round. */
  #handChart(url: string, term: number | null): void {
    const chart = this.#chart;
    if (chart === null || (term !== null && term >= chart.body.term)) return;
    const key = `${url} ${chart.body.term} ${term ?? "none"}`;
    if (this.#chartSent.has(key)) return;
    this.#chartSent.add(key);
    const fetchImpl = this.#fetch;
    void Promise.resolve()
      .then(() =>
        fetchImpl(`${url}/api/node/membership`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ document: chart }),
          cache: "no-store",
        }),
      )
      .then(
        (res) => {
          if (res.status >= 500) this.#chartSent.delete(key);
        },
        () => {
          this.#chartSent.delete(key);
        },
      );
  }

  #merge(list: ServerEntry[]): Tracked[] {
    const byUrl = new Map<string, Tracked>();
    for (const s of this.#servers ?? []) byUrl.set(s.url, s);
    const next: Tracked[] = [];
    const push = (e: ServerEntry) => {
      const parsed = new URL(e.url);
      // Only an http(s) URL names a server to probe; an opaque-origin one such as mailto: or data:
      // has the literal origin "null".
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      const url = parsed.origin;
      const standing = STANDINGS.includes(e.standing) ? e.standing : undefined;
      const already = next.find((n) => n.url === url);
      if (already !== undefined) {
        already.standing ??= standing;
        return;
      }
      const prev = byUrl.get(url);
      if (prev !== undefined) {
        // A probe mutates this tracked object after its fetch resolves. Retain it when getTill refreshes
        // the same URL mid-probe so that successful result remains in the active list.
        prev.nodeId = e.nodeId;
        prev.standing = standing;
        next.push(prev);
      } else {
        next.push({
          url,
          nodeId: e.nodeId,
          standing,
          label: parsed.hostname,
          state: "unknown",
          term: null,
          answered: null,
          silentSince: null,
          lastAnsweredAt: null,
        });
      }
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
      return [];
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

/** A fetch wrapper, so the TillApi keeps `baseUrl = ""` and never learns that more than one server
 * exists. */
export function withServerTarget(fetchImpl: typeof fetch, router: ServerRouter): typeof fetch {
  return async (input, init) => {
    const relative = typeof input === "string" && input.startsWith("/");
    // Only a request starting now is refused: one already sent, such as a card payment, keeps waiting.
    if (relative && router.refusesNewRequests)
      return new Response(JSON.stringify({ error: { code: NO_BOX_ANSWERING } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    const target = relative ? `${router.current}${input}` : input;
    router.beginRequest();
    try {
      return await fetchImpl(target, init);
    } finally {
      router.endRequest();
    }
  };
}
