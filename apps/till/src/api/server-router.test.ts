import { describe, expect, it, vi } from "vitest";
import { SERVERS_STORAGE_KEY, ServerRouter, withServerTarget } from "./server-router.js";

const BOX = "https://box.deli.test";
const CLOUD = "https://cloud.deli.test";

type Answer = { acceptingSales: boolean; term: number | null; nodeId: string } | "down";

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

    // Browser-native fetch rejects when called with the ServerRouter as its receiver. Test doubles
    // normally ignore `this`, which hid the fact that no /api/node request was leaving Chromium.
    expect(receivers).toEqual([undefined]);
    expect(r.statuses()[0]?.state).toBe("primary");
  });

  it("degrades to memory when the DEFAULT localStorage global throws on access (blocked site data)", () => {
    // A browser that blocks site data throws on the bare `localStorage` access itself, not only on
    // getItem/setItem. With no `storage` opt the constructor takes the default-acquisition path, which
    // must swallow that throw and fall back to memory rather than abort construction.
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
    // that list must retain the object the probe is updating, or this successful answer is discarded and
    // a newly enrolled KDS briefly reports that no primary exists.
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

  // Change-detection (till-reroute §4.1, S4 deferral D2): a probe round dispatches `state-changed` only
  // when the render-relevant state actually changed since the last dispatch, so the app's lock-screen
  // repaint is not driven every 5 s in the steady state. BEFORE the fix, `#runRound` dispatched
  // unconditionally, so the second identical round would fire a second event (this test would see 2, not
  // 1) — that is the failing case this proves.
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
    r.setServers([{ url: BOX }, { url: CLOUD }]); // setServers goes through the same signature gate
    const changed = vi.fn();
    r.addEventListener("state-changed", changed); // attach AFTER setServers, so we count only rounds
    // First round settles the state (unknown → known): a genuine change, so it dispatches.
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(1);
    // A second round with identical probe results changes nothing visible — it must NOT re-dispatch.
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(1);
    // A round whose results DO change (the cloud's term moves) is a real change — it dispatches again.
    table[CLOUD] = { acceptingSales: false, term: 5, nodeId: "c" };
    await r.probeNow();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  // Stale-signature freeze (run-it reviewer, §4.1): `setServers` and a probe ROUND must share ONE
  // signature gate, or a repaint the round happens to undo silently freezes the display. Remove a
  // probed server and re-add it as `unknown` (a genuine repaint), then a round that returns the SAME
  // answer it gave before the removal: if the gate compared only against the last ROUND's signature,
  // the round would equal the STALE value and skip its dispatch — the display stuck on `unknown` while
  // the server is really `standby`. Unifying the gate through `#emitStateChanged` (which `setServers`
  // updates too) makes the round's genuine change dispatch. BEFORE the fix `changed` is 0 here.
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
    await r.probeNow(); // round 1: box primary, cloud standby — the signature settles here
    r.setServers([{ url: BOX }]); // drop cloud
    r.setServers([{ url: BOX }, { url: CLOUD }]); // re-add it, repainting cloud to `unknown`
    expect(r.statuses().find((s) => s.url === CLOUD)?.state).toBe("unknown");
    const changed = vi.fn();
    r.addEventListener("state-changed", changed); // count only the final round
    await r.probeNow(); // round 2: cloud → standby again — a real change from the repainted `unknown`
    expect(changed).toHaveBeenCalledTimes(1);
    expect(r.statuses().find((s) => s.url === CLOUD)?.state).toBe("standby");
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
