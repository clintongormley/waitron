import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { boxHostRequests, DEFAULT_HOST_READ_MS, type HostActor } from "./box-host-client.js";
import { answer, closeFakeBoxHosts, fakeBoxHost, noBoxHostPath } from "./testing/fake-box-host.js";

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

  it("waits five seconds by default and asks the box's own socket", async () => {
    expect(DEFAULT_HOST_READ_MS).toBe(5_000);
    // No machine running this suite has the box's service.
    expect(await boxHostRequests({ readMs: 200 }).networkRead(SERVER)).toMatchObject({
      available: false,
      reason: "missing",
    });
  });
});
