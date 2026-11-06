import type { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BoxHostRequests, boxHostClient, boxHostRequests } from "./box-host-client.js";
import { closeFakeBoxHosts, fakeBoxHost, shellBoxHost } from "./testing/fake-box-host.js";

const stand = vi.hoisted(() => ({ breakAfterFirstData: false, endings: [] as string[] }));

// The real node:net, except that each client socket records how it ended and, while a case sets
// breakAfterFirstData, is reset just after its first chunk: the order Linux gives when the shell
// handler stops reading a long line.
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  const createConnection = ((...args: Parameters<typeof actual.createConnection>) => {
    const socket: Socket = actual.createConnection(...args);
    const index = stand.endings.push("") - 1;
    const record = (ending: string) => {
      if (stand.endings[index] === "") stand.endings[index] = ending;
    };
    if (stand.breakAfterFirstData) {
      socket.once("data", () =>
        setImmediate(() =>
          socket.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })),
        ),
      );
    }
    socket.once("end", () => record("end"));
    socket.once("error", (error: NodeJS.ErrnoException) => record(`error:${error.code}`));
    return socket;
  }) as typeof actual.createConnection;
  return { ...actual, createConnection };
});

const PERSON = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" } as const;
const SERVER = { source: "server" } as const;

const SNAPSHOT_REPLY =
  '{"ok":true,"wired":{"connected":true,"address":"192.168.1.10"},"wifi":{"connectedSsidHex":"4361666550657065","savedSsidHex":"4361666550657065"},"change":null,"bootCopy":{"state":"current","reason":null,"failure":null}}\n';
const REQUEST_INVALID = '{"ok":false,"reason":"request_invalid"}\n';
const FIELDS_INVALID = '{"ok":false,"reason":"fields_invalid"}\n';

type Call = (client: BoxHostRequests) => Promise<unknown>;
const saeJoin = (psk: string, ssidHex = "4361666550657065"): Call => {
  return (client) => client.networkJoin({ ssidHex, keyMgmt: "sae", psk, hidden: false }, PERSON);
};
const JOIN_700 = saeJoin(`${"é".repeat(90)}x`);
const JOIN_701 = saeJoin(`${"é".repeat(90)}xx`);
const JOIN_975 = saeJoin("é".repeat(128), "ff".repeat(32));
const TAG_700: Call = (client) => client.tagWrite({ name: `a${"é".repeat(105)}`, live: true });
const TAG_701: Call = (client) => client.tagWrite({ name: `aa${"é".repeat(105)}`, live: true });
const TAG_3142: Call = (client) => client.tagWrite({ name: "😀".repeat(256), live: false });

const SHORT: Array<[string, Call, number]> = [
  ["a 700-character join", JOIN_700, 700],
  ["a 700-character name tag", TAG_700, 700],
];
const LONG: Array<[string, Call, number]> = [
  ["a 701-character join", JOIN_701, 701],
  ["a 701-character name tag", TAG_701, 701],
  ["a 975-character join", JOIN_975, 975],
  ["a 3142-character name tag", TAG_3142, 3142],
];

beforeEach(() => {
  stand.breakAfterFirstData = false;
  stand.endings.length = 0;
});
afterEach(async () => {
  stand.breakAfterFirstData = false;
  await closeFakeBoxHosts();
});

describe("boxHostRequests() and a line longer than the shell handler reads", () => {
  for (const [name, call, length] of [...SHORT, ...LONG]) {
    it(`sends ${name}`, async () => {
      const host = await fakeBoxHost((_line, socket) => socket.end(REQUEST_INVALID));
      await call(boxHostRequests({ socketPath: host.path }));
      expect(host.lines.map((line) => line.length)).toEqual([length]);
    });
  }

  for (const [name, call] of SHORT) {
    it(`reads request_invalid to ${name} as a refusal`, async () => {
      const host = await fakeBoxHost((_line, socket) => socket.end(REQUEST_INVALID));
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual({
        available: false,
        reason: "refused",
        refusal: "request_invalid",
      });
    });
  }

  for (const [name, call] of LONG.slice(0, 2)) {
    it(`reads request_invalid to ${name} as unsupported`, async () => {
      const host = await fakeBoxHost((_line, socket) => socket.end(REQUEST_INVALID));
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual({
        available: false,
        reason: "unsupported",
        detail: "request_invalid",
      });
    });
  }

  const OTHER_REFUSAL: Array<[string, Call]> = [
    ["a 701-character join", JOIN_701],
    ["a 3142-character name tag", TAG_3142],
  ];
  for (const [name, call] of OTHER_REFUSAL) {
    it(`reads another refusal to ${name} as a refusal`, async () => {
      const host = await fakeBoxHost((_line, socket) => socket.end(FIELDS_INVALID));
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual({
        available: false,
        reason: "refused",
        refusal: "fields_invalid",
      });
    });
  }
});

describe("boxHostRequests() and a reply before a broken connection", () => {
  beforeEach(() => {
    stand.breakAfterFirstData = true;
  });

  it("reads a complete snapshot as the answer", async () => {
    const host = await fakeBoxHost((_line, socket) => socket.write(SNAPSHOT_REPLY));
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: true,
      wired: { connected: true, address: "192.168.1.10" },
      wifi: { connectedSsidHex: "4361666550657065", savedSsidHex: "4361666550657065" },
      change: null,
      bootCopy: { state: "current", reason: null, failure: null },
    });
    expect(stand.endings).toEqual(["error:ECONNRESET"]);
  });

  it("reads a complete request_invalid to a 701-character join as unsupported", async () => {
    const host = await fakeBoxHost((_line, socket) => socket.write(REQUEST_INVALID));
    expect(await JOIN_701(boxHostRequests({ socketPath: host.path }))).toEqual({
      available: false,
      reason: "unsupported",
      detail: "request_invalid",
    });
    expect(stand.endings).toEqual(["error:ECONNRESET"]);
  });

  it("answers lost for a reply cut before its newline", async () => {
    const host = await fakeBoxHost((_line, socket) => socket.write('{"ok":tr'));
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "lost",
    });
    expect(stand.endings).toEqual(["error:ECONNRESET"]);
  });

  it("answers malformed for two lines", async () => {
    const host = await fakeBoxHost((_line, socket) =>
      socket.write(`${SNAPSHOT_REPLY}${SNAPSHOT_REPLY}`),
    );
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "malformed",
    });
    expect(stand.endings).toEqual(["error:ECONNRESET"]);
  });

  it("leaves the clock client answering lost for a complete reply", async () => {
    const host = await fakeBoxHost((_line, socket) =>
      socket.write(
        '{"ok":true,"service":"on","unit":"chrony.service","synchronised":false,"lastSyncAt":1793425000123,"nowMs":1793425411088}\n',
      ),
    );
    expect(await boxHostClient({ socketPath: host.path }).clockStatus()).toEqual({
      available: false,
      reason: "lost",
    });
    expect(stand.endings).toEqual(["error:ECONNRESET"]);
  });
});

describe("boxHostRequests() and a connection closed with no reply", () => {
  it("answers lost when the connection closed cleanly with no reply", async () => {
    const host = await fakeBoxHost((_line, socket) => socket.destroy());
    expect(await boxHostRequests({ socketPath: host.path }).networkRead(PERSON)).toEqual({
      available: false,
      reason: "lost",
    });
    expect(stand.endings).toEqual(["end"]);
  });
});

describe("boxHostRequests() against the real shell handler", () => {
  const UNKNOWN = { available: false, reason: "unsupported", detail: "unknown_request" };
  const INVALID = { available: false, reason: "unsupported", detail: "request_invalid" };
  const longEnding = process.platform === "linux" ? "error:ECONNRESET" : "end";

  const SEVEN: Array<[string, Call]> = [
    ["networkRead", (c) => c.networkRead(SERVER)],
    ["networkScan", (c) => c.networkScan(PERSON)],
    [
      "networkJoin",
      (c) =>
        c.networkJoin(
          { ssidHex: "4361666550657065", keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: false },
          PERSON,
        ),
    ],
    ["networkForget", (c) => c.networkForget({ ssidHex: "4361666550657065" }, PERSON)],
    ["screenRead", (c) => c.screenRead(SERVER)],
    ["screenSet", (c) => c.screenSet({ start: "till" }, PERSON)],
    ["tagWrite", (c) => c.tagWrite(null)],
  ];
  const CASES: Array<[string, Call, object, string]> = [
    ...SEVEN.map(([name, call]): [string, Call, object, string] => [name, call, UNKNOWN, "end"]),
    ...SHORT.map(([name, call]): [string, Call, object, string] => [name, call, UNKNOWN, "end"]),
    ...LONG.map(([name, call]): [string, Call, object, string] => [
      name,
      call,
      INVALID,
      longEnding,
    ]),
  ];
  for (const [name, call, expected, ending] of CASES) {
    it(`reads the handler's answer to ${name} as unsupported`, async () => {
      const host = await shellBoxHost();
      expect(await call(boxHostRequests({ socketPath: host.path }))).toEqual(expected);
      expect(stand.endings).toEqual([ending]);
      expect(host.stderr()).toBe("");
    });
  }
});
