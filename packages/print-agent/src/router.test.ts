import { describe, expect, it, vi } from "vitest";
import type { NodeProbe, Result } from "./client.js";
import { Router } from "./router.js";

const A = "http://a.test";
const B = "http://b.test";
const C = "http://c.test";

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

  it("tie-break: equal terms take the earlier list entry, moving OFF the incumbent to reach it", async () => {
    const table: Record<string, Partial<NodeProbe> | "down"> = {
      [A]: { acceptingSales: true, term: 3 },
      [B]: { acceptingSales: true, term: 5 },
    };
    const router = new Router({ configuredUrl: A, probe: probeFrom(table) });
    router.merge([{ url: B }]);
    expect(await router.probe()).toEqual({ moved: true, anyAccepting: true });
    expect(router.current).toBe(B);
    // Now equalise the terms. `current` is B and the earlier list entry is A, so the two candidate
    // rules disagree and the assertion discriminates: list order moves back to A, incumbent
    // preference would stay on B. (The old shape started with A as BOTH, and passed either way.)
    table[A] = { acceptingSales: true, term: 5 };
    expect(await router.probe()).toEqual({ moved: true, anyAccepting: true });
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
  it("establishes the environment only from the configured address: until it answers, nobody is followed", async () => {
    const table: Record<string, Partial<NodeProbe> | "down"> = {
      [A]: "down",
      [B]: { acceptingSales: true, term: 5, environment: "production", nodeId: "b" },
    };
    const router = new Router({ configuredUrl: A, probe: probeFrom(table) });
    router.merge([{ url: B }]);
    // B answers `production` and accepts sales, but it is not the venue's address of record: it can
    // neither fix the pin nor be followed.
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: false });
    expect(router.environment).toBeUndefined();
    expect(router.current).toBe(A);

    table[A] = { acceptingSales: true, term: 1, environment: "preproduction", nodeId: "a" };
    expect(await router.probe()).toEqual({ moved: false, anyAccepting: true });
    expect(router.environment).toBe("preproduction");
    expect(router.current).toBe(A);
    expect(router.servers().map((s) => s.state)).toEqual(["primary", "standby"]);
  });

  it("applies each result to the url it was issued for: a server that replaced another mid-round stays unprobed", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = vi.fn(async (url: string): Promise<Result<NodeProbe>> => {
      if (url === B) await gate;
      return {
        ok: true,
        value: {
          nodeId: url === B ? "b" : "a",
          term: url === B ? 9 : 1,
          acceptingSales: true,
          environment: "preproduction",
        },
      };
    });
    const router = new Router({ configuredUrl: A, environment: "preproduction", probe });
    router.merge([{ url: B }]);
    const round = router.probe();
    router.merge([{ url: C }]); // B replaced by C while B's probe is still in flight
    release();
    expect(await round).toEqual({ moved: false, anyAccepting: true });
    expect(router.servers()).toEqual([
      { url: A, nodeId: "a", state: "primary", term: 1 },
      { url: C, nodeId: undefined, state: "unknown", term: null },
    ]);
    expect(router.current).toBe(A);
  });

  it("discards a result for a server the list no longer holds", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = vi.fn(async (url: string): Promise<Result<NodeProbe>> => {
      if (url === B) await gate;
      return {
        ok: true,
        value: {
          nodeId: url === B ? "b" : "a",
          term: url === B ? 9 : 1,
          acceptingSales: true,
          environment: "preproduction",
        },
      };
    });
    const router = new Router({ configuredUrl: A, environment: "preproduction", probe });
    router.merge([{ url: B }]);
    const round = router.probe();
    router.merge([]); // the list shrinks to the configured address alone
    release();
    expect(await round).toEqual({ moved: false, anyAccepting: true });
    expect(router.servers()).toEqual([{ url: A, nodeId: "a", state: "primary", term: 1 }]);
    expect(router.current).toBe(A);
  });

  it("overlapping probe() calls share one in-flight round", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probe = vi.fn(async (url: string): Promise<Result<NodeProbe>> => {
      await gate;
      return {
        ok: true,
        value: {
          nodeId: url,
          term: url === B ? 5 : 1,
          acceptingSales: true,
          environment: "preproduction",
        },
      };
    });
    const router = new Router({ configuredUrl: A, environment: "preproduction", probe });
    router.merge([{ url: B }]);
    const first = router.probe();
    const second = router.probe();
    release();
    const [firstRound, secondRound] = await Promise.all([first, second]);
    expect(probe).toHaveBeenCalledTimes(2); // two servers, ONE round — not two rounds of two
    expect(firstRound).toEqual(secondRound);
    expect(firstRound).toEqual({ moved: true, anyAccepting: true });
    expect(router.current).toBe(B);
    // The round is released once it settles, so a later call probes afresh.
    await router.probe();
    expect(probe).toHaveBeenCalledTimes(4);
  });
});
