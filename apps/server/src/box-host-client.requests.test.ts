import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import {
  type BoxHostRequests,
  boxHostRequests,
  DEFAULT_HOST_CHANGE_MS,
  DEFAULT_HOST_READ_MS,
  type HostActor,
  type WifiJoin,
} from "./box-host-client.js";
import { answer, closeFakeBoxHosts, fakeBoxHost, noBoxHostPath } from "./testing/fake-box-host.js";

vi.mock("node:net", async (original) => {
  const actual = await original<typeof import("node:net")>();
  return { ...actual, createConnection: vi.fn(actual.createConnection) };
});
const connects = vi.mocked(createConnection);

/** Turns the event loop until the fake host has read `count` lines; timers may be fake. */
async function untilLines(host: { lines: string[] }, count: number): Promise<void> {
  for (let turn = 0; turn < 1000 && host.lines.length < count; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(host.lines).toHaveLength(count);
}

/** Answers whether `promise` has settled, after letting its pending callbacks run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  for (let turn = 0; turn < 10; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return done;
}

const PERSON = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" } as const;
const SERVER = { source: "server" } as const;

const SNAPSHOT_REPLY =
  '{"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}\n';
const SNAPSHOT = {
  available: true,
  wired: { connected: true, address: "192.168.1.10" },
  wifi: { connectedSsidHex: "4361666550657065", savedSsidHex: "4361666550657065" },
  change: null,
  bootCopy: { state: "current", reason: null, failure: null },
};

const cleanups: Array<() => Promise<void>> = [];
let consoleSpies: MockInstance[] = [];
beforeEach(() => {
  consoleSpies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) =>
    vi.spyOn(console, name),
  );
});
afterEach(async () => {
  try {
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of consoleSpies) spy.mockRestore();
    for (const undo of cleanups.splice(0).reverse()) await undo();
    await closeFakeBoxHosts();
  }
});

describe("boxHostRequests().networkRead", () => {
  it("sends exactly the protocol's line for each actor, one connection per call", async () => {
    const host = await fakeBoxHost(answer(SNAPSHOT_REPLY));
    const client = boxHostRequests({ socketPath: host.path });
    await client.networkRead(PERSON);
    await client.networkRead(SERVER);
    expect(host.lines).toEqual([
      'network.read {"actor":{"source":"person","person":"0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11"}}',
      'network.read {"actor":{"source":"server"}}',
    ]);
    expect(host.connections()).toBe(2);
  });

  it("answers the host's network snapshot", async () => {
    const host = await fakeBoxHost(answer(SNAPSHOT_REPLY));
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual(SNAPSHOT);
  });

  it("answers a snapshot with no cable, a refused join and a failed boot copy", async () => {
    const host = await fakeBoxHost(
      answer(
        '{"ok":true,"wired":{"connected":false,"address":null},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":{"kind":"join","ssidHex":"4361666550657065","state":"refused","reason":"password-rejected"},"bootCopy":{"state":"failed","reason":null,"failure":"io-failed"}}\n',
      ),
    );
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(SERVER)).toEqual({
      available: true,
      wired: { connected: false, address: null },
      wifi: { connectedSsidHex: "4361666550657065", savedSsidHex: "4361666550657065" },
      change: {
        kind: "join",
        ssidHex: "4361666550657065",
        state: "refused",
        reason: "password-rejected",
      },
      bootCopy: { state: "failed", reason: null, failure: "io-failed" },
    });
  });

  for (const refusal of ["request_invalid", "actor_invalid", "fields_invalid", "host_failed"]) {
    it(`answers refused for the host's ${refusal}`, async () => {
      const host = await fakeBoxHost(answer(`{"ok":false,"reason":"${refusal}"}\n`));
      expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
        available: false,
        reason: "refused",
        refusal,
      });
      expect(host.lines[0]).toHaveLength(90);
    });
  }

  it("answers unsupported for the host's unknown_request", async () => {
    const host = await fakeBoxHost(answer('{"ok":false,"reason":"unknown_request"}\n'));
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "unsupported",
      detail: "unknown_request",
    });
  });

  it("answers malformed for a refusal network.read may not give", async () => {
    const host = await fakeBoxHost(answer('{"ok":false,"reason":"busy"}\n'));
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "malformed",
    });
  });

  const MALFORMED: Array<[string, string]> = [
    ["a line that is not JSON", "nope\n"],
    ["a snapshot without its newline", SNAPSHOT_REPLY.slice(0, -1)],
    ["a snapshot followed by a second newline", `${SNAPSHOT_REPLY}\n`],
    ["a snapshot ending in a carriage return and newline", `${SNAPSHOT_REPLY.slice(0, -1)}\r\n`],
    [
      "a snapshot with wired and wifi swapped",
      '{"ok":true,"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"wired":{"connected":true,"address":"192.168.1.10"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}\n',
    ],
    [
      "a snapshot with an extra key",
      '{"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null},"psk":"x"}\n',
    ],
    ["4096 bytes of x then the end", "x".repeat(4096)],
  ];
  for (const [name, text] of MALFORMED) {
    it(`answers malformed for ${name}`, async () => {
      const host = await fakeBoxHost(answer(text));
      expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
        available: false,
        reason: "malformed",
      });
    });
  }

  it("answers malformed at once, and stops reading, past 4096 bytes", async () => {
    let closed = false;
    const host = await fakeBoxHost((_line, socket) => {
      socket.on("close", () => (closed = true));
      socket.write("x".repeat(4097));
    });
    const started = performance.now();
    expect(
      await boxHostRequests({ socketPath: host.path, readMs: 5000 }).networkRead(PERSON),
    ).toEqual({ available: false, reason: "malformed" });
    expect(performance.now() - started).toBeLessThan(1000);
    await expect.poll(() => closed).toBe(true);
  });

  it("keeps waiting after exactly 4096 bytes with no end", async () => {
    const host = await fakeBoxHost((_line, socket) => {
      socket.write("x".repeat(4096));
    });
    expect(
      await boxHostRequests({ socketPath: host.path, readMs: 300 }).networkRead(PERSON),
    ).toEqual({ available: false, reason: "timeout" });
  });

  it("answers lost when the host ends the connection with nothing written", async () => {
    const host = await fakeBoxHost(answer(""));
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "lost",
    });
  });

  it("answers lost when the host drops the connection as soon as it is made", async () => {
    const dir = mkdtempSync(join(tmpdir(), "box-host-"));
    const path = join(dir, "box.sock");
    const server = createServer((socket: Socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(path, resolve));
    cleanups.push(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    });
    expect(await boxHostRequests({ socketPath: path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "lost",
    });
  });

  it("answers missing at once, naming ENOENT, when no socket is there", async () => {
    const started = performance.now();
    expect(await boxHostRequests({ socketPath: noBoxHostPath() }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "missing",
      detail: "ENOENT",
    });
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("answers missing, naming EACCES, for a socket it may not open", async () => {
    const host = await fakeBoxHost(answer(SNAPSHOT_REPLY));
    chmodSync(host.path, 0o000);
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "missing",
      detail: "EACCES",
    });
  });

  it("answers timeout at its limit when the host never answers", async () => {
    const host = await fakeBoxHost(() => {});
    const started = performance.now();
    expect(
      await boxHostRequests({ socketPath: host.path, readMs: 200 }).networkRead(PERSON),
    ).toEqual({ available: false, reason: "timeout" });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(1000);
  });

  const throwingSource = {
    get source(): never {
      throw new Error("no source");
    },
  };
  const UNSENDABLE: Array<[string, HostActor]> = [
    ["a person id with a space", { source: "person", person: "a b" }],
    ["a server actor carrying a person", { source: "server", person: "p1" } as never],
    ["an actor whose source throws", throwingSource as never],
  ];
  for (const [name, actor] of UNSENDABLE) {
    it(`answers invalid, and sends nothing, for ${name}`, async () => {
      const host = await fakeBoxHost(answer(SNAPSHOT_REPLY));
      expect(await boxHostRequests({ socketPath: host.path }).networkRead(actor)).toEqual({
        available: false,
        reason: "invalid",
      });
      expect(host.connections()).toBe(0);
    });
  }

  it("waits five seconds by default", async () => {
    expect(DEFAULT_HOST_READ_MS).toBe(5_000);
    const host = await fakeBoxHost(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = boxHostRequests({ socketPath: host.path }).networkRead(SERVER);
      await untilLines(host, 1);
      vi.advanceTimersByTime(4_999);
      expect(await settled(pending)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(await pending).toEqual({ available: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks the box's own socket when given no path", async () => {
    connects.mockClear();
    // No machine running this suite has the box's service.
    expect(await boxHostRequests({ readMs: 200 }).networkRead(SERVER)).toMatchObject({
      available: false,
      reason: "missing",
    });
    expect(connects.mock.calls).toEqual([["/run/waitron-box/box.sock"]]);
  });

  it("reads an empty path as no path, and asks the box's own socket", async () => {
    connects.mockClear();
    expect(
      await boxHostRequests({ socketPath: "", readMs: 200 }).networkRead(SERVER),
    ).toMatchObject({ available: false, reason: "missing" });
    expect(connects.mock.calls).toEqual([["/run/waitron-box/box.sock"]]);
  });

  it("answers missing, naming the error, for a path the connection refuses at once", async () => {
    // Node reads a path of only spaces as a port number and throws before connecting.
    expect(await boxHostRequests({ socketPath: " " }).networkRead(SERVER)).toEqual({
      available: false,
      reason: "missing",
      detail: "ERR_SOCKET_BAD_PORT",
    });
  });
});

const PERSON_JSON = '{"source":"person","person":"0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11"}';
const OK_EMPTY = '{"ok":true}\n';
const refusedLine = (word: string) => `{"ok":false,"reason":"${word}"}\n`;

type Call = (client: BoxHostRequests) => Promise<unknown>;
const JOIN: WifiJoin = {
  ssidHex: "4361666550657065",
  keyMgmt: "wpa-psk",
  psk: "abcdefgh",
  hidden: false,
};
const SIX: Array<[string, Call]> = [
  ["networkScan", (client) => client.networkScan(PERSON)],
  ["networkJoin", (client) => client.networkJoin(JOIN, PERSON)],
  ["networkForget", (client) => client.networkForget({ ssidHex: "4361666550657065" }, PERSON)],
  ["screenRead", (client) => client.screenRead(SERVER)],
  ["screenSet", (client) => client.screenSet({ start: "till" }, PERSON)],
  ["tagWrite", (client) => client.tagWrite(null)],
];
const CHANGING = SIX.filter(([name]) => name !== "screenRead");

describe("boxHostRequests(): the other six requests", () => {
  const LINES: Array<[string, Call, string]> = [
    ["networkScan", (c) => c.networkScan(PERSON), `network.scan {"actor":${PERSON_JSON}}`],
    [
      "networkJoin with wpa-psk",
      (c) => c.networkJoin(JOIN, PERSON),
      `network.join {"ssidHex":"4361666550657065","keyMgmt":"wpa-psk","psk":"abcdefgh","hidden":false,"actor":${PERSON_JSON}}`,
    ],
    [
      "networkJoin with sae to a hidden network",
      (c) => c.networkJoin({ ...JOIN, keyMgmt: "sae", hidden: true }, PERSON),
      `network.join {"ssidHex":"4361666550657065","keyMgmt":"sae","psk":"abcdefgh","hidden":true,"actor":${PERSON_JSON}}`,
    ],
    [
      "networkForget",
      (c) => c.networkForget({ ssidHex: "4361666550657065" }, PERSON),
      `network.forget {"ssidHex":"4361666550657065","actor":${PERSON_JSON}}`,
    ],
    ["screenRead", (c) => c.screenRead(SERVER), 'screen.read {"actor":{"source":"server"}}'],
    [
      "screenSet",
      (c) => c.screenSet({ start: "till" }, PERSON),
      `screen.set {"start":"till","actor":${PERSON_JSON}}`,
    ],
    [
      "tagWrite with no tag",
      (c) => c.tagWrite(null),
      'tag.write {"tag":null,"actor":{"source":"server"}}',
    ],
    [
      "tagWrite with a name",
      (c) => c.tagWrite({ name: "Café Pepe", live: true }),
      'tag.write {"tag":{"name":"Caf\\u00e9 Pepe","live":true},"actor":{"source":"server"}}',
    ],
  ];
  for (const [name, call, line] of LINES) {
    it(`sends exactly the protocol's line for ${name}`, async () => {
      const host = await fakeBoxHost(answer(refusedLine("host_failed")));
      await call(boxHostRequests({ socketPath: host.path }));
      expect(host.lines).toEqual([line]);
      expect(host.connections()).toBe(1);
    });
  }

  it("answers the networks a scan found", async () => {
    const host = await fakeBoxHost(
      answer(
        '{"ok":true,"networks":[{"ssidHex":"4361666550657065","signal":71,"security":"wpa-psk"},{"ssidHex":"ff","signal":0,"security":"other"}]}\n',
      ),
    );
    expect(await boxHostRequests({ socketPath: host.path }).networkScan(PERSON)).toEqual({
      available: true,
      networks: [
        { ssidHex: "4361666550657065", signal: 71, security: "wpa-psk" },
        { ssidHex: "ff", signal: 0, security: "other" },
      ],
    });
  });

  it("answers a scan that found nothing", async () => {
    const host = await fakeBoxHost(answer('{"ok":true,"networks":[]}\n'));
    expect(await boxHostRequests({ socketPath: host.path }).networkScan(PERSON)).toEqual({
      available: true,
      networks: [],
    });
  });

  it("answers exactly available for a started join and forget", async () => {
    const host = await fakeBoxHost(answer(OK_EMPTY));
    const client = boxHostRequests({ socketPath: host.path });
    expect(await client.networkJoin(JOIN, PERSON)).toStrictEqual({ available: true });
    expect(await client.networkForget({ ssidHex: "4361666550657065" }, PERSON)).toStrictEqual({
      available: true,
    });
  });

  it("answers the start screen the host read and set", async () => {
    const host = await fakeBoxHost(answer('{"ok":true,"start":"till"}\n'));
    const client = boxHostRequests({ socketPath: host.path });
    expect(await client.screenRead(PERSON)).toEqual({ available: true, start: "till" });
    expect(await client.screenSet({ start: "till" }, PERSON)).toEqual({
      available: true,
      start: "till",
    });
  });

  for (const outcome of ["written", "removed", "unchanged"]) {
    it(`answers the name tag ${outcome}`, async () => {
      const host = await fakeBoxHost(answer(`{"ok":true,"tag":"${outcome}"}\n`));
      expect(
        await boxHostRequests({ socketPath: host.path }).tagWrite({ name: "Bar", live: false }),
      ).toEqual({ available: true, tag: outcome });
    });
  }

  const OWN_REFUSALS: Array<[string, Call, string]> = [
    ["networkScan", SIX[0]![1], "busy"],
    ["networkScan", SIX[0]![1], "no_wifi"],
    ["networkJoin", SIX[1]![1], "busy"],
    ["networkJoin", SIX[1]![1], "no_wifi"],
    ["networkForget", SIX[2]![1], "busy"],
    ["networkForget", SIX[2]![1], "not_saved"],
    ["tagWrite", SIX[5]![1], "busy"],
    ["tagWrite", SIX[5]![1], "no_free_token"],
    ["tagWrite", SIX[5]![1], "header_unreadable"],
    ["tagWrite", SIX[5]![1], "no_space"],
  ];
  const PROTOCOL_REFUSALS = SIX.flatMap(([name, call]) =>
    ["request_invalid", "actor_invalid", "fields_invalid", "host_failed"].map(
      (word): [string, Call, string] => [name, call, word],
    ),
  );
  for (const [name, call, word] of [...OWN_REFUSALS, ...PROTOCOL_REFUSALS]) {
    it(`answers refused for ${name}'s ${word}`, async () => {
      const host = await fakeBoxHost(answer(refusedLine(word)));
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual({
        available: false,
        reason: "refused",
        refusal: word,
      });
    });
  }

  const OTHERS_REFUSALS: Array<[string, Call, string]> = [
    ["networkJoin", SIX[1]![1], "not_saved"],
    ["networkForget", SIX[2]![1], "no_wifi"],
    ["screenSet", SIX[4]![1], "busy"],
  ];
  for (const [name, call, word] of OTHERS_REFUSALS) {
    it(`answers malformed for ${word}, which ${name} may not answer`, async () => {
      const host = await fakeBoxHost(answer(refusedLine(word)));
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual({
        available: false,
        reason: "malformed",
      });
    });
  }

  it("reads unknown_request as unsupported for that request only", async () => {
    const host = await fakeBoxHost((line, socket) =>
      socket.end(
        line.startsWith("network.scan ") ? refusedLine("unknown_request") : SNAPSHOT_REPLY,
      ),
    );
    const client = boxHostRequests({ socketPath: host.path });
    const unsupported = { available: false, reason: "unsupported", detail: "unknown_request" };
    expect(await client.networkScan(PERSON)).toEqual(unsupported);
    expect(await client.networkRead(PERSON)).toEqual(SNAPSHOT);
    expect(await client.networkScan(PERSON)).toEqual(unsupported);
    expect(host.connections()).toBe(3);
  });

  const UNSENDABLE_CALLS: Array<[string, Call]> = [
    ["a join with wpa-eap", (c) => c.networkJoin({ ...JOIN, keyMgmt: "wpa-eap" as never }, PERSON)],
    [
      "a join with a 7-character password",
      (c) => c.networkJoin({ ...JOIN, psk: "abcdefg" }, PERSON),
    ],
    [
      "a join carrying an extra key",
      (c) => c.networkJoin({ ...JOIN, note: "x" } as WifiJoin, PERSON),
    ],
    ["a forget of upper-case hex", (c) => c.networkForget({ ssidHex: "FF" }, PERSON)],
    ["an unknown start screen", (c) => c.screenSet({ start: "Panel" as never }, PERSON)],
    ["an empty name tag", (c) => c.tagWrite({ name: "", live: true })],
    ["a decomposed name tag", (c) => c.tagWrite({ name: "Café", live: true })],
    [
      "a name tag carrying an extra key",
      (c) => c.tagWrite({ name: "Bar", live: true, extra: 1 } as never),
    ],
    ["a scan asked by the server", (c) => c.networkScan(SERVER as never)],
  ];
  for (const [name, call] of UNSENDABLE_CALLS) {
    it(`answers invalid, and sends nothing, for ${name}`, async () => {
      const host = await fakeBoxHost(answer(OK_EMPTY));
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual({
        available: false,
        reason: "invalid",
      });
      expect(host.connections()).toBe(0);
    });
  }

  for (const [name, call] of CHANGING) {
    it(`${name} waits changeMs before answering timeout`, async () => {
      const host = await fakeBoxHost(() => {});
      const started = performance.now();
      expect(await call(boxHostRequests({ socketPath: host.path, changeMs: 200 }))).toEqual({
        available: false,
        reason: "timeout",
      });
      const elapsed = performance.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(190);
      expect(elapsed).toBeLessThan(1000);
    });
  }

  it("screenRead waits readMs, not changeMs", async () => {
    const host = await fakeBoxHost(() => {});
    const started = performance.now();
    expect(
      await boxHostRequests({ socketPath: host.path, readMs: 200, changeMs: 5000 }).screenRead(
        SERVER,
      ),
    ).toEqual({ available: false, reason: "timeout" });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("networkScan waits changeMs, not readMs", async () => {
    const host = await fakeBoxHost(() => {});
    const started = performance.now();
    expect(
      await boxHostRequests({ socketPath: host.path, readMs: 200, changeMs: 600 }).networkScan(
        PERSON,
      ),
    ).toEqual({ available: false, reason: "timeout" });
    expect(performance.now() - started).toBeGreaterThanOrEqual(590);
  });

  it("waits twenty seconds by default for a change, past the host's own fifteen", async () => {
    expect(DEFAULT_HOST_CHANGE_MS).toBe(20_000);
    const host = await fakeBoxHost(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = boxHostRequests({ socketPath: host.path }).networkScan(PERSON);
      await untilLines(host, 1);
      vi.advanceTimersByTime(19_999);
      expect(await settled(pending)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(await pending).toEqual({ available: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("boxHostRequests().networkJoin keeps the password in the request line", () => {
  const CANARY = "Canary-psk-7f3a91";
  const CANARY_JOIN: WifiJoin = { ...JOIN, psk: CANARY };
  const INVALID = { available: false, reason: "invalid" };
  const RUNS: Array<[string, (line: string, socket: Socket) => void, WifiJoin, object]> = [
    ["a started join", answer(OK_EMPTY), CANARY_JOIN, { available: true }],
    [
      "a busy refusal",
      answer(refusedLine("busy")),
      CANARY_JOIN,
      { available: false, reason: "refused", refusal: "busy" },
    ],
    [
      "a reply that names the password",
      answer('{"ok":true,"psk":"Canary-psk-7f3a91"}\n'),
      CANARY_JOIN,
      { available: false, reason: "malformed" },
    ],
    [
      "a refusal worded as the password",
      answer('{"ok":false,"reason":"Canary-psk-7f3a91"}\n'),
      CANARY_JOIN,
      { available: false, reason: "malformed" },
    ],
    ["no reply", answer(""), CANARY_JOIN, { available: false, reason: "lost" }],
    [
      "a join the protocol refuses to write",
      answer(OK_EMPTY),
      { ...CANARY_JOIN, keyMgmt: "wpa-eap" as never },
      INVALID,
    ],
  ];
  for (const [name, reply, join, expected] of RUNS) {
    it(`keeps it out of the answer for ${name}`, async () => {
      const host = await fakeBoxHost(reply);
      const result = await boxHostRequests({ socketPath: host.path }).networkJoin(join, PERSON);
      expect(JSON.stringify(result)).not.toContain(CANARY);
      expect(result).toStrictEqual(expected);
      expect(host.lines.map((line) => line.split(CANARY).length)).toEqual(
        expected === INVALID ? [] : [2],
      );
    });
  }
});
