import { describe, expect, it, vi } from "vitest";
import { SERVERS_STORAGE_KEY, ServerRouter } from "./server-router.js";

const BOX = "https://box.deli.test";
const CLOUD = "https://cloud.deli.test";

type Answer = { acceptingSales: boolean; term: number | null; nodeId: string } | "down";

/** A fetch that answers /api/node per origin from a mutable table; "down" rejects like a dead host. */
function probeFetch(table: Record<string, Answer>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
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
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ nodeId: "b", url: BOX }, { nodeId: "c", url: CLOUD }]);
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
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: false, term: 1, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
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
    const table: Record<string, Answer> = { [BOX]: { acceptingSales: false, term: 3, nodeId: "b" }, [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    table[BOX] = { acceptingSales: true, term: 3, nodeId: "b" };
    table[CLOUD] = { acceptingSales: false, term: 3, nodeId: "c" };
    await r.probeNow();
    expect(r.current).toBe(BOX);
  });

  it("prefers the higher term when two servers both say yes", async () => {
    const table: Record<string, Answer> = { [BOX]: { acceptingSales: true, term: 1, nodeId: "b" }, [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });

  it("does not move while a request is in flight; moves on the next round", async () => {
    const table: Record<string, Answer> = { [BOX]: "down", [CLOUD]: { acceptingSales: true, term: 2, nodeId: "c" } };
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch(table), storage: memoryStorage() });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    r.beginRequest();
    await r.probeNow();
    expect(r.current).toBe(BOX);
    r.endRequest();
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
  });

  it("times out a hanging probe as unreachable", async () => {
    const hanging = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    ) as unknown as typeof fetch;
    const r = new ServerRouter({ origin: BOX, fetchImpl: hanging, storage: memoryStorage(), timeoutMs: 20 });
    await r.probeNow();
    expect(r.statuses()[0]?.state).toBe("unreachable");
  });

  it("persists the list and reads it back; a throwing storage degrades to the page origin", () => {
    const storage = memoryStorage();
    const r = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    r.setServers([{ nodeId: "c", url: CLOUD }]);
    expect(JSON.parse(storage.data.get(SERVERS_STORAGE_KEY)!)).toEqual({ servers: [{ nodeId: "c", url: CLOUD }] });
    const r2 = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage });
    expect(r2.statuses().map((s) => s.url)).toEqual([BOX, CLOUD]);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const r3 = new ServerRouter({ origin: BOX, fetchImpl: probeFetch({}), storage: broken });
    expect(r3.statuses().map((s) => s.url)).toEqual([BOX]);
    expect(() => r3.setServers([{ url: CLOUD }])).not.toThrow();
  });
});
