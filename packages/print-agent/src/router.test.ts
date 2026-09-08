import { describe, expect, it, vi } from "vitest";
import type { NodeProbe, Result } from "./client.js";
import { Router } from "./router.js";

const A = "http://a.test";
const B = "http://b.test";

function probeFrom(table: Record<string, Partial<NodeProbe> | "down">) {
  return vi.fn(async (url: string): Promise<Result<NodeProbe>> => {
    const row = table[url];
    if (row === undefined || row === "down")
      return { ok: false, failure: { kind: "unreachable", detail: "x" } };
    return {
      ok: true,
      value: {
        nodeId: row.nodeId ?? url,
        term: row.term ?? null,
        acceptingSales: row.acceptingSales ?? false,
        environment: row.environment ?? "preproduction",
      },
    };
  });
}

describe("Router", () => {
  it("starts on the configured url and stays there while it accepts sales", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({ [A]: { acceptingSales: true } }),
    });
    expect(router.current).toBe(A);
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: true });
    expect(router.current).toBe(A);
  });

  it("moves to the server that accepts sales, the highest term on a tie", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({
        [A]: { acceptingSales: true, term: 3 },
        [B]: { acceptingSales: true, term: 5 },
      }),
    });
    router.merge([{ url: B }]);
    expect(await router.probe()).toEqual({ moved: true, anyAccepting: true });
    expect(router.current).toBe(B);
  });

  it("keeps current when nobody accepts (no giving up, no failure count)", async () => {
    const probe = probeFrom({ [A]: "down", [B]: { acceptingSales: false } });
    const router = new Router({ configuredUrl: A, probe });
    router.merge([{ url: B }]);
    for (let i = 0; i < 3; i += 1) {
      expect(await router.probe()).toEqual({ moved: false, anyAccepting: false });
    }
    expect(router.current).toBe(A);
    expect(router.servers().map((s) => s.state)).toEqual(["unreachable", "standby"]);
  });

  it("skips a server in another environment", async () => {
    const router = new Router({
      configuredUrl: A,
      environment: "preproduction",
      probe: probeFrom({
        [A]: { acceptingSales: false },
        [B]: { acceptingSales: true, environment: "production" },
      }),
    });
    router.merge([{ url: B }]);
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: false });
    expect(router.current).toBe(A);
  });

  it("fixes the environment from the first successful probe when none was given", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({ [A]: { acceptingSales: true, environment: "production" } }),
    });
    expect(router.environment).toBeUndefined();
    await router.probe();
    expect(router.environment).toBe("production");
  });

  it("merge never drops the configured url, dedupes by origin and drops non-http urls", () => {
    const router = new Router({ configuredUrl: A, probe: probeFrom({}) });
    router.merge([
      { url: `${B}/`, nodeId: "b" },
      { url: B },
      { url: "mailto:x@y" },
      { url: "not a url" },
    ]);
    expect(router.servers().map((s) => s.url)).toEqual([A, B]);
    router.merge([{ url: B }]);
    expect(router.servers().map((s) => s.url)).toEqual([A, B]);
  });

  it("merge that omits the configured address preserves its learned state", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({ [A]: { acceptingSales: true, term: 7, nodeId: "a" } }),
    });
    await router.probe();
    router.merge([{ url: B }]);
    expect(router.servers()[0]).toEqual({ url: A, nodeId: "a", state: "primary", term: 7 });
  });

  it("fixes the environment from the configured address's own result, never from whichever probe answers first", async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const probe = vi.fn(async (url: string): Promise<Result<NodeProbe>> => {
      if (url === A) {
        await delay(20);
        return {
          ok: true,
          value: { nodeId: "a", term: 9, acceptingSales: true, environment: "preproduction" },
        };
      }
      return {
        ok: true,
        value: { nodeId: "b", term: 1, acceptingSales: true, environment: "production" },
      };
    });
    const router = new Router({ configuredUrl: A, probe });
    router.merge([{ url: B }]);
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: true });
    expect(router.environment).toBe("preproduction");
    expect(router.current).toBe(A);
  });

  it("rejects a configured url with no scheme (a bare host:port parses with protocol 'localhost:')", () => {
    expect(() => new Router({ configuredUrl: "localhost:3000", probe: probeFrom({}) })).toThrow(
      /configuredUrl/,
    );
  });

  it("rejects a bare hostname as a configured url", () => {
    expect(() => new Router({ configuredUrl: "a.test", probe: probeFrom({}) })).toThrow(
      /configuredUrl/,
    );
  });

  it("rejects a non-http configured url", () => {
    expect(() => new Router({ configuredUrl: "mailto:x@y", probe: probeFrom({}) })).toThrow(
      /configuredUrl/,
    );
  });

  it("tie-break: equal terms keep the earlier list entry (the configured address), never the incumbent `current`", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({
        [A]: { acceptingSales: true, term: 5 },
        [B]: { acceptingSales: true, term: 5 },
      }),
    });
    router.merge([{ url: B }]);
    await router.probe();
    expect(router.current).toBe(A);
  });

  it("tie-break: a null term loses to term 0", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({
        [A]: { acceptingSales: true, term: null },
        [B]: { acceptingSales: true, term: 0 },
      }),
    });
    router.merge([{ url: B }]);
    await router.probe();
    expect(router.current).toBe(B);
  });

  it("tie-break: both terms null keeps the earlier list entry", async () => {
    const router = new Router({
      configuredUrl: A,
      probe: probeFrom({
        [A]: { acceptingSales: true, term: null },
        [B]: { acceptingSales: true, term: null },
      }),
    });
    router.merge([{ url: B }]);
    await router.probe();
    expect(router.current).toBe(A);
  });
});
