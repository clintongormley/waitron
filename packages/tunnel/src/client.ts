// The box sits behind NAT with no inbound ports, so it dials OUT to the relay and keeps a pool of
// registered idle connections open; when the relay pairs one with a cloud client (a `go` frame),
// the box dials its own local service port and splices raw bytes between the two, TLS end-to-end.
import { connect, type Socket } from "node:net";
import { decodeFrame, encodeFrame } from "./protocol.js";

export interface TunnelClientDeps {
  relayHost: string;
  relayPort: number;
  /** This box's id at the relay (the pool key). */
  boxId: string;
  /** The box↔relay bearer token, sent on `register`. Never logged. */
  token: string;
  localHost?: string;
  /** The local service port (the box's own HTTPS server) a paired connection is spliced to. */
  localPort: number;
  /** How many registered-or-connecting idle connections to keep open (default 4). */
  poolSize?: number;
  /** Every delay in this module goes through it. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Aborts the whole client: every connection is torn down and {@link runTunnelClient} resolves. */
  signal: AbortSignal;
  /** Params carry ids and counts only, never a token or a payload byte. */
  log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;
  /** Idle heartbeat interval: an idle connection sends `ping` this often and must see a `pong` before
   * the next tick or it is dropped and replaced (default 15000). */
  heartbeatMs?: number;
  /** First reconnect backoff after a failed establish; doubles each failure (default 1000). */
  minBackoffMs?: number;
  /** Reconnect backoff ceiling; reaching it logs `tunnel.stream_stalled` once (default 60000). */
  maxBackoffMs?: number;
}

function nextBackoff(current: number, minMs: number, maxMs: number): number {
  const next = current === 0 ? minMs : current * 2;
  return Math.min(next, maxMs);
}

export async function runTunnelClient(deps: TunnelClientDeps): Promise<void> {
  const poolSize = deps.poolSize ?? 4;
  const localHost = deps.localHost ?? "127.0.0.1";
  const heartbeatMs = deps.heartbeatMs ?? 15000;
  const minBackoffMs = deps.minBackoffMs ?? 1000;
  const maxBackoffMs = deps.maxBackoffMs ?? 60000;

  const sockets = new Set<Socket>();
  const track = (s: Socket): void => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };

  // Shared across all slots; 0 = healthy. Read-modified-written with no await between, so the
  // saturation edge logs once even when several slots fail concurrently.
  let backoff = 0;

  // Callers re-check `signal.aborted` after every nap, so an abort's rejection can be swallowed.
  const nap = async (ms: number): Promise<void> => {
    try {
      await deps.sleep(ms, deps.signal);
    } catch {
      // aborted mid-sleep; the caller's `signal.aborted` check unwinds it
    }
  };

  // "failed" when the connection never registered, so the slot backs off; "done" when a registered
  // connection left the pool, so the slot re-establishes at once.
  function openConnection(): Promise<"failed" | "done"> {
    return new Promise<"failed" | "done">((resolve) => {
      // "Has left the pool"; `resolve` is idempotent, so the first outcome wins.
      let settled = false;
      const settle = (outcome: "failed" | "done"): void => {
        settled = true;
        resolve(outcome);
      };

      const relayConn = connect(deps.relayPort, deps.relayHost);
      track(relayConn);
      // Widened to `Buffer` (not the narrower `Buffer<ArrayBuffer>` that `Buffer.alloc` infers) so it
      // accepts `decodeFrame`'s `rest`, a `subarray` view (`Buffer<ArrayBufferLike>`).
      let buf: Buffer = Buffer.alloc(0);
      let registered = false;
      let awaitingPong = false;

      // `rest` (the cloud's first TLS bytes, buffered past the `go` newline) is NOT assumed empty
      // and goes to the local socket first. Node emits no further 'data' on relayConn until this
      // handler returns, so swapping the frame reader for the pumps here cannot lose a chunk.
      const startSplice = (rest: Buffer): void => {
        relayConn.off("data", onData);
        const localConn = connect(deps.localPort, localHost);
        track(localConn);
        if (rest.length > 0) localConn.write(rest);
        relayConn.on("data", (d) => localConn.write(d));
        localConn.on("data", (d) => relayConn.write(d));
        const teardown = (): void => {
          relayConn.destroy();
          localConn.destroy();
        };
        relayConn.on("close", teardown);
        relayConn.on("error", teardown);
        localConn.on("close", teardown);
        localConn.on("error", teardown);
        deps.log("info", "tunnel.paired", { boxId: deps.boxId });
        settle("done");
      };

      // A `pong` must arrive before the NEXT tick, else the path is dead.
      const heartbeat = async (): Promise<void> => {
        while (!deps.signal.aborted && !settled) {
          await nap(heartbeatMs);
          if (deps.signal.aborted || settled) return;
          if (awaitingPong) {
            relayConn.destroy();
            return;
          }
          awaitingPong = true;
          // Known gap: a `ping` in flight when the relay pairs this connection can be spliced raw
          // into the cloud's TLS stream, corrupting that one handshake. Closing it is the relay's
          // job.
          relayConn.write(encodeFrame({ t: "ping" }));
        }
      };

      const onData = (chunk: Buffer): void => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          let decoded: ReturnType<typeof decodeFrame>;
          try {
            decoded = decodeFrame(buf);
          } catch {
            // A malformed frame tears down only this connection.
            relayConn.destroy();
            return;
          }
          if (decoded === null) return;
          buf = decoded.rest;
          const { frame } = decoded;
          if (frame.t === "ack") {
            const firstAck = !registered; // a repeat `ack` must not restart the heartbeat
            registered = true;
            backoff = 0;
            deps.log("info", "tunnel.connection_registered", { boxId: deps.boxId });
            if (firstAck) void heartbeat();
            continue;
          }
          if (frame.t === "go") {
            startSplice(buf);
            return;
          }
          if (frame.t === "reject") {
            deps.log("warn", "tunnel.registration_rejected", {
              boxId: deps.boxId,
              code: frame.code,
            });
            relayConn.destroy();
            return;
          }
          if (frame.t === "pong") {
            awaitingPong = false;
            continue;
          }
        }
      };

      relayConn.on("connect", () => {
        relayConn.write(encodeFrame({ t: "register", boxId: deps.boxId, token: deps.token }));
      });
      relayConn.on("data", onData);
      relayConn.on("error", () => relayConn.destroy());
      relayConn.on("close", () => {
        if (settled) return;
        if (deps.signal.aborted) {
          settle("done");
          return;
        }
        if (registered) {
          // The relay was reachable, so the pool tops up with no backoff.
          deps.log("warn", "tunnel.connection_lost", { boxId: deps.boxId });
          settle("done");
        } else {
          settle("failed");
        }
      });
    });
  }

  async function runSlot(): Promise<void> {
    while (!deps.signal.aborted) {
      const outcome = await openConnection();
      if (deps.signal.aborted) return;
      if (outcome === "failed") {
        const next = nextBackoff(backoff, minBackoffMs, maxBackoffMs);
        if (backoff < maxBackoffMs && next >= maxBackoffMs) {
          deps.log("error", "tunnel.stream_stalled", { boxId: deps.boxId, backoffMs: next });
        }
        backoff = next;
        await nap(next);
      }
    }
  }

  if (!deps.signal.aborted) {
    deps.signal.addEventListener(
      "abort",
      () => {
        for (const s of sockets) s.destroy();
      },
      { once: true },
    );
  }

  const slots: Array<Promise<void>> = [];
  for (let i = 0; i < poolSize; i += 1) slots.push(runSlot());
  await Promise.all(slots);
}
