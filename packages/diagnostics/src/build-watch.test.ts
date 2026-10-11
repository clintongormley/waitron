import { describe, expect, it, vi } from "vitest";
import { watchBuild } from "./build-watch.js";

const ORIGIN = "https://waitron.local";

/** Answers each call with the next build in turn; `null` answers with no build header. */
function serving(...builds: (string | null)[]) {
  const queue = [...builds];
  return vi.fn(async () => {
    const build = queue.shift() ?? null;
    return new Response("{}", { headers: build === null ? {} : { "x-waitron-build": build } });
  });
}

function watched(base: typeof fetch) {
  const onChange = vi.fn();
  return { fetch: watchBuild(base, { origin: ORIGIN, onChange }), onChange };
}

describe("watchBuild", () => {
  it("records the first build and stays quiet while it repeats", async () => {
    const { fetch, onChange } = watched(
      serving("a", "a", "a") as unknown as typeof globalThis.fetch,
    );
    for (let i = 0; i < 3; i++) await fetch("/api/node");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tells once, with the new build, however many builds follow", async () => {
    const { fetch, onChange } = watched(
      serving("a", "b", "b", "c") as unknown as typeof globalThis.fetch,
    );
    for (let i = 0; i < 4; i++) await fetch("/api/node");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ignores a response with no build header or an empty one, first or later", async () => {
    const { fetch, onChange } = watched(
      serving(null, "", "a", null, "", "a", "b") as unknown as typeof globalThis.fetch,
    );
    for (let i = 0; i < 6; i++) await fetch("/api/node");
    expect(onChange).not.toHaveBeenCalled();
    await fetch("/api/node");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("ignores another origin's build, and never takes it as the page's own", async () => {
    const { fetch, onChange } = watched(
      serving("z", "a", "z", "a") as unknown as typeof globalThis.fetch,
    );
    await fetch("https://standby.local/api/node");
    await fetch(`${ORIGIN}/api/node`);
    await fetch("https://standby.local/api/node");
    await fetch(`${ORIGIN}/api/node`);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reads a relative path as the page's origin", async () => {
    const { fetch, onChange } = watched(serving("a", "b") as unknown as typeof globalThis.fetch);
    await fetch(new Request(`${ORIGIN}/api/till`));
    await fetch("/management-api/session/me");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("reads a URL as the page's origin", async () => {
    const { fetch, onChange } = watched(serving("a", "b") as unknown as typeof globalThis.fetch);
    await fetch("/api/node");
    await fetch(new URL(`${ORIGIN}/api/till`));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("reads a Request as the page's origin", async () => {
    const { fetch, onChange } = watched(serving("a", "b") as unknown as typeof globalThis.fetch);
    await fetch("/api/node");
    await fetch(new Request(`${ORIGIN}/api/till`));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("treats a URL it cannot parse as another origin, without throwing", async () => {
    const { fetch, onChange } = watched(serving("a", "b") as unknown as typeof globalThis.fetch);
    await fetch("http://[");
    await fetch("/api/node");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("passes the request through and hands back the very response it got", async () => {
    const response = new Response("{}", { headers: { "x-waitron-build": "a" } });
    const base = vi.fn(async () => response);
    const { fetch } = watched(base as unknown as typeof globalThis.fetch);
    const init = { method: "POST", body: "{}" };
    expect(await fetch("/api/session", init)).toBe(response);
    expect(base).toHaveBeenCalledWith("/api/session", init);
  });

  it("rejects with the same error when the request fails", async () => {
    const failure = new TypeError("Failed to fetch");
    const { fetch, onChange } = watched(
      vi.fn(async () => {
        throw failure;
      }) as unknown as typeof globalThis.fetch,
    );
    await expect(fetch("/api/node")).rejects.toBe(failure);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hands back the response when onChange throws, and the error is thrown on its own", async () => {
    const realQueue = globalThis.queueMicrotask;
    const thrown: unknown[] = [];
    vi.stubGlobal("queueMicrotask", (task: () => void) =>
      realQueue(() => {
        try {
          task();
        } catch (error) {
          thrown.push(error);
        }
      }),
    );
    try {
      const failure = new Error("listener failed");
      const response = new Response("{}", { headers: { "x-waitron-build": "b" } });
      const base = vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { headers: { "x-waitron-build": "a" } }))
        .mockResolvedValueOnce(response);
      const fetch = watchBuild(base as unknown as typeof globalThis.fetch, {
        origin: ORIGIN,
        onChange: () => {
          throw failure;
        },
      });
      await fetch("/api/node");
      await expect(fetch("/api/node")).resolves.toBe(response);
      await Promise.resolve();
      expect(thrown).toEqual([failure]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("watchBuild when fetch followed a redirect", () => {
  /** What fetch hands back after following redirects: `url` names where the answer came from. */
  function answeredFrom(url: string, build: string): Response {
    const response = new Response("{}", { headers: { "x-waitron-build": build } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }

  it("ignores the build of another origin a redirect led to", async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(answeredFrom(`${ORIGIN}/api/node`, "own"))
      .mockResolvedValueOnce(answeredFrom("https://elsewhere.test/api/node", "other"));
    const { fetch, onChange } = watched(base as unknown as typeof globalThis.fetch);
    await fetch("/api/node");
    await fetch("/redirect");
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still reads the build of the page's own origin after a redirect within it", async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(answeredFrom(`${ORIGIN}/api/node`, "a"))
      .mockResolvedValueOnce(answeredFrom(`${ORIGIN}/api/node`, "b"));
    const { fetch, onChange } = watched(base as unknown as typeof globalThis.fetch);
    await fetch("/api/node");
    await fetch("/redirect");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
