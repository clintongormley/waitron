import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

function stub(status: number, body?: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(reply(status, body)) as unknown as typeof fetch;
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

  it("a 200 whose body is the literal null is bad_reply", async () => {
    // `typeof null === "object"`, so the shape guard's null check is the only thing refusing this.
    const client = createClient({ fetch: vi.fn().mockResolvedValue(reply(200, null)) });
    expect(await client.probeNode(URL_A)).toMatchObject({
      ok: false,
      failure: { kind: "bad_reply" },
    });
  });

  it("a fetch that throws a non-Error still yields unreachable, with the value stringified", async () => {
    const client = createClient({ fetch: vi.fn().mockRejectedValue("socket hang up") });
    expect(await client.probeNode(URL_A)).toEqual({
      ok: false,
      failure: { kind: "unreachable", detail: "socket hang up" },
    });
  });

  it("a rejection that cannot be stringified is still unreachable, not a throw", async () => {
    const hostile = {
      toString() {
        throw new Error("hostile toString");
      },
    };
    const client = createClient({ fetch: vi.fn().mockRejectedValue(hostile) });
    await expect(client.probeNode(URL_A)).resolves.toMatchObject({
      ok: false,
      failure: { kind: "unreachable" },
    });
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

describe("createClient — join", () => {
  it("POSTs { name } to /print-api/agent/join and returns { token, verificationNumber }", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(reply(201, { token: "a1.secret", verificationNumber: "07" }));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.join(URL_A, "kitchen-pi")).toEqual({
      ok: true,
      value: { token: "a1.secret", verificationNumber: "07" },
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/join`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "kitchen-pi" });
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("maps 403 → pairing_closed and 429 → rate_limited", async () => {
    const closed = createClient({
      fetch: vi.fn().mockResolvedValue(reply(403, { code: "device.pairing_closed" })),
    });
    expect(await closed.join(URL_A, "x")).toEqual({
      ok: false,
      failure: { kind: "pairing_closed" },
    });
    const limited = createClient({
      fetch: vi.fn().mockResolvedValue(reply(429, { code: "device.join_rate_limited" })),
    });
    expect(await limited.join(URL_A, "x")).toEqual({
      ok: false,
      failure: { kind: "rate_limited" },
    });
  });

  it("a 201 whose body is not JSON, or is a JSON non-object, is bad_reply", async () => {
    for (const response of [
      new Response("hello", { status: 201 }),
      reply(201, "a1.secret"),
      reply(201, null),
    ]) {
      const client = createClient({ fetch: vi.fn().mockResolvedValue(response) });
      expect(await client.join(URL_A, "x")).toEqual({
        ok: false,
        failure: { kind: "bad_reply", detail: "invalid response body" },
      });
    }
  });

  it("a body missing verificationNumber is bad_reply", async () => {
    const client = createClient({
      fetch: vi.fn().mockResolvedValue(reply(201, { token: "a1.secret" })),
    });
    expect(await client.join(URL_A, "x")).toMatchObject({
      ok: false,
      failure: { kind: "bad_reply" },
    });
  });
});

describe("createClient — enrolSelf", () => {
  it("enrolSelf returns the token on 201", async () => {
    const client = createClient({ fetch: stub(201, { token: "id.secret" }) });
    const r = await client.enrolSelf("https://127.0.0.1", "box");
    expect(r).toEqual({ ok: true, value: { token: "id.secret" } });
  });

  it("enrolSelf POSTs { name } to /api/node/enrol-self", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(201, { token: "id.secret" }));
    const client = createClient({ fetch: fetchImpl });
    await client.enrolSelf("https://127.0.0.1", "box");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://127.0.0.1/api/node/enrol-self");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "box" });
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("enrolSelf folds any non-2xx into a refusal, not a throw", async () => {
    for (const [status, code] of [
      [409, "node.enrol_unavailable"],
      [403, "node.enrol_not_local"],
    ] as const) {
      const client = createClient({ fetch: stub(status, { code }) });
      const r = await client.enrolSelf("https://127.0.0.1", "box");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.failure.kind).toBe("refused"); // the loop only checks r.ok; kind is diagnostic
    }
  });

  it("enrolSelf folds a 201 without a usable token into a refusal", async () => {
    for (const response of [
      reply(201, {}),
      reply(201, { token: 7 }),
      new Response("created", { status: 201 }),
    ]) {
      const client = createClient({ fetch: vi.fn().mockResolvedValue(response) });
      expect(await client.enrolSelf("https://127.0.0.1", "box")).toEqual({
        ok: false,
        failure: { kind: "refused" },
      });
    }
  });

  it("enrolSelf gives up at its deadline and reports unreachable", async () => {
    const client = createClient({
      fetch: vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
      timeoutMs: 10,
    });
    expect(await client.enrolSelf("https://127.0.0.1", "box")).toEqual({
      ok: false,
      failure: { kind: "unreachable", detail: "aborted" },
    });
  });

  it("enrolSelf folds a network error into a Failure", async () => {
    const client = createClient({ fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    const r = await client.enrolSelf("https://127.0.0.1", "box");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe("unreachable");
  });
});

describe("createClient — joinStatus", () => {
  it("sends the Bearer and decodes the status string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { status: "approved" }));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.joinStatus(URL_A, "a1.secret")).toEqual({ ok: true, value: "approved" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/join/status`);
    expect(init.headers.authorization).toBe("Bearer a1.secret");
  });

  it("an unknown status string is bad_reply", async () => {
    const client = createClient({
      fetch: vi.fn().mockResolvedValue(reply(200, { status: "weird" })),
    });
    expect(await client.joinStatus(URL_A, "t")).toMatchObject({
      ok: false,
      failure: { kind: "bad_reply" },
    });
  });
});

describe("createClient — pullJobs", () => {
  it("sends the Bearer, decodes base64 payloads, returns servers + nodeId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(200, {
        nodeId: "n1",
        servers: [{ nodeId: "n1", url: "http://a.test", standing: "serving-primary" }],
        jobs: [
          {
            id: "j1",
            printerId: "p1",
            transport: "network_tcp",
            host: "10.0.0.9",
            port: 9100,
            localKey: null,
            payload: Buffer.from([1, 2, 3]).toString("base64"),
          },
        ],
      }),
    );
    const client = createClient({ fetch: fetchImpl });
    const result = await client.pullJobs(URL_A, "a1.secret", { visible: [], scanned: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodeId).toBe("n1");
    expect(result.value.servers).toEqual([{ url: "http://a.test", nodeId: "n1" }]);
    expect(result.value.jobs[0]!.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.value.discoveryUntil).toBeNull();
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${URL_A}/print-api/agent/jobs`);
    expect(fetchImpl.mock.calls[0]![1].headers.authorization).toBe("Bearer a1.secret");
  });

  it("decodes bounded address probes without letting a malformed target block jobs", async () => {
    const target = { host: "192.168.20.247", port: 9100, expiresInMs: 30000 };
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(200, {
        nodeId: "n",
        servers: [],
        jobs: [],
        discoveryUntil: null,
        networkProbes: [
          target,
          null,
          { ...target, port: 0 },
          { ...target, expiresInMs: "later" },
          { ...target, expiresInMs: 0 },
          { ...target, expiresInMs: -1 },
          { ...target, expiresInMs: 30_001 },
        ],
      }),
    );
    const result = await createClient({ fetch: fetchImpl }).pullJobs("http://s", "tok", {
      visible: [],
      scanned: [],
    });
    expect(result.ok && result.value.networkProbes).toEqual([target]);
  });

  it("posts the inventory and parses discoveryUntil + localKey", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply(200, {
        nodeId: "n",
        servers: [],
        jobs: [
          {
            id: "j",
            printerId: "p",
            transport: "usb",
            localKey: "SN-1",
            payload: Buffer.from([0xaa]).toString("base64"),
          },
        ],
        discoveryUntil: 123,
      }),
    );
    const client = createClient({ fetch: fetchImpl });
    const inventory = { visible: [{ transport: "usb" as const, localKey: "SN-1" }], scanned: [] };
    const r = await client.pullJobs("http://s", "tok", inventory);
    expect(r.ok && r.value.jobs[0]!.localKey).toBe("SN-1");
    expect(r.ok && r.value.discoveryUntil).toBe(123);
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual(inventory);
  });

  it("skips a server entry without a string url and keeps a url-only entry without a nodeId", async () => {
    const client = createClient({
      fetch: vi.fn().mockResolvedValue(
        reply(200, {
          nodeId: "n1",
          servers: [null, "http://c.test", { nodeId: "n3" }, { url: 5 }, { url: "http://b.test" }],
          jobs: [],
        }),
      ),
    });
    const result = await client.pullJobs(URL_A, "t", { visible: [], scanned: [] });
    expect(result.ok && result.value.servers).toEqual([{ url: "http://b.test" }]);
  });

  it("a reply that is not a JSON object is bad_reply", async () => {
    for (const response of [new Response("hello", { status: 200 }), reply(200, null)]) {
      const client = createClient({ fetch: vi.fn().mockResolvedValue(response) });
      expect(await client.pullJobs(URL_A, "t", { visible: [], scanned: [] })).toEqual({
        ok: false,
        failure: { kind: "bad_reply", detail: "invalid response body" },
      });
    }
  });

  it("a job entry that is not an object, or lacks a string field, makes the whole reply bad_reply", async () => {
    const good = {
      id: "j1",
      printerId: "p1",
      transport: "usb",
      localKey: "SN-1",
      payload: Buffer.from([1]).toString("base64"),
    };
    for (const bad of [null, "j2", { ...good, id: 2 }, { ...good, payload: undefined }]) {
      const client = createClient({
        fetch: vi
          .fn()
          .mockResolvedValue(reply(200, { nodeId: "n1", servers: [], jobs: [good, bad] })),
      });
      expect(await client.pullJobs(URL_A, "t", { visible: [], scanned: [] })).toEqual({
        ok: false,
        failure: { kind: "bad_reply", detail: "invalid response body" },
      });
    }
  });

  it("401 → unauthorized; a reply whose jobs is not an array is bad_reply", async () => {
    const inv = { visible: [], scanned: [] };
    const unauth = createClient({
      fetch: vi.fn().mockResolvedValue(reply(401, { code: "agent.unauthorized" })),
    });
    expect(await unauth.pullJobs(URL_A, "t", inv)).toEqual({
      ok: false,
      failure: { kind: "unauthorized" },
    });
    const bad = createClient({
      fetch: vi.fn().mockResolvedValue(reply(200, { nodeId: "n1", servers: [], jobs: "no" })),
    });
    expect(await bad.pullJobs(URL_A, "t", inv)).toMatchObject({
      ok: false,
      failure: { kind: "bad_reply" },
    });
  });
});

describe("createClient — report", () => {
  it("POSTs the outcome to the job's result route and resolves on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(204));
    const client = createClient({ fetch: fetchImpl });
    expect(await client.report(URL_A, "t", "j1", { status: "failed", error: "boom" })).toEqual({
      ok: true,
      value: undefined,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${URL_A}/print-api/agent/jobs/j1/result`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ status: "failed", error: "boom" });
    expect(init.headers.authorization).toBe("Bearer t");
  });

  it("a thrown fetch on report is unreachable (so the loop drops it, the lease reclaims)", async () => {
    const client = createClient({ fetch: vi.fn().mockRejectedValue(new Error("ECONNRESET")) });
    expect(await client.report(URL_A, "t", "j1", { status: "done" })).toMatchObject({
      ok: false,
      failure: { kind: "unreachable" },
    });
  });
});
