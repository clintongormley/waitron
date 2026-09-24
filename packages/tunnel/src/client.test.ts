import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { encodeFrame } from "./protocol.js";
import { createRelayStandin, type RelayStandin } from "./testing/relay.js";
import { runTunnelClient } from "./client.js";
import {
  onceRegister,
  realSleep,
  scriptRelay,
  wait,
  type ScriptRelay,
} from "./testing/script-relay.js";

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

it("splices a client request down to the local service and back", async () => {
  local = createServer((s: Socket) =>
    s.on("data", (d: Buffer) => s.write(Buffer.concat([Buffer.from("echo:"), d]))),
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
    local = createServer((s: Socket) =>
      s.on("data", (d: Buffer) => s.write(Buffer.concat([Buffer.from("echo:"), d]))),
    );
    const localPort = await new Promise<number>((r) =>
      local!.listen(0, () => r((local!.address() as AddressInfo).port)),
    );
    // `ack`, `go` and the cloud's first bytes go out in ONE write, so decodeFrame's `rest` is
    // non-empty; a client that dropped it would time out here.
    let afterGo: (v: string) => void = () => {};
    const seen = new Promise<string>((res) => (afterGo = res));
    scripted = await scriptRelay((box, index) => {
      void onceRegister(box).then(() => {
        // Only the first connection is paired, or every splice's replacement would splice and loop.
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
      // Otherwise the redial waits the default 1000ms backoff in real time.
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
    // A hard RST surfaces on the box as an 'error', not a graceful close.
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
      // Otherwise the redial waits the default 1000ms backoff in real time.
      minBackoffMs: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    await replacement;
    expect(scripted.count()).toBe(2);
  });

  it("starts the heartbeat once, however many times the relay acks", async () => {
    // Each loop opens with one `sleep(heartbeatMs)`, so the count of those calls is the count of
    // loops; the 60s sleep keeps either loop from getting past its first nap.
    const heartbeatNaps: number[] = [];
    let registeredTwice: () => void = () => {};
    const acks = new Promise<void>((res) => (registeredTwice = res));
    let registrations = 0;
    scripted = await scriptRelay((box) => {
      void onceRegister(box).then(() => {
        box.write(encodeFrame({ t: "ack" }));
        box.write(encodeFrame({ t: "ack" }));
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
      heartbeatMs: 777,
      sleep: (ms, signal) => {
        if (ms === 777) heartbeatNaps.push(ms);
        return realSleep(60_000, signal);
      },
      signal: ac.signal,
      log: (_l, code) => {
        if (code === "tunnel.connection_registered" && ++registrations === 2) registeredTwice();
      },
    });
    await acks;
    await wait(10); // a second heartbeat, if one were started, has reached its first nap by now
    expect(heartbeatNaps).toHaveLength(1);
  });

  it("ignores a frame it has no use for and still splices on the `go` that follows", async () => {
    // A splice dials its replacement only after `tunnel.paired` is logged, so a replacement dial
    // arriving FIRST means the ignored frame killed the connection.
    let outcome: (o: "paired" | "replaced") => void = () => {};
    const settled = new Promise<"paired" | "replaced">((res) => (outcome = res));
    let delivered: (bytes: string) => void = () => {};
    const atLocal = new Promise<string>((res) => (delivered = res));
    local = createServer((s: Socket) => s.once("data", (d: Buffer) => delivered(d.toString())));
    const localPort = await new Promise<number>((r) =>
      local!.listen(0, () => r((local!.address() as AddressInfo).port)),
    );
    scripted = await scriptRelay((box, index) => {
      if (index > 0) {
        outcome("replaced");
        return;
      }
      void onceRegister(box).then(() => {
        box.write(encodeFrame({ t: "ack" }));
        box.write(encodeFrame({ t: "ping" }));
        box.write(encodeFrame({ t: "go" }));
        box.write("hello"); // the cloud's first bytes, which the splice must carry to the local service
      });
    });
    ac = new AbortController();
    void runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort,
      poolSize: 1,
      sleep: realSleep,
      signal: ac.signal,
      log: (_l, code) => {
        if (code === "tunnel.paired") outcome("paired");
      },
    });
    expect(await settled).toBe("paired");
    expect(await atLocal).toBe("hello");
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
