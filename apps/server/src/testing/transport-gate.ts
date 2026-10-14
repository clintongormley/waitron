import { createServer, type IncomingMessage } from "node:http";
import { Agent, type AgentOptions } from "node:https";
import { connect, type Socket } from "node:net";
import { Duplex } from "node:stream";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { spawnLitestream, type SpawnFn } from "@waitron/stream";

export interface SeenConnect {
  readonly sequence: number;
  /** `host:port` as the client asked for it. */
  readonly target: string;
  /** Whether it arrived while the gate was holding. */
  readonly held: boolean;
}

/**
 * A local HTTP CONNECT proxy that only a fixture's own clients are pointed at, so it can stop
 * their bucket calls and let them go. TLS runs end to end through it: it moves bytes, never reads
 * them.
 */
export interface TransportGate {
  /** `http://127.0.0.1:<port>`, the value a client's `HTTPS_PROXY` takes. */
  readonly url: string;
  /** New CONNECTs wait unanswered and undialled; open tunnels stop moving bytes both ways. */
  hold(): void;
  /** Dials held CONNECTs in arrival order and resumes every tunnel. */
  release(): void;
  heldCount(): number;
  /** Every CONNECT `allow` admitted. A refused one is not here and takes no sequence number. */
  seen(): readonly SeenConnect[];
  /** `host:port` of each CONNECT `allow` refused; the only record of one. */
  refused(): readonly string[];
  /** How many targets the gate has actually dialled. */
  forwarded(): number;
  waitForHeld(count: number, timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

interface Pending {
  readonly client: Duplex;
  readonly host: string;
  readonly port: number;
  readonly head: Buffer;
}

function splitTarget(target: string): { host: string; port: number } | null {
  const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(target);
  if (!match) return null;
  return { host: match[1]!, port: Number(match[2]) };
}

const closedWhileWaiting = (count: number) =>
  new Error(`transport gate: closed while waiting for ${count} held CONNECTs`);

export async function startTransportGate(options: {
  allow(host: string, port: number): boolean;
}): Promise<TransportGate> {
  let holding = false;
  let closed = false;
  let sequence = 0;
  let dialled = 0;
  const seenList: SeenConnect[] = [];
  const refusedList: string[] = [];
  const pending: Pending[] = [];
  const tunnelEnds = new Set<Duplex>();
  const owned = new Set<Duplex>();
  const heldWaiters = new Set<{ count: number; check(): void; stop(error: Error): void }>();
  /** A CONNECT's own bytes, kept while its dial completed under a hold. */
  const heldHeads = new Map<Duplex, Buffer>();

  const own = (socket: Duplex) => {
    owned.add(socket);
    socket.once("close", () => owned.delete(socket));
  };

  const notifyHeld = () => {
    for (const waiter of [...heldWaiters]) waiter.check();
  };

  // Hand-driven rather than `pipe()`: a pipe resumes its source on the destination's `drain`, which
  // would undo a hold.
  const forward = (from: Duplex, to: Duplex) => {
    from.on("data", (chunk: Buffer) => {
      if (!to.write(chunk)) from.pause();
    });
    to.on("drain", () => {
      if (!holding) from.resume();
    });
    from.on("end", () => to.end());
    from.on("close", () => to.destroy());
    from.on("error", () => to.destroy());
  };

  const dial = (entry: Pending) => {
    dialled++;
    const upstream = connect(entry.port, entry.host);
    own(upstream);
    upstream.on("error", () => entry.client.destroy());
    entry.client.on("close", () => upstream.destroy());
    upstream.once("connect", () => {
      entry.client.write("HTTP/1.1 200 Connection established\r\n\r\n");
      if (entry.head.length > 0) {
        if (holding) {
          heldHeads.set(upstream, entry.head);
          upstream.once("close", () => heldHeads.delete(upstream));
        } else {
          upstream.write(entry.head);
        }
      }
      for (const end of [entry.client, upstream]) {
        tunnelEnds.add(end);
        end.once("close", () => tunnelEnds.delete(end));
      }
      forward(entry.client, upstream);
      forward(upstream, entry.client);
      if (holding) {
        entry.client.pause();
        upstream.pause();
      }
    });
  };

  const server = createServer((_req, res) => {
    res.writeHead(405, { connection: "close" });
    res.end();
  });
  server.on("connection", own);
  server.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    const target = req.url ?? "";
    const parsed = splitTarget(target);
    if (!parsed || !options.allow(parsed.host, parsed.port)) {
      refusedList.push(target);
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    seenList.push({ sequence: ++sequence, target, held: holding });
    client.on("error", () => client.destroy());
    const entry: Pending = { client, ...parsed, head };
    if (!holding) {
      dial(entry);
      return;
    }
    pending.push(entry);
    const drop = () => {
      const at = pending.indexOf(entry);
      if (at >= 0) pending.splice(at, 1);
    };
    client.once("end", () => {
      drop();
      client.destroy();
    });
    client.once("close", drop);
    notifyHeld();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    hold() {
      holding = true;
      for (const end of tunnelEnds) end.pause();
    },
    release() {
      if (closed) return;
      holding = false;
      for (const entry of pending.splice(0)) {
        entry.client.removeAllListeners("end");
        dial(entry);
      }
      for (const [upstream, head] of heldHeads) upstream.write(head);
      heldHeads.clear();
      for (const end of tunnelEnds) end.resume();
    },
    heldCount: () => pending.length,
    seen: () => [...seenList],
    refused: () => [...refusedList],
    forwarded: () => dialled,
    waitForHeld(count, timeoutMs) {
      if (closed) return Promise.reject(closedWhileWaiting(count));
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          count,
          check() {
            if (pending.length < count) return;
            clearTimeout(timer);
            heldWaiters.delete(waiter);
            resolve();
          },
          stop(error: Error) {
            clearTimeout(timer);
            heldWaiters.delete(waiter);
            reject(error);
          },
        };
        const timer = setTimeout(
          () =>
            waiter.stop(
              new Error(
                `transport gate: ${pending.length} of ${count} CONNECTs held after ${timeoutMs} ms`,
              ),
            ),
          timeoutMs,
        );
        heldWaiters.add(waiter);
        waiter.check();
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const waiter of [...heldWaiters]) waiter.stop(closedWhileWaiting(waiter.count));
      pending.splice(0);
      for (const socket of owned) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The CONNECT exchange in front of a TLS session: writes wait until the gate answers 200, and the
 * answer's head is never passed on. Returned to the agent synchronously, so a request aborted while
 * its CONNECT is held destroys this — and the socket to the gate — rather than leaving the CONNECT
 * waiting to be dialled.
 */
class ConnectTunnel extends Duplex {
  readonly #raw: Socket;
  #established = false;
  #answer = Buffer.alloc(0);
  readonly #queued: { chunk: Buffer; done: (error?: Error | null) => void }[] = [];

  constructor(proxy: URL, target: string) {
    super();
    this.#raw = connect(Number(proxy.port), proxy.hostname);
    this.#raw.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    this.#raw.on("data", (chunk: Buffer) => this.#receive(chunk));
    this.#raw.on("end", () => this.push(null));
    this.#raw.on("error", (error) => this.destroy(error));
    this.#raw.on("close", () => this.destroy());
  }

  #receive(chunk: Buffer): void {
    if (this.#established) {
      if (!this.push(chunk)) this.#raw.pause();
      return;
    }
    this.#answer = Buffer.concat([this.#answer, chunk]);
    const end = this.#answer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const statusLine = this.#answer.subarray(0, this.#answer.indexOf("\r\n")).toString();
    if (!/^HTTP\/1\.[01] 200 /.test(statusLine)) {
      this.destroy(new Error(`transport gate answered CONNECT with ${statusLine}`));
      return;
    }
    this.#established = true;
    const rest = this.#answer.subarray(end + 4);
    this.#answer = Buffer.alloc(0);
    for (const { chunk: queued, done } of this.#queued.splice(0)) this.#raw.write(queued, done);
    if (rest.length > 0) this.#receive(rest);
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    if (this.#established) this.#raw.write(chunk, done);
    else this.#queued.push({ chunk, done });
  }

  override _read(): void {
    this.#raw.resume();
  }

  override _final(done: (error?: Error | null) => void): void {
    this.#raw.end();
    done();
  }

  override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
    this.#raw.destroy();
    done(error);
  }
}

class GatedAgent extends Agent {
  readonly #proxy: URL;

  constructor(proxy: string, options: AgentOptions) {
    super(options);
    this.#proxy = new URL(proxy);
  }

  override createConnection(options: ConnectionOptions & { host?: string; port?: number }) {
    const host = options.host ?? "localhost";
    const target = `${host.includes(":") ? `[${host}]` : host}:${options.port ?? 443}`;
    return tlsConnect({ ...options, socket: new ConnectTunnel(this.#proxy, target) });
  }
}

/**
 * A request handler whose HTTPS connections tunnel through `gate`. Node's own
 * `new Agent({ proxyEnv: { HTTPS_PROXY } })` tunnels (measured on Node v26.7.0), but a request
 * aborted while its CONNECT was held left that CONNECT open for at least 5 s, so release would
 * have dialled it; this agent's tunnel goes when its request does.
 *
 * A held request was given up later than `socketTimeoutMs` at each of five measured values, and
 * setting `connectionTimeout` changed none of them, so it is not set (4.12.1, Node v26.7.0; the
 * table is in commit f19cd4fb1's diff).
 */
export function gatedRequestHandler(
  gate: TransportGate,
  options: { socketTimeoutMs: number; ca?: string; keepAlive?: boolean },
): NodeHttpHandler {
  return new NodeHttpHandler({
    httpsAgent: new GatedAgent(gate.url, {
      keepAlive: options.keepAlive ?? true,
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    }),
    socketTimeout: options.socketTimeoutMs,
  });
}

/** `spawnLitestream` with `HTTPS_PROXY` pointed at `gate` and nothing else added. */
export function gatedSpawn(gate: TransportGate, onChild?: (pid: number) => void): SpawnFn {
  return (bin, args, env) => {
    const child = spawnLitestream(bin, args, { ...env, HTTPS_PROXY: gate.url });
    if (onChild && child.pid !== undefined) {
      try {
        onChild(child.pid);
      } catch (error) {
        // Nothing else holds the handle, so nothing else could stop the child.
        child.kill();
        throw error;
      }
    }
    return child;
  };
}
