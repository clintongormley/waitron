import { describe, expect, it, vi } from "vitest";
import { createClient, isBluetoothAddress, isBluetoothPin } from "./client.js";

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
const NO_INVENTORY = { visible: [], scanned: [], pairedBluetooth: [], bluetoothOutcomes: [] };

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
    const result = await client.pullJobs(URL_A, "a1.secret", NO_INVENTORY);
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
    const result = await createClient({ fetch: fetchImpl }).pullJobs(
      "http://s",
      "tok",
      NO_INVENTORY,
    );
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
    const inventory = {
      visible: [{ transport: "usb" as const, localKey: "SN-1" }],
      scanned: [],
      pairedBluetooth: [
        { localKey: "AA:BB:CC:DD:EE:FF", name: "TM-P20" },
        { localKey: "11:22:33:44:55:66" },
      ],
      bluetoothOutcomes: [
        { id: "c1", ok: true },
        { id: "c2", ok: false, error: "Failed to pair: org.bluez.Error.AuthenticationFailed" },
      ],
      setupUrl: "http://192.168.10.40:9310",
      setupPort: 9210,
    };
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
    const result = await client.pullJobs(URL_A, "t", NO_INVENTORY);
    expect(result.ok && result.value.servers).toEqual([{ url: "http://b.test" }]);
  });

  it("a reply that is not a JSON object is bad_reply", async () => {
    for (const response of [new Response("hello", { status: 200 }), reply(200, null)]) {
      const client = createClient({ fetch: vi.fn().mockResolvedValue(response) });
      expect(await client.pullJobs(URL_A, "t", NO_INVENTORY)).toEqual({
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
      expect(await client.pullJobs(URL_A, "t", NO_INVENTORY)).toEqual({
        ok: false,
        failure: { kind: "bad_reply", detail: "invalid response body" },
      });
    }
  });

  it("401 → unauthorized; a reply whose jobs is not an array is bad_reply", async () => {
    const inv = NO_INVENTORY;
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

describe("createClient — Bluetooth commands", () => {
  const MAC = "AA:BB:CC:DD:EE:FF";
  const pull = async (bluetoothCommands: unknown, jobs: unknown[] = []) => {
    const body: Record<string, unknown> = { nodeId: "n", servers: [], jobs };
    if (bluetoothCommands !== undefined) body.bluetoothCommands = bluetoothCommands;
    return createClient({ fetch: stub(200, body) }).pullJobs(URL_A, "t", NO_INVENTORY);
  };
  const commandsOf = async (bluetoothCommands: unknown) => {
    const result = await pull(bluetoothCommands);
    if (!result.ok) throw new Error(`pull failed: ${JSON.stringify(result.failure)}`);
    return result.value.bluetoothCommands;
  };

  it("an older server that sends no commands leaves the field out of the reply", async () => {
    const result = await pull(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("bluetoothCommands" in result.value).toBe(false);
  });

  it("a reply whose commands decode to nothing leaves the field out too", async () => {
    const result = await pull([{ id: "c1", kind: "reboot", address: MAC }]);
    expect(result.ok && "bluetoothCommands" in result.value).toBe(false);
  });

  it("decodes pair and forget commands and upper-cases the address", async () => {
    expect(
      await commandsOf([
        { id: "c1", kind: "pair", address: "aa:bb:cc:dd:ee:ff" },
        { id: "c2", kind: "forget", address: "11:22:33:44:55:6a" },
      ]),
    ).toEqual([
      { id: "c1", kind: "pair", address: MAC },
      { id: "c2", kind: "forget", address: "11:22:33:44:55:6A" },
    ]);
  });

  it.each([
    ["an address of *, which bluetoothctl reads as every device", "*"],
    ["an empty address", ""],
    ["five octets", "AA:BB:CC:DD:EE"],
    ["seven octets", "AA:BB:CC:DD:EE:FF:00"],
    ["dash separators", "AA-BB-CC-DD-EE-FF"],
    ["a non-hex digit", "AA:BB:CC:DD:EE:FG"],
    ["a single-digit octet", "A:BB:CC:DD:EE:FF"],
    ["a trailing newline", "AA:BB:CC:DD:EE:FF\n"],
    ["a leading space", " AA:BB:CC:DD:EE:FF"],
    ["a non-string address", 0xaabbccddeeff],
    ["an address inside a list, which reads as a MAC once made a string", [MAC]],
  ])("drops a command with %s", async (_, address) => {
    expect(
      await commandsOf([
        { id: "bad", kind: "forget", address },
        { id: "good", kind: "forget", address: MAC },
      ]),
    ).toEqual([{ id: "good", kind: "forget", address: MAC }]);
  });

  it.each([
    ["an unknown kind", { id: "bad", kind: "trust", address: MAC }],
    ["a kind in another case", { id: "bad", kind: "Pair", address: MAC }],
    ["no kind", { id: "bad", address: MAC }],
    ["a non-string id", { id: 7, kind: "pair", address: MAC }],
    ["an empty id", { id: "", kind: "pair", address: MAC }],
    ["an id over 128 characters", { id: "x".repeat(129), kind: "pair", address: MAC }],
    ["a null entry", null],
    ["a string entry", "pair"],
  ])("drops %s", async (_, entry) => {
    expect(await commandsOf([entry, { id: "good", kind: "forget", address: MAC }])).toEqual([
      { id: "good", kind: "forget", address: MAC },
    ]);
  });

  it("keeps an id of exactly 128 characters", async () => {
    const id = "x".repeat(128);
    expect(await commandsOf([{ id, kind: "forget", address: MAC }])).toEqual([
      { id, kind: "forget", address: MAC },
    ]);
  });

  it("reads only the first eight entries, counting the ones it drops", async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      kind: "forget",
      address: MAC,
    }));
    entries[2] = { id: "c2", kind: "reboot", address: MAC };
    expect((await commandsOf(entries))?.map((c) => c.id)).toEqual([
      "c0",
      "c1",
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
    ]);
  });

  it.each([["not a list"], [{ id: "c1", kind: "pair", address: MAC }], [null]])(
    "treats a commands field that is not a list (%j) as none, and still delivers the jobs",
    async (bluetoothCommands) => {
      const job = {
        id: "j1",
        printerId: "p1",
        transport: "usb",
        localKey: "SN-1",
        payload: Buffer.from([1]).toString("base64"),
      };
      const result = await pull(bluetoothCommands, [job]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.jobs.map((j) => j.id)).toEqual(["j1"]);
      expect("bluetoothCommands" in result.value).toBe(false);
    },
  );

  it("an invalid job still refuses the whole reply, valid commands or not", async () => {
    expect(await pull([{ id: "c1", kind: "pair", address: MAC }], [{ id: 1 }])).toEqual({
      ok: false,
      failure: { kind: "bad_reply", detail: "invalid response body" },
    });
  });

  describe("the operator's PIN on a pair command", () => {
    it.each(["1234", "0", "!", "~", "a".repeat(16), "Ab1~!#"])("keeps the PIN %j", async (pin) => {
      expect(await commandsOf([{ id: "c1", kind: "pair", address: MAC, pin }])).toEqual([
        { id: "c1", kind: "pair", address: MAC, pin },
      ]);
    });

    it("keeps a pair command with no PIN, without a pin key", async () => {
      const commands = await commandsOf([{ id: "c1", kind: "pair", address: MAC }]);
      expect(commands).toEqual([{ id: "c1", kind: "pair", address: MAC }]);
      expect("pin" in commands![0]!).toBe(false);
    });

    it.each([
      ["an empty PIN", ""],
      ["a PIN over 16 characters", "1".repeat(17)],
      ["a PIN with a space", "12 34"],
      ["a PIN ending in a newline", "1234\n"],
      ["a PIN with a carriage return", "12\r34"],
      ["a PIN with a tab", "12\t34"],
      ["a PIN with a non-ASCII character", "12€4"],
      ["a PIN with a delete character", "123\x7f"],
      ["a numeric PIN", 1234],
      ["a null PIN", null],
    ])("drops a pair command carrying %s whole", async (_, pin) => {
      expect(
        await commandsOf([
          { id: "bad", kind: "pair", address: MAC, pin },
          { id: "good", kind: "pair", address: MAC },
        ]),
      ).toEqual([{ id: "good", kind: "pair", address: MAC }]);
    });

    it("drops a PIN sent on a forget command but keeps the command", async () => {
      const commands = await commandsOf([{ id: "c1", kind: "forget", address: MAC, pin: "1234" }]);
      expect(commands).toEqual([{ id: "c1", kind: "forget", address: MAC }]);
      expect("pin" in commands![0]!).toBe(false);
    });

    it("drops even an invalid PIN on a forget command rather than the command", async () => {
      expect(await commandsOf([{ id: "c1", kind: "forget", address: MAC, pin: "12\n34" }])).toEqual(
        [{ id: "c1", kind: "forget", address: MAC }],
      );
    });

    it("never copies a field the wire does not define", async () => {
      expect(
        await commandsOf([{ id: "c1", kind: "pair", address: MAC, pin: "1234", extra: "x" }]),
      ).toEqual([{ id: "c1", kind: "pair", address: MAC, pin: "1234" }]);
    });
  });
});

describe("createClient — pullJobs body bounds", () => {
  it("cuts a command outcome's error to 500 characters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { nodeId: "n", servers: [], jobs: [] }));
    await createClient({ fetch: fetchImpl }).pullJobs(URL_A, "t", {
      ...NO_INVENTORY,
      bluetoothOutcomes: [
        { id: "c1", ok: false, error: `${"e".repeat(500)}TAIL` },
        { id: "c2", ok: false, error: "short" },
        { id: "c3", ok: true },
      ],
    });
    const sent = JSON.parse(fetchImpl.mock.calls[0]![1].body as string);
    expect(sent.bluetoothOutcomes).toEqual([
      { id: "c1", ok: false, error: "e".repeat(500) },
      { id: "c2", ok: false, error: "short" },
      { id: "c3", ok: true },
    ]);
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

// The app validates a pair or forget command with these before it spawns bluetoothctl, so the rule
// the wire decoder applies is the one the child process sees.
describe("isBluetoothAddress / isBluetoothPin", () => {
  it("accepts a full address in either case, and nothing shorter, longer or wildcarded", () => {
    expect(isBluetoothAddress("5A:4A:45:D4:FB:BB")).toBe(true);
    expect(isBluetoothAddress("5a:4a:45:d4:fb:bb")).toBe(true);
    for (const bad of ["*", "", "5A:4A:45:D4:FB", "5A:4A:45:D4:FB:BB:CC", "5A-4A-45-D4-FB-BB"])
      expect(isBluetoothAddress(bad)).toBe(false);
  });

  it("accepts 1 to 16 printable ASCII characters and refuses a space, a newline or 17", () => {
    expect(isBluetoothPin("0")).toBe(true);
    expect(isBluetoothPin("~".repeat(16))).toBe(true);
    for (const bad of ["", "1".repeat(17), "12 34", "1234\n", "12\x7f"])
      expect(isBluetoothPin(bad)).toBe(false);
  });
});
