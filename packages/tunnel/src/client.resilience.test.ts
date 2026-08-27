import { createServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "./protocol.js";
import { runTunnelClient } from "./client.js";

// Task 4 drives every backoff/heartbeat delay through the INJECTED `sleep`, so these suites assert
// durations and tick counts rather than waiting real time out. The one exception is the "keeps a
// ponging connection alive" test, whose fake sleep yields a few real milliseconds so a loopback
// ping→pong round trip can complete between injected ticks (see its comment).

let scripted: ScriptRelay | undefined;
let ac: AbortController | undefined;
afterEach(async () => {
  ac?.abort();
  if (scripted !== undefined) await scripted.close();
  scripted = ac = undefined;
});

// A scriptable stand-in relay (mirrors client.test.ts): for each incoming box connection it invokes
// `script(box, index)`, so a test drives the handshake bytes directly. `count()` reports how many box
// connections have been accepted (a replacement dial shows up as a new one).
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

// Resolve with the first complete frame a box connection sends (the client's `register`), then detach.
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

// The injected `deps.sleep`: a real abort-aware setTimeout that rejects on abort (the client's `nap`
// wrapper swallows that rejection). Used by the shutdown test, where timing is driven by the abort.
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

describe("runTunnelClient resilience", () => {
  it("backs off exponentially on an unreachable relay and logs stream_stalled at saturation", async () => {
    const durations: number[] = [];
    const abort = new AbortController();
    const codes: string[] = [];
    const fakeSleep = async (ms: number): Promise<void> => {
      durations.push(ms);
      if (durations.length >= 5) abort.abort(); // stop after a few cycles
    };
    await runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: 1,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 1,
      sleep: fakeSleep as never,
      signal: abort.signal,
      minBackoffMs: 100,
      maxBackoffMs: 400,
      log: (_l, code) => codes.push(code),
    });
    expect(durations.slice(0, 4)).toEqual([100, 200, 400, 400]);
    expect(codes.filter((c) => c === "tunnel.stream_stalled")).toHaveLength(1); // once, at first saturation
  });

  it("drops a silent (never-pongs) connection after a missed pong, logs connection_lost, and re-registers", async () => {
    // The relay acks a registration then goes silent — it never answers a heartbeat ping. The client
    // sends `ping` on the first tick and, finding no `pong` by the next tick, must destroy the
    // connection (logging connection_lost) and dial a replacement.
    const codes: string[] = [];
    scripted = await scriptRelay((box) => {
      void onceRegister(box).then(() => box.write(encodeFrame({ t: "ack" })));
    });
    ac = new AbortController();
    let ticks = 0;
    const fakeSleep = async (): Promise<void> => {
      ticks += 1;
      if (ticks >= 4) ac!.abort(); // conn#1 dies (2 ticks), conn#2 registers + pings, then stop
    };
    await runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 1,
      heartbeatMs: 10,
      sleep: fakeSleep as never,
      signal: ac.signal,
      log: (_l, code) => codes.push(code),
    });
    expect(codes).toContain("tunnel.connection_lost");
    expect(scripted.count()).toBeGreaterThanOrEqual(2); // dropped one, re-registered another
  });

  it("keeps a ponging connection alive across heartbeat ticks (consumes pong, never lost)", async () => {
    // The relay answers every ping with a pong. The heartbeat must therefore never fire connection_lost
    // and the single connection is never replaced. The fake sleep yields a few real milliseconds so the
    // loopback ping→pong round trip lands before the next injected tick reads `awaitingPong`.
    const codes: string[] = [];
    scripted = await scriptRelay((box) => {
      // Widened to `Buffer` so it accepts decodeFrame's `rest` (a `subarray` view), as in client.ts.
      let buf: Buffer = Buffer.alloc(0);
      box.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          let r: ReturnType<typeof decodeFrame>;
          try {
            r = decodeFrame(buf);
          } catch {
            box.destroy();
            return;
          }
          if (r === null) return;
          buf = r.rest;
          if (r.frame.t === "register") box.write(encodeFrame({ t: "ack" }));
          else if (r.frame.t === "ping") box.write(encodeFrame({ t: "pong" }));
        }
      });
    });
    ac = new AbortController();
    let ticks = 0;
    const yieldSleep = (): Promise<void> =>
      new Promise<void>((r) => {
        ticks += 1;
        if (ticks >= 4) ac!.abort();
        setTimeout(r, 10); // let the loopback pong arrive before the next tick's liveness check
      });
    await runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 1,
      heartbeatMs: 5,
      sleep: yieldSleep as never,
      signal: ac.signal,
      log: (_l, code) => codes.push(code),
    });
    expect(codes).not.toContain("tunnel.connection_lost");
    expect(scripted.count()).toBe(1); // never dropped, never re-registered
  });

  it("resolves promptly on abort and destroys every socket it opened", async () => {
    const boxSockets: Socket[] = [];
    scripted = await scriptRelay((box) => {
      boxSockets.push(box);
      void onceRegister(box).then(() => box.write(encodeFrame({ t: "ack" })));
    });
    ac = new AbortController();
    const done = runTunnelClient({
      relayHost: "127.0.0.1",
      relayPort: scripted.port,
      boxId: "b",
      token: "t",
      localPort: 1,
      poolSize: 3,
      sleep: realSleep,
      signal: ac.signal,
      log: () => {},
    });
    await wait(50); // let the pool of three register
    expect(boxSockets.length).toBe(3);
    ac.abort();
    // Resolves promptly — it must not wait out a heartbeat interval. A hang fails the test by timeout.
    await done;
    // Every relay-side box socket saw its client end torn down.
    await Promise.all(
      boxSockets.map((b) =>
        b.destroyed ? Promise.resolve() : new Promise<void>((r) => b.once("close", () => r())),
      ),
    );
    expect(boxSockets.every((b) => b.destroyed)).toBe(true);
  });
});
