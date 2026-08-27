// A local, in-process stand-in for the public relay the box dials out to. It is for tests and dev
// only — NOT the shipped hosting. It runs two loopback TCP listeners:
//
//   - the box port: box connections `register` with a boxId + token; a valid one is `ack`'d and
//     parked idle (answering heartbeat pings), an invalid one is `reject`'d and closed;
//   - the client port: a client (the cloud side) connects, the relay pops the oldest idle box
//     connection for any box, sends it `go`, and then splices the two TCP streams raw in both
//     directions.
//
// The relay is deliberately BLIND: after `go` it copies bytes without interpreting them (TLS runs
// end-to-end box<->cloud). `bytesSeen()` records every client->box buffer so a test can assert the
// relay only ever saw ciphertext.
import { createServer, type AddressInfo, type Socket } from "node:net";
import { decodeFrame, encodeFrame } from "../protocol.js";

/** The domain concept for a refused registration — logged as a free string, never thrown. */
const REJECT_CODE = "tunnel.registration_rejected";

export interface RelayStandin {
  /** Ephemeral loopback port box connections dial to register. */
  readonly boxPort: number;
  /** Ephemeral loopback port client (cloud-side) connections dial to be paired. */
  readonly clientPort: number;
  /** Every buffer the relay copied in the client->box direction, for the blindness assertion. */
  bytesSeen(): Buffer[];
  /** Close both listeners and destroy every parked/paired/waiting socket. Idempotent. */
  close(): Promise<void>;
}

export interface RelayStandinOptions {
  /** Verifies a box's registration token. Tests supply `crypto.timingSafeEqual`-backed checks. */
  verifyToken: (boxId: string, token: string) => boolean;
  /** Loopback host to bind (default `127.0.0.1`). */
  host?: string;
  /**
   * How long (ms) a client waits for an idle box to appear before it is dropped. Injected so a
   * suite can assert the timeout without a real wall-clock wait; there is no `Date.now()` here.
   */
  waitForBoxMs?: number;
}

/** A parked idle box connection plus the heartbeat reader to detach when it is popped for pairing. */
interface Parked {
  box: Socket;
  onData: (chunk: Buffer) => void;
}

/** A client parked waiting for an idle box: `resolve` hands it one (or `undefined` on timeout). */
interface Waiter {
  resolve: (box: Socket | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createRelayStandin(opts: RelayStandinOptions): Promise<RelayStandin> {
  const host = opts.host ?? "127.0.0.1";
  const waitForBoxMs = opts.waitForBoxMs ?? 1000;
  const verifyToken = opts.verifyToken;

  // Idle box connections keyed by boxId, oldest first. A pool is deleted the moment it empties, so
  // any pool present in the map is non-empty.
  const idle = new Map<string, Parked[]>();
  // Clients waiting for an idle box, oldest first (Set preserves insertion order).
  const waiters = new Set<Waiter>();
  // Every live socket (box or client), so close() can tear them all down regardless of phase.
  const sockets = new Set<Socket>();
  // Client->box buffers, recorded but never interpreted.
  const seen: Buffer[] = [];

  let closePromise: Promise<void> | null = null;

  // --- idle pool + waiter queue ---

  function takeWaiter(): Waiter | undefined {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      return waiter;
    }
    return undefined;
  }

  function popIdle(): Socket | undefined {
    for (const [boxId, pool] of idle) {
      const parked = pool.shift() as Parked; // pools in the map are never empty (see `idle`)
      if (pool.length === 0) idle.delete(boxId);
      parked.box.off("data", parked.onData); // stop ponging; the raw splice takes over its bytes
      return parked.box;
    }
    return undefined;
  }

  // A registered box with no client waiting: park it and answer its heartbeat pings until popped.
  function parkIdle(boxId: string, box: Socket, rest: Buffer): void {
    let buf = rest;
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      try {
        let r = decodeFrame(buf);
        while (r !== null) {
          buf = r.rest;
          if (r.frame.t === "ping") box.write(encodeFrame({ t: "pong" }));
          r = decodeFrame(buf);
        }
      } catch {
        box.destroy(); // a malformed idle-phase line drops only this socket
      }
    };
    box.on("data", onData);
    const pool = idle.get(boxId);
    if (pool === undefined) idle.set(boxId, [{ box, onData }]);
    else pool.push({ box, onData });
  }

  // --- box side: registration ---

  function handleBox(box: Socket): void {
    sockets.add(box);
    box.on("error", () => box.destroy());
    box.on("close", () => sockets.delete(box));

    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      let decoded: ReturnType<typeof decodeFrame>;
      try {
        decoded = decodeFrame(buf);
      } catch {
        box.destroy(); // malformed handshake line → drop only this socket, keep serving others
        return;
      }
      if (decoded === null) return; // partial register frame; keep reading

      const { frame, rest } = decoded;
      if (frame.t !== "register") {
        box.destroy(); // a box must register first
        return;
      }
      if (!verifyToken(frame.boxId, frame.token)) {
        box.write(encodeFrame({ t: "reject", code: REJECT_CODE }));
        box.destroy();
        return;
      }
      box.off("data", onData); // handshake done; hand the connection to idle/pairing
      box.write(encodeFrame({ t: "ack" }));
      const waiter = takeWaiter();
      if (waiter !== undefined)
        waiter.resolve(box); // a client is waiting — pair immediately
      else parkIdle(frame.boxId, box, rest);
    };
    box.on("data", onData);
  }

  // --- client side: pairing + blind splice ---

  function splice(client: Socket, box: Socket): void {
    // Copy raw bytes both ways; record the client->box direction so a test can assert the relay
    // only ever saw ciphertext. Attach both handlers synchronously so no chunk is dropped between
    // `go` and the splice (Node will not emit the next 'data' until the current handler returns).
    box.write(encodeFrame({ t: "go" }));
    client.on("data", (d) => {
      seen.push(d);
      box.write(d);
    });
    box.on("data", (d) => client.write(d));
    const endBoth = (): void => {
      client.destroy();
      box.destroy();
    };
    client.on("close", endBoth);
    box.on("close", endBoth);
    client.on("error", endBoth);
    box.on("error", endBoth);
  }

  async function pairClient(client: Socket): Promise<void> {
    let box = popIdle();
    if (box === undefined) {
      box = await new Promise<Socket | undefined>((resolve) => {
        const waiter: Waiter = {
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            resolve(undefined);
          }, waitForBoxMs),
        };
        waiters.add(waiter);
      });
    }
    if (box === undefined) {
      client.destroy(); // no idle box appeared within the wait window
      return;
    }
    splice(client, box);
  }

  function handleClient(client: Socket): void {
    sockets.add(client);
    client.on("error", () => client.destroy());
    client.on("close", () => sockets.delete(client));
    void pairClient(client);
  }

  // --- lifecycle ---

  const boxServer = createServer(handleBox);
  const clientServer = createServer(handleClient);

  function close(): Promise<void> {
    if (closePromise !== null) return closePromise;
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(undefined);
    }
    waiters.clear();
    for (const socket of sockets) socket.destroy();
    closePromise = Promise.all([
      new Promise<void>((res) => {
        boxServer.close(() => res());
      }),
      new Promise<void>((res) => {
        clientServer.close(() => res());
      }),
    ]).then(() => undefined);
    return closePromise;
  }

  return new Promise<RelayStandin>((resolve) => {
    let listening = 0;
    const onListening = (): void => {
      listening += 1;
      if (listening < 2) return;
      resolve({
        boxPort: (boxServer.address() as AddressInfo).port,
        clientPort: (clientServer.address() as AddressInfo).port,
        bytesSeen: () => [...seen],
        close,
      });
    };
    boxServer.listen(0, host, onListening);
    clientServer.listen(0, host, onListening);
  });
}
