import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

const URL_A = "http://a.test";

describe("createClient — probeNode", () => {
  it("returns the node probe on 200 and calls /api/node on the given origin", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        reply(200, { nodeId: "n1", term: 3, acceptingSales: true, environment: "preproduction" }),
      );
    const client = createClient({ fetch: fetchImpl });
    expect(await client.probeNode(URL_A)).toEqual({
      ok: true,
      value: { nodeId: "n1", term: 3, acceptingSales: true, environment: "preproduction" },
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${URL_A}/api/node`);
  });

  it("defaults a missing term to null", async () => {
    const client = createClient({
      fetch: vi
        .fn()
        .mockResolvedValue(
          reply(200, { nodeId: "n1", acceptingSales: false, environment: "preproduction" }),
        ),
    });
    const result = await client.probeNode(URL_A);
    expect(result).toMatchObject({ ok: true, value: { term: null } });
  });

  it("a thrown fetch, a timeout and a 5xx are all `unreachable`", async () => {
    const thrown = createClient({ fetch: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) });
    expect(await thrown.probeNode(URL_A)).toMatchObject({
      ok: false,
      failure: { kind: "unreachable" },
    });

    const never = createClient({
      fetch: vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
      timeoutMs: 10,
    });
    expect(await never.probeNode(URL_A)).toMatchObject({
      ok: false,
      failure: { kind: "unreachable" },
    });

    const down = createClient({ fetch: vi.fn().mockResolvedValue(reply(503)) });
    expect(await down.probeNode(URL_A)).toMatchObject({
      ok: false,
      failure: { kind: "unreachable" },
    });
  });

  it("401 is unauthorized; another 4xx is bad_reply", async () => {
    const unauth = createClient({ fetch: vi.fn().mockResolvedValue(reply(401)) });
    expect(await unauth.probeNode(URL_A)).toEqual({ ok: false, failure: { kind: "unauthorized" } });
    const odd = createClient({ fetch: vi.fn().mockResolvedValue(reply(418)) });
    expect(await odd.probeNode(URL_A)).toMatchObject({ ok: false, failure: { kind: "bad_reply" } });
  });

  it("a 200 that is not JSON, or is missing a required field, is bad_reply", async () => {
    const notJson = createClient({
      fetch: vi.fn().mockResolvedValue(new Response("hello", { status: 200 })),
    });
    expect(await notJson.probeNode(URL_A)).toMatchObject({
      ok: false,
      failure: { kind: "bad_reply" },
    });
    for (const body of [
      { nodeId: "n1" },
      { nodeId: 1, acceptingSales: true, environment: "x" },
      { nodeId: "n", acceptingSales: "yes", environment: "x" },
    ]) {
      const client = createClient({ fetch: vi.fn().mockResolvedValue(reply(200, body)) });
      expect(await client.probeNode(URL_A)).toMatchObject({
        ok: false,
        failure: { kind: "bad_reply" },
      });
    }
  });

  it("clears the timeout on success (the process is not held open by a pending timer)", async () => {
    vi.useFakeTimers();
    try {
      const client = createClient({
        fetch: vi.fn().mockResolvedValue(
          reply(200, {
            nodeId: "n",
            term: null,
            acceptingSales: true,
            environment: "preproduction",
          }),
        ),
      });
      await client.probeNode(URL_A);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
