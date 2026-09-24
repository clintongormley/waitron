// An in-process stand-in for the public relay, for tests — NOT the shipped hosting. It is BLIND:
// after `go` it copies bytes without interpreting them. It serves a SINGLE box: a client is paired
// with any idle connection, with no box selection.
import { createServer, type AddressInfo, type Socket } from "node:net";
import { decodeFrame, encodeFrame } from "../protocol.js";

const REJECT_CODE = "tunnel.registration_rejected";

export interface RelayStandin {
  readonly boxPort: number;
  /** Where client (cloud-side) connections dial to be paired. */
  readonly clientPort: number;
  /** Every buffer the relay copied in the client->box direction, for the blindness assertion. */
  bytesSeen(): Buffer[];
  /** Close both listeners and destroy every parked/paired/waiting socket. Idempotent. */
  close(): Promise<void>;
}

export interface RelayStandinOptions {
  verifyToken: (boxId: string, token: string) => boolean;
  host?: string;
  /** How long a client waits for an idle box to appear before it is dropped. */
  waitForBoxMs?: number;
}

interface Parked {
  box: Socket;
  onData: (chunk: Buffer) => void;
}

interface Waiter {
  resolve: (box: Socket | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createRelayStandin(opts: RelayStandinOptions): Promise<RelayStandin> {
  const host = opts.host ?? "127.0.0.1";
  const waitForBoxMs = opts.waitForBoxMs ?? 1000;
  const verifyToken = opts.verifyToken;

  const idle: Parked[] = [];
  // Oldest first: a Set preserves insertion order.
  const waiters = new Set<Waiter>();
  const sockets = new Set<Socket>();
  const seen: Buffer[] = [];

  let closePromise: Promise<void> | null = null;

  function takeWaiter(): Waiter | undefined {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      return waiter;
    }
    return undefined;
  }

  function popIdle(): Socket | undefined {
    const parked = idle.shift();
    if (parked === undefined) return undefined;
    parked.box.off("data", parked.onData);
    return parked.box;
  }

  function parkIdle(box: Socket, rest: Buffer): void {
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
        box.destroy();
      }
    };
    box.on("data", onData);
    idle.push({ box, onData });
  }

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
        box.destroy();
        return;
      }
      if (decoded === null) return;

      const { frame, rest } = decoded;
      if (frame.t !== "register") {
        box.destroy();
        return;
      }
      if (!verifyToken(frame.boxId, frame.token)) {
        box.write(encodeFrame({ t: "reject", code: REJECT_CODE }));
        box.destroy();
        return;
      }
      box.off("data", onData);
      box.write(encodeFrame({ t: "ack" }));
      const waiter = takeWaiter();
      if (waiter !== undefined)
        waiter.resolve(box); // a client is waiting — pair immediately
      else parkIdle(box, rest);
    };
    box.on("data", onData);
  }

  function splice(client: Socket, box: Socket): void {
    // Both handlers attach synchronously, so no chunk is dropped between `go` and the splice.
    box.write(encodeFrame({ t: "go" }));
    // No encoding is set on these sockets, so a chunk is always a Buffer.
    client.on("data", (d: Buffer) => {
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
      client.destroy();
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
