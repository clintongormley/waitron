import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "./protocol.js";
import { createRelayStandin, type RelayStandin } from "./testing/relay.js";
import { runTunnelClient } from "./client.js";

let relay: RelayStandin | undefined;
let scripted: ScriptRelay | undefined;
let local: Server | undefined;
let ac: AbortController | undefined;
afterEach(async () => {
  ac?.abort();
  if (relay !== undefined) await relay.close();
  if (scripted !== undefined) await scripted.close();
  if (local !== undefined) await new Promise((r) => local!.close(() => r(null)));
  relay = scripted = local = ac = undefined;
});

// A scriptable stand-in relay: for each incoming box connection it invokes `script(box, index)`, so a
// test drives the handshake bytes directly — to coalesce `go` with its leftover, send a garbage line,
// reset the socket, or reject a registration. The real relay stand-in is well-behaved, so these edge
// paths need a relay the test controls. `count()` reports how many box connections have been accepted
// (a replacement dial shows up as a new one).
interface ScriptRelay {
  port: number;
  count: () => number;
  close: () => Promise<void>;
}

function scriptRelay(script: (box: Socket, index: number) => void): Promise<ScriptRelay> {
  const boxes = new Set<Socket>();
  let index = 0;
  const server = createServer((box) => {
    boxes.add(box);
    box.on("error", () => box.destroy());
    box.on("close", () => boxes.delete(box));
    script(box, index++);
  });
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () =>
      res({
        port: (server.address() as AddressInfo).port,
        count: () => index,
        close: () =>
          new Promise<void>((r) => {
            for (const b of boxes) b.destroy();
            server.close(() => r());
          }),
      }),
    ),
  );
}

// Resolve with the first complete frame a box connection sends (the client's `register`). The client
// only writes one frame before the relay speaks, so a single decode of the buffer suffices.
function onceRegister(box: Socket): Promise<Frame> {
  let buf = Buffer.alloc(0);
  return new Promise((res) => {
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d]);
      const r = decodeFrame(buf);
      if (r !== null) {
        box.off("data", onData);
        res(r.frame);
      }
    };
    box.on("data", onData);
  });
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The injected `deps.sleep`: a real abort-aware setTimeout that rejects on abort. Task 3 does not call
// it (no backoff yet), but the signature must be honoured; Task 4 starts driving it.
const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        rej(new Error("aborted"));
      },
      { once: true },
    );
  });

it("splices a client request down to the local service and back", async () => {
  local = createServer((s: Socket) =>
    s.on("data", (d) => s.write(Buffer.concat([Buffer.from("echo:"), d]))),
  );
  const localPort = await new Promise<number>((r) =>
    local!.listen(0, () => r((local!.address() as { port: number }).port)),
  );
  relay = await createRelayStandin({ verifyToken: () => true });
  ac = new AbortController();
  void runTunnelClient({
    relayHost: "127.0.0.1",
    relayPort: relay.boxPort,
    boxId: "b",
    token: "t",
    localPort,
    poolSize: 2,
    sleep: realSleep,
    signal: ac.signal,
    log: () => {},
  });
  await new Promise((r) => setTimeout(r, 50)); // let the pool register
  const client = connect(relay.clientPort, "127.0.0.1");
  const got = new Promise<string>((res) => client.once("data", (d) => res(d.toString())));
  await new Promise((r) => setTimeout(r, 20));
  client.write("ping");
  expect(await got).toBe("echo:ping");
  client.destroy();
});

describe("runTunnelClient handshake + splice edge cases", () => {
  it("feeds the post-`go` leftover to the local service before piping (the splice-leftover trap)", async () => {
    // Echo server: prefixes "echo:" so we can see the leftover bytes made the round trip.
    local = createServer((s: Socket) =>
      s.on("data", (d) => s.write(Buffer.concat([Buffer.from("echo:"), d]))),
    );
    const localPort = await new Promise<number>((r) =>
      local!.listen(0, () => r((local!.address() as AddressInfo).port)),
    );
    // The relay coalesces `ack`, `go`, and the cloud's first bytes into ONE write, so decodeFrame's
    // `rest` is non-empty. If the client dropped `rest` instead of writing it to the local socket
    // first, the echo would never fire and this test would time out.
    let afterGo: (v: string) => void = () => {};
    const seen = new Promise<string>((res) => (afterGo = res));
    scripted = await scriptRelay((box, index) => {
      void onceRegister(box).then(() => {
        // Only the first connection is paired; its replacement (the `go` consumes a pool slot, so the
        // client dials a fresh one) stays idle, or every splice would trigger another and loop.
        if (index > 0) {
          box.write(encodeFrame({ t: "ack" }));
          return;
        }
        box.write(
          Buffer.concat([
            encodeFrame({ t: "ack" }),
            encodeFrame({ t: "go" }),
            Buffer.from("leftover"),
          ]),
        );
        box.on("data", (d) => afterGo(d.toString()));
      });
    });
    ac = new AbortController();
    void runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localHost: "127.0.0.1",
      localPort,
      poolSize: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    expect(await seen).toBe("echo:leftover");
  });

  it("tears down a connection that receives a garbage frame and replaces it in the pool", async () => {
    // box[0] registers, is acked, then gets a malformed (non-JSON) line: decodeFrame throws, the
    // client must destroy ONLY that connection and dial a replacement. box[1] acks and stays idle.
    let replaced: () => void = () => {};
    const replacement = new Promise<void>((res) => (replaced = res));
    scripted = await scriptRelay((box, index) => {
      void onceRegister(box).then(() => {
        box.write(encodeFrame({ t: "ack" }));
        if (index === 0) box.write(Buffer.from("this is not json\n"));
        else replaced();
      });
    });
    ac = new AbortController();
    void runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    await replacement; // the dead connection was replaced by a fresh registration
    expect(scripted.count()).toBe(2);
  });

  it("keeps a default-size pool of four connections", async () => {
    // poolSize omitted → default 4: the client should open (and keep) four registered idle
    // connections. Every box connection is simply acked and left idle.
    scripted = await scriptRelay((box) => {
      void onceRegister(box).then(() => box.write(encodeFrame({ t: "ack" })));
    });
    ac = new AbortController();
    void runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    await wait(20);
    expect(scripted.count()).toBe(4);
  });

  it("logs a rejection and replaces the rejected connection", async () => {
    const logs: Array<{ level: string; code: string }> = [];
    let acked: () => void = () => {};
    const secondAcked = new Promise<void>((res) => (acked = res));
    scripted = await scriptRelay((box, index) => {
      void onceRegister(box).then(() => {
        if (index === 0)
          box.write(encodeFrame({ t: "reject", code: "tunnel.registration_rejected" }));
        else {
          box.write(encodeFrame({ t: "ack" }));
          acked();
        }
      });
    });
    ac = new AbortController();
    void runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 1,
      // The first dial is rejected, driving a redial; without this the client waits the default
      // 1000ms backoff first, so the test would burn ~1s of real time (assertions are count/log-based,
      // duration-independent).
      minBackoffMs: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: (level, code) => logs.push({ level, code }),
    });
    await secondAcked;
    expect(logs).toContainEqual({ level: "warn", code: "tunnel.registration_rejected" });
    expect(scripted.count()).toBe(2);
  });

  it("replaces a connection the relay resets mid-handshake", async () => {
    // A hard RST (resetAndDestroy) surfaces on the box as an 'error' (ECONNRESET), not a graceful
    // close — exercising the connection's error handler. The dead slot is replaced.
    let replaced: () => void = () => {};
    const replacement = new Promise<void>((res) => (replaced = res));
    scripted = await scriptRelay((box, index) => {
      void onceRegister(box).then(() => {
        if (index === 0) box.resetAndDestroy();
        else replaced();
      });
    });
    ac = new AbortController();
    void runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 1,
      // The relay resets the first dial, driving a redial; without this the client waits the default
      // 1000ms backoff first, adding ~1s of real time (the assertion is count-based, duration-independent).
      minBackoffMs: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    await replacement;
    expect(scripted.count()).toBe(2);
  });

  it("resolves immediately when the signal is already aborted (never dials)", async () => {
    scripted = await scriptRelay(() => {
      throw new Error("must not dial when pre-aborted");
    });
    ac = new AbortController();
    ac.abort();
    await runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 2,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    expect(scripted.count()).toBe(0);
  });
});
