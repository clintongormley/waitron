import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVERS_STORAGE_KEY, ServerRouter, withServerTarget } from "./server-router.js";

const BOX = "https://box.deli.test";
const CLOUD = "https://cloud.deli.test";

type Answer = { acceptingSales: boolean; term: number | null; nodeId?: string } | "down";

/** A fetch that answers /api/node per origin from a mutable table; "down" rejects like a dead host. */
function probeFetch(table: Record<string, Answer>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const a = table[url.origin];
    if (a === undefined || a === "down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ ...a, standing: null, environment: "preproduction" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("ServerRouter", () => {
  it("starts on the page origin and stays there when a round has no yes anywhere (a blip moves nothing)", async () => {
    const table: Record<string, Answer> = {
      [BOX]: "down",
      [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([
      { nodeId: "b", url: BOX },
      { nodeId: "c", url: CLOUD },
    ]);
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);
    await r.probeNow();
    expect(r.current).toBe(BOX);
    expect(r.waiting).toBe(true);
    expect(moved).not.toHaveBeenCalled();
    expect(r.statuses()).toEqual([
      { url: BOX, label: "box.deli.test", state: "unreachable", term: null },
      { url: CLOUD, label: "cloud.deli.test", state: "standby", term: 1 },
    ]);
  });

  it("moves to the first server that says yes, in the round it says it", async () => {
    const table: Record<string, Answer> = {
      [BOX]: "down",
      [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    table[CLOUD] = { acceptingSales: true, term: 2, nodeId: "c" };
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    expect(r.waiting).toBe(false);
    expect(moved).toHaveBeenCalledTimes(1);
    expect((moved.mock.calls[0]![0] as CustomEvent).detail).toEqual({ from: BOX, to: CLOUD });
  });

  it("moves back when the box says yes and the cloud says no", async () => {
    const table: Record<string, Answer> = {
      [BOX]: { acceptingSales: false, term: 3, nodeId: "b" },
      [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    table[BOX] = { acceptingSales: true, term: 3, nodeId: "b" };
    table[CLOUD] = { acceptingSales: false, term: 3, nodeId: "c" };
    await r.probeNow();
    expect(r.current).toBe(BOX);
  });

  it("prefers the higher term when two servers both say yes", async () => {
    const table: Record<string, Answer> = {
      [BOX]: { acceptingSales: true, term: 1, nodeId: "b" },
      [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });

  it("does not move while a request is in flight; moves on the next round", async () => {
    const table: Record<string, Answer> = {
      [BOX]: "down",
      [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    r.beginRequest();
    await r.probeNow();
    expect(r.current).toBe(BOX);
    r.endRequest();
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });

  it("times out a hanging probe as unreachable", async () => {
    const hanging = vi.fn(
      (_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    ) as unknown as typeof fetch;
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: hanging,
      storage: memoryStorage(),
      timeoutMs: 20,
    });
    await r.probeNow();
    expect(r.statuses()[0]?.state).toBe("unreachable");
  });

  it("calls the injected fetch as a function instead of rebinding it to the router", async () => {
    const receivers: unknown[] = [];
    const receiverSensitiveFetch = async function (this: unknown): Promise<Response> {
      receivers.push(this);
      return new Response(JSON.stringify({ acceptingSales: true, term: null, nodeId: "local" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } as typeof fetch;
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: receiverSensitiveFetch,
      storage: memoryStorage(),
    });

    await r.probeNow();

    // Browser-native fetch rejects when called with the ServerRouter as its receiver; ordinary test
    // doubles ignore `this`.
    expect(receivers).toEqual([undefined]);
    expect(r.statuses()[0]?.state).toBe("primary");
  });

  it("degrades to memory when the DEFAULT localStorage global throws on access (blocked site data)", () => {
    // A browser that blocks site data throws on the bare `localStorage` access itself, not only on
    // getItem/setItem.
    const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}) });
      expect(r.statuses().map((s) => s.url)).toEqual([BOX]);
    } finally {
      if (prev) Object.defineProperty(globalThis, "localStorage", prev);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("coalesces an overlapping probeNow into the in-flight round (an older round cannot undo a move)", async () => {
    const calls: string[] = [];
    const resolvers: Array<() => void> = [];
    const gated = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      calls.push(url.origin);
      const yes = url.origin === CLOUD;
      return new Promise<Response>((res) => {
        resolvers.push(() =>
          res(
            new Response(
              JSON.stringify({ acceptingSales: yes, term: yes ? 2 : null, nodeId: "x" }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
        );
      });
    }) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl: gated, storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    const first = r.probeNow();
    const second = r.probeNow();
    expect(second).toBe(first);
    for (const done of resolvers) done();
    await Promise.all([first, second]);
    expect(calls).toEqual([BOX, CLOUD]);
    expect(r.current).toBe(CLOUD);
  });

  it("keeps an in-flight probe attached when getTill refreshes the same server list", async () => {
    let answer!: () => void;
    const pendingFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = () =>
            resolve(
              new Response(JSON.stringify({ acceptingSales: true, term: null, nodeId: "local" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
        }),
    ) as unknown as typeof fetch;
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: pendingFetch,
      storage: memoryStorage(),
    });

    // main.ts starts the probe before till-app's getTill response supplies its server list. Refreshing
    // that list must retain the object the probe is updating, or this successful answer is discarded.
    const round = r.probeNow();
    r.setServers([]);
    answer();
    await round;

    expect(r.waiting).toBe(false);
    expect(r.statuses()).toEqual([
      { url: BOX, label: "box.deli.test", state: "primary", term: null },
    ]);
  });

  it("drops a non-http(s) server entry instead of crashing statuses()", () => {
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch({}),
      storage: memoryStorage(),
    });
    r.setServers([{ url: "mailto:x@y" }, { url: CLOUD }]);
    expect(() => r.statuses()).not.toThrow();
    expect(r.statuses().map((s) => s.url)).toEqual([BOX, CLOUD]);
  });

  it("persists the list and reads it back; a throwing storage degrades to the page origin", () => {
    const storage = memoryStorage();
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    r.setServers([{ nodeId: "c", url: CLOUD }]);
    expect(JSON.parse(storage.data.get(SERVERS_STORAGE_KEY)!)).toEqual({
      servers: [{ nodeId: "c", url: CLOUD }],
    });
    const r2 = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    expect(r2.statuses().map((s) => s.url)).toEqual([BOX, CLOUD]);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const r3 = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage: broken });
    expect(r3.statuses().map((s) => s.url)).toEqual([BOX]);
    expect(() => r3.setServers([{ url: CLOUD }])).not.toThrow();
  });

  it("dispatches state-changed only when the render-relevant state changes, not every steady round", async () => {
    const table: Record<string, Answer> = {
      [BOX]: { acceptingSales: true, term: 1, nodeId: "b" },
      [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    const changed = vi.fn();
    r.addEventListener("state-changed", changed); // attach AFTER setServers, so we count only rounds
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(1);
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(1);
    table[CLOUD] = { acceptingSales: false, term: 5, nodeId: "c" };
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  // `setServers` and a probe round must share one signature gate: if the gate compared only against
  // the last ROUND's signature, this round would match the stale value and skip its dispatch, leaving
  // the display on `unknown` while the server is really `standby`.
  it("re-dispatches state-changed after a setServers repaint that a repeating round undoes", async () => {
    const table: Record<string, Answer> = {
      [BOX]: { acceptingSales: true, term: 1, nodeId: "b" },
      [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    r.setServers([{ url: BOX }]);
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    expect(r.statuses().find((s) => s.url === CLOUD)?.state).toBe("unknown");
    const changed = vi.fn();
    r.addEventListener("state-changed", changed); // count only the final round
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(r.statuses().find((s) => s.url === CLOUD)?.state).toBe("standby");
  });
});

describe("ServerRouter — polling, refusals and stored state", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { name: "one box", servers: [{ url: BOX }], calls: 1 },
    { name: "two boxes", servers: [{ url: BOX }, { url: CLOUD }], calls: 6 },
    { name: "one box with its own hostname", servers: [{ nodeId: "b", url: CLOUD }], calls: 2 },
  ])("$name: connected probing keeps only the required timer", async ({ servers, calls }) => {
    vi.useFakeTimers();
    const fetchImpl = probeFetch({
      [BOX]: { acceptingSales: true, term: 1, nodeId: "b" },
      [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.setServers(servers);
    r.start();
    await r.probeNow();
    r.setLive(true);
    r.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    await withServerTarget(fetchImpl, r)("/api/node");
    expect(fetchImpl).toHaveBeenCalledTimes(calls + 1);
    r.stop();
  });

  it("a lost one-box connection probes at once and every five seconds until ready again", async () => {
    vi.useFakeTimers();
    const fetchImpl = probeFetch({ [BOX]: { acceptingSales: true, term: 1, nodeId: "b" } });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    const probes = vi.spyOn(r, "probeNow");
    r.start();
    await r.probeNow();
    r.setLive(true);
    r.setLive(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await probes.mock.results.at(-1)!.value;
    r.setLive(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await probes.mock.results.at(-1)!.value;
    r.setLive(true);
    r.stop();
    r.setLive(false);
    r.setServers([{ url: CLOUD }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("growing a connected list to two boxes probes at once; shrinking it quiets the timer", async () => {
    vi.useFakeTimers();
    const fetchImpl = probeFetch({
      [BOX]: { acceptingSales: true, term: 1, nodeId: "b" },
      [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.start();
    await r.probeNow();
    r.setLive(true);
    r.setServers([{ url: CLOUD }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    r.setServers([{ url: BOX }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    r.stop();
  });

  it("start() probes at once and then every interval; a second start() adds no second poller", async () => {
    vi.useFakeTimers();
    const fetchImpl = probeFetch({ [BOX]: { acceptingSales: true, term: 1, nodeId: "b" } });
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl,
      storage: memoryStorage(),
      intervalMs: 1_000,
    });
    r.start();
    r.start();
    await r.probeNow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    r.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stop() is safe on a router never started, and a stopped router can start polling again", async () => {
    vi.useFakeTimers();
    const fetchImpl = probeFetch({ [BOX]: { acceptingSales: true, term: 1, nodeId: "b" } });
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl,
      storage: memoryStorage(),
      intervalMs: 1_000,
    });
    r.stop();
    r.start();
    await r.probeNow(); // joins the round start() began, so it adds no fetch of its own
    r.stop();
    r.start();
    await r.probeNow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    r.stop();
  });

  it("reads a server answering an error status as unreachable, forgetting the term it had", async () => {
    let status = 200;
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ acceptingSales: false, term: 4, nodeId: "b" }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    await r.probeNow();
    expect(r.statuses()[0]).toMatchObject({ state: "standby", term: 4 });
    status = 503;
    await r.probeNow();
    expect(r.statuses()).toEqual([
      { url: BOX, label: "box.deli.test", state: "unreachable", term: null },
    ]);
    expect(r.waiting).toBe(true);
  });

  it("ranks a primary reporting a term above one reporting none, in either order", async () => {
    const table: Record<string, Answer> = {
      [BOX]: { acceptingSales: true, term: null, nodeId: "b" },
      [CLOUD]: { acceptingSales: true, term: 1, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    table[BOX] = { acceptingSales: true, term: 3, nodeId: "b" };
    table[CLOUD] = { acceptingSales: true, term: null, nodeId: "c" };
    await r.probeNow();
    expect(r.current).toBe(BOX);
  });

  it("starts from the page origin alone when the stored value holds no server list", () => {
    const storage = memoryStorage();
    storage.data.set(SERVERS_STORAGE_KEY, JSON.stringify({ servers: { url: CLOUD } }));
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    expect(r.statuses().map((s) => s.url)).toEqual([BOX]);
  });

  it("persists to the page's localStorage when no storage is injected", () => {
    const previous = localStorage.getItem(SERVERS_STORAGE_KEY);
    try {
      localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify({ servers: [{ url: CLOUD }] }));
      const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}) });
      expect(r.statuses().map((s) => s.url)).toEqual([BOX, CLOUD]);
      r.setServers([]);
      expect(JSON.parse(localStorage.getItem(SERVERS_STORAGE_KEY)!)).toEqual({ servers: [] });
    } finally {
      if (previous === null) localStorage.removeItem(SERVERS_STORAGE_KEY);
      else localStorage.setItem(SERVERS_STORAGE_KEY, previous);
    }
  });

  it("keeps the list in memory when the page has no localStorage at all", () => {
    const previous = localStorage.getItem(SERVERS_STORAGE_KEY);
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify({ servers: [{ url: CLOUD }] }));
    const saved = localStorage;
    const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });
    try {
      const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}) });
      // The stored CLOUD entry is not read: with no storage the router starts from the origin alone.
      expect(r.statuses().map((s) => s.url)).toEqual([BOX]);
      expect(() => r.setServers([{ url: CLOUD }])).not.toThrow();
      expect(r.statuses().map((s) => s.url)).toEqual([BOX, CLOUD]);
    } finally {
      if (prev) Object.defineProperty(globalThis, "localStorage", prev);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
      if (previous === null) saved.removeItem(SERVERS_STORAGE_KEY);
      else saved.setItem(SERVERS_STORAGE_KEY, previous);
    }
  });
});

describe("ServerRouter — handing on the held chart", () => {
  const chart = (term: number) => ({
    body: { term, nodes: [] },
    signerNodeId: "b",
    signature: `sig-${term}`,
    endorsements: [],
  });

  /** Answers each probe from `table` (a missing `term` key answers none) and records every POST. */
  function chartFetch(table: Record<string, Record<string, unknown>>) {
    const posts: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }
      return new Response(JSON.stringify(table[new URL(url).origin]), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, posts };
  }

  it("two connected boxes still receive a newer chart on the next timed probe", async () => {
    vi.useFakeTimers();
    const { fetchImpl, posts } = chartFetch({
      [BOX]: { acceptingSales: true, term: 5, nodeId: "b" },
      [CLOUD]: { acceptingSales: false, term: 4, nodeId: "c" },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    try {
      r.setServers([{ url: CLOUD }]);
      r.start();
      await r.probeNow();
      r.setLive(true);
      r.offerChart(chart(5));
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() =>
        expect(posts).toEqual([
          { url: `${CLOUD}/api/node/membership`, body: { document: chart(5) } },
        ]),
      );
      expect(r.current).toBe(BOX);
    } finally {
      r.stop();
      vi.useRealTimers();
    }
  });

  it("posts the held chart to a server answering a lower term, once", async () => {
    const { fetchImpl, posts } = chartFetch({
      [BOX]: { acceptingSales: true, term: 5, nodeId: "b" },
      [CLOUD]: { acceptingSales: true, term: 4, nodeId: "c" },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    r.offerChart(chart(5));
    await r.probeNow();
    await r.probeNow();
    expect(posts).toEqual([{ url: `${CLOUD}/api/node/membership`, body: { document: chart(5) } }]);
    // The post never moves the till: the higher term still wins.
    expect(r.current).toBe(BOX);
  });

  it("posts it to a server answering no term, once", async () => {
    const { fetchImpl, posts } = chartFetch({
      [BOX]: { acceptingSales: true, term: 5, nodeId: "b" },
      [CLOUD]: { acceptingSales: false },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    r.offerChart(chart(5));
    await r.probeNow();
    await r.probeNow();
    expect(posts).toEqual([{ url: `${CLOUD}/api/node/membership`, body: { document: chart(5) } }]);
  });

  it("posts nothing to a server at the same or a higher term", async () => {
    const { fetchImpl, posts } = chartFetch({
      [BOX]: { acceptingSales: true, term: 5, nodeId: "b" },
      [CLOUD]: { acceptingSales: false, term: 6, nodeId: "c" },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    r.offerChart(chart(5));
    await r.probeNow();
    expect(posts).toEqual([]);
  });

  it("keeps the newest of two charts it was given", async () => {
    const { fetchImpl, posts } = chartFetch({
      [BOX]: { acceptingSales: true, term: 4, nodeId: "b" },
    });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.offerChart(chart(5));
    r.offerChart(chart(3));
    r.offerChart(null);
    await r.probeNow();
    expect(posts).toEqual([{ url: `${BOX}/api/node/membership`, body: { document: chart(5) } }]);
  });

  it("none, then lower, posts twice", async () => {
    const table: Record<string, Record<string, unknown>> = {
      [BOX]: { acceptingSales: false },
    };
    const { fetchImpl, posts } = chartFetch(table);
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.offerChart(chart(5));
    await r.probeNow();
    table[BOX] = { acceptingSales: true, term: 4, nodeId: "b" };
    await r.probeNow();
    await r.probeNow();
    expect(posts.map((p) => p.url)).toEqual([
      `${BOX}/api/node/membership`,
      `${BOX}/api/node/membership`,
    ]);
  });

  it("a rejected post is tried again on the next round", async () => {
    let posts = 0;
    let reject = true;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        if (reject) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ acceptingSales: true, term: 2, nodeId: "b" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.offerChart(chart(3));
    await r.probeNow();
    reject = false;
    await r.probeNow();
    await r.probeNow();
    expect(posts).toBe(2);
  });

  it("a post answered with a server failure is tried again on a later round, until one is answered", async () => {
    const statuses = [503, 500, 200];
    let posts = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return new Response("{}", { status: statuses[posts - 1] ?? 200 });
      }
      return new Response(JSON.stringify({ acceptingSales: true, term: 2, nodeId: "b" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.offerChart(chart(3));
    for (let round = 0; round < 5; round += 1) await r.probeNow();
    expect(posts).toBe(3);
  });

  it("a post answered with a refusal is not sent again for the same answer", async () => {
    let posts = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts += 1;
        return new Response("{}", { status: 409 });
      }
      return new Response(JSON.stringify({ acceptingSales: false }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.offerChart(chart(3));
    await r.probeNow();
    await r.probeNow();
    expect(posts).toBe(1);
  });

  it("ignores a chart without a numeric term", async () => {
    const { fetchImpl, posts } = chartFetch({ [BOX]: { acceptingSales: false } });
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    expect(() => r.offerChart({} as never)).not.toThrow();
    expect(() => r.offerChart({ body: { term: "5" } } as never)).not.toThrow();
    await r.probeNow();
    expect(posts).toEqual([]);
  });

  it("posts a newer chart again to a server it already sent an older one, and a refused post neither retries nor stops the round", async () => {
    const posts: number[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(
          (JSON.parse(String(init.body)) as { document: { body: { term: number } } }).document.body
            .term,
        );
        return new Response("{}", { status: 409 });
      }
      return new Response(JSON.stringify({ acceptingSales: true, term: 2, nodeId: "b" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl, storage: memoryStorage() });
    r.offerChart(chart(3));
    await r.probeNow();
    await r.probeNow();
    r.offerChart(chart(4));
    await r.probeNow();
    expect(posts).toEqual([3, 4]);
    expect(r.statuses()[0]).toMatchObject({ state: "primary", term: 2 });
  });
});

describe("ServerRouter: one line per box", () => {
  const PAGE = "https://waitron.local";
  const OWN = "https://box-n1xx.waitron.local";
  const OTHER = "https://box-n2yy.waitron.local";

  function probesOf(fetchImpl: typeof fetch, origin: string): number {
    return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([input]) => String(input) === `${origin}/api/node`,
    ).length;
  }

  it("an own-name entry that never answers is hidden behind the page origin", async () => {
    const fetchImpl = probeFetch({
      [PAGE]: { acceptingSales: true, term: 2, nodeId: "n1" },
      [OWN]: "down",
    });
    const r = new ServerRouter({ origin: PAGE, fetchImpl, storage: memoryStorage() });
    r.setServers([{ nodeId: "n1", url: OWN }]);
    await r.probeNow();
    expect(r.statuses()).toEqual([
      { url: PAGE, label: "waitron.local", state: "primary", term: 2 },
    ]);
    const before = probesOf(fetchImpl, OWN);
    await r.probeNow();
    expect(probesOf(fetchImpl, OWN)).toBe(before);
    expect(r.current).toBe(PAGE);
  });

  it("two boxes are two servers", async () => {
    const r = new ServerRouter({
      origin: PAGE,
      fetchImpl: probeFetch({
        [PAGE]: { acceptingSales: true, term: 2, nodeId: "n1" },
        [OTHER]: { acceptingSales: false, term: 2, nodeId: "n2" },
      }),
      storage: memoryStorage(),
    });
    r.setServers([{ nodeId: "n2", url: OTHER }]);
    await r.probeNow();
    await r.probeNow();
    expect(r.statuses().map((s) => s.url)).toEqual([PAGE, OTHER]);
  });

  it("before the origin has reported its node id, every entry is shown", async () => {
    const r = new ServerRouter({
      origin: PAGE,
      fetchImpl: probeFetch({
        [PAGE]: "down",
        [OWN]: { acceptingSales: false, term: 2, nodeId: "n1" },
      }),
      storage: memoryStorage(),
    });
    r.setServers([{ nodeId: "n1", url: OWN }]);
    await r.probeNow();
    expect(r.statuses()).toEqual([
      { url: PAGE, label: "waitron.local", state: "unreachable", term: null },
      { url: OWN, label: "box-n1xx.waitron.local", state: "standby", term: 2 },
    ]);
  });

  it("never follows an own-name entry that the page's answer hides in the same round, whatever it answered", async () => {
    const r = new ServerRouter({
      origin: PAGE,
      fetchImpl: probeFetch({
        [PAGE]: { acceptingSales: false, term: 2, nodeId: "n1" },
        [OWN]: { acceptingSales: true, term: 3, nodeId: "n1" },
      }),
      storage: memoryStorage(),
    });
    r.setServers([{ nodeId: "n1", url: OWN }]);
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);
    await r.probeNow();
    expect(r.statuses().map((s) => s.url)).toEqual([PAGE]);
    expect(moved).not.toHaveBeenCalled();
    expect(r.current).toBe(PAGE);
    expect(r.waiting).toBe(true);
  });

  it("stays on the page's origin when its own name answers primary at the same term", async () => {
    const r = new ServerRouter({
      origin: PAGE,
      fetchImpl: probeFetch({
        [PAGE]: { acceptingSales: true, term: 2, nodeId: "n1" },
        [OWN]: { acceptingSales: true, term: 2, nodeId: "n1" },
      }),
      storage: memoryStorage(),
    });
    r.setServers([{ nodeId: "n1", url: OWN }]);
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);
    await r.probeNow();
    await r.probeNow();
    expect(r.current).toBe(PAGE);
    expect(moved).not.toHaveBeenCalled();
  });

  describe("when a box fails", () => {
    const A = "https://box-aaaa.waitron.local";
    const B = "https://box-bbbb.waitron.local";

    /** Round 1: box A sells and answers the page; box B stands by. A's own-name line is then
     * hidden. */
    async function twoBoxes(fetchImpl?: (table: Record<string, Answer>) => typeof fetch) {
      const table: Record<string, Answer> = {
        [PAGE]: { acceptingSales: true, term: 2, nodeId: "A" },
        [A]: { acceptingSales: true, term: 2, nodeId: "A" },
        [B]: { acceptingSales: false, term: 2, nodeId: "B" },
      };
      const r = new ServerRouter({
        origin: PAGE,
        fetchImpl: (fetchImpl ?? probeFetch)(table),
        storage: memoryStorage(),
      });
      r.setServers([
        { nodeId: "A", url: A },
        { nodeId: "B", url: B },
      ]);
      await r.probeNow();
      expect(r.statuses().map((s) => s.url)).toEqual([PAGE, B]);
      const moves: string[] = [];
      r.addEventListener("server-changed", (e) =>
        moves.push((e as CustomEvent<{ to: string }>).detail.to),
      );
      return { r, table, moves };
    }

    it("never moves to a dead box on the answer it gave while its line was hidden", async () => {
      const { r, table, moves } = await twoBoxes();
      table[PAGE] = { acceptingSales: false, term: 2, nodeId: "B" };
      table[A] = "down";
      await r.probeNow();
      expect(moves).toEqual([]);
      expect(r.current).toBe(PAGE);
      expect(r.waiting).toBe(true);
      expect(r.statuses()).toEqual([
        { url: PAGE, label: "waitron.local", state: "standby", term: 2 },
        { url: A, label: "box-aaaa.waitron.local", state: "unreachable", term: null },
      ]);
    });

    it("follows the box at its own name, in the same round, when the page stops reaching it", async () => {
      const { r, table, moves } = await twoBoxes();
      table[PAGE] = "down";
      await r.probeNow();
      expect(moves).toEqual([A]);
      expect(r.waiting).toBe(false);
      expect(r.statuses()).toEqual([
        { url: PAGE, label: "waitron.local", state: "unreachable", term: null },
        { url: A, label: "box-aaaa.waitron.local", state: "primary", term: 2 },
        { url: B, label: "box-bbbb.waitron.local", state: "standby", term: 2 },
      ]);
    });

    it("follows the box at its own name when the page answers without a node id", async () => {
      const { r, table, moves } = await twoBoxes();
      // What a box not yet ready to trade answers.
      table[PAGE] = { acceptingSales: false, term: null };
      await r.probeNow();
      expect(moves).toEqual([A]);
      expect(r.waiting).toBe(false);
    });

    it("follows the box at its own name, in the same round, when the page answers an error status", async () => {
      let pageFails = false;
      const { r, moves } = await twoBoxes((t) => {
        const inner = probeFetch(t);
        return (async (input: RequestInfo | URL, init?: RequestInit) => {
          // A box in setup mode answers the page's name and has no /api/node.
          if (pageFails && String(input) === `${PAGE}/api/node`) {
            return new Response("not found", { status: 404 });
          }
          return inner(input, init);
        }) as typeof fetch;
      });
      pageFails = true;
      await r.probeNow();
      expect(moves).toEqual([A]);
      expect(r.current).toBe(A);
      expect(r.statuses().slice(0, 2)).toEqual([
        { url: PAGE, label: "waitron.local", state: "unreachable", term: null },
        { url: A, label: "box-aaaa.waitron.local", state: "primary", term: 2 },
      ]);
    });

    it("follows the promoted box at its own name, then back to the page when the page answers as it", async () => {
      const { r, table, moves } = await twoBoxes();
      table[PAGE] = "down";
      table[A] = "down";
      table[B] = { acceptingSales: true, term: 3, nodeId: "B" };
      await r.probeNow();
      expect(moves).toEqual([B]);
      table[PAGE] = { acceptingSales: true, term: 3, nodeId: "B" };
      await r.probeNow();
      expect(moves).toEqual([B, PAGE]);
      expect(r.statuses()).toEqual([
        { url: PAGE, label: "waitron.local", state: "primary", term: 3 },
        { url: A, label: "box-aaaa.waitron.local", state: "unreachable", term: null },
      ]);
    });

    it("draws a line that reappears as unknown until its probe answers, never with its old answer", async () => {
      let releaseA!: () => void;
      const heldA = new Promise<void>((resolve) => (releaseA = resolve));
      const { r, table } = await twoBoxes((t) => {
        const inner = probeFetch(t);
        return (async (input: RequestInfo | URL, init?: RequestInit) => {
          const page = t[PAGE];
          const pageIsB = page !== undefined && page !== "down" && page.nodeId === "B";
          if (String(input) === `${A}/api/node` && pageIsB) await heldA;
          return inner(input, init);
        }) as typeof fetch;
      });
      table[PAGE] = { acceptingSales: false, term: 2, nodeId: "B" };
      table[A] = "down";
      const round = r.probeNow();
      await vi.waitFor(() => expect(r.statuses().map((s) => s.url)).toEqual([PAGE, A]));
      expect(r.statuses()[1]).toEqual({
        url: A,
        label: "box-aaaa.waitron.local",
        state: "unknown",
        term: null,
      });
      releaseA();
      await round;
      expect(r.statuses()[1]?.state).toBe("unreachable");
    });
  });

  it("hides a saved entry once the chart gives it the page's node id", async () => {
    const storage = memoryStorage();
    storage.setItem(SERVERS_STORAGE_KEY, JSON.stringify({ servers: [{ url: OWN }] }));
    const r = new ServerRouter({
      origin: PAGE,
      fetchImpl: probeFetch({
        [PAGE]: { acceptingSales: true, term: 2, nodeId: "n1" },
        [OWN]: { acceptingSales: true, term: 2, nodeId: "n1" },
      }),
      storage,
    });
    r.setServers([{ nodeId: "n1", url: OWN }]);
    await r.probeNow();
    expect(r.statuses().map((s) => s.url)).toEqual([PAGE]);
  });
});

describe("withServerTarget", () => {
  it("rewrites a relative path onto the current target and leaves absolute inputs alone", async () => {
    const seen: string[] = [];
    const base = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input instanceof Request ? input.url : input));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch({ [CLOUD]: { acceptingSales: true, term: 1, nodeId: "c" } }),
      storage: memoryStorage(),
    });
    r.setServers([{ url: CLOUD }]);
    await r.probeNow();
    const f = withServerTarget(base, r);
    await f("/api/till");
    await f("https://elsewhere.test/x");
    await f(new URL("https://elsewhere.test/y"));
    expect(seen).toEqual([
      `${CLOUD}/api/till`,
      "https://elsewhere.test/x",
      "https://elsewhere.test/y",
    ]);
  });

  it("holds a move while a wrapped request is in flight", async () => {
    let release!: () => void;
    const base = vi.fn(
      () =>
        new Promise<Response>((res) => {
          release = () => res(new Response("{}"));
        }),
    ) as unknown as typeof fetch;
    const table: Record<string, Answer> = {
      [BOX]: "down",
      [CLOUD]: { acceptingSales: true, term: 1, nodeId: "c" },
    };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: CLOUD }]);
    const pending = withServerTarget(base, r)("/api/sales", { method: "POST" });
    await r.probeNow();
    expect(r.current).toBe(BOX);
    release();
    await pending;
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });
});
