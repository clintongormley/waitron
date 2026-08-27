// The box-side tunnel client. The box sits behind NAT with no inbound ports, so it dials OUT to the
// relay and keeps a pool of registered idle connections open; when the relay pairs one with a cloud
// client (a `go` frame), the box dials its own local service port and splices raw bytes between the
// two, TLS end-to-end. This module knows nothing of sync, cursors, or SQL — its one job is "keep the
// box reachable through the relay by proxying to a local port" (spec §5).
//
// Scope: the happy path (pool, handshake, splice) plus the supervisory resilience layered on top —
// an idle-connection heartbeat, bounded-exponential-backoff reconnect when the relay is unreachable,
// and clean teardown on abort. Every backoff/heartbeat delay runs through the injected `deps.sleep`
// (the loop.ts idiom), so the suite asserts durations and tick counts instead of waiting real time.
import { connect, type Socket } from "node:net";
import { decodeFrame, encodeFrame } from "./protocol.js";

export interface TunnelClientDeps {
  /** The relay's loopback/host address the box dials out to. */
  relayHost: string;
  /** The relay's box-side port. */
  relayPort: number;
  /** This box's id at the relay (the pool key). */
  boxId: string;
  /** The box↔relay bearer token, sent on `register`. Never logged. */
  token: string;
  /** The local service host to proxy a paired connection to (default 127.0.0.1). */
  localHost?: string;
  /** The local service port (the box's own HTTPS server) a paired connection is spliced to. */
  localPort: number;
  /** How many registered-or-connecting idle connections to keep open (default 4). */
  poolSize?: number;
  /** Abort-aware sleep, injected so backoff/heartbeat assert durations instead of waiting them
   * (the loop.ts idiom). Every delay in this module goes through it. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Aborts the whole client: every connection is torn down and {@link runTunnelClient} resolves. */
  signal: AbortSignal;
  /** Structured logger — `tunnel.*` codes are logged as free strings, never thrown, and their params
   * carry ids and counts only, never a token or a payload byte. */
  log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;
  /** Idle heartbeat interval: an idle connection sends `ping` this often and must see a `pong` before
   * the next tick or it is dropped and replaced (default 15000). */
  heartbeatMs?: number;
  /** First reconnect backoff after a failed establish; doubles each failure (default 1000). */
  minBackoffMs?: number;
  /** Reconnect backoff ceiling; reaching it logs `tunnel.stream_stalled` once (default 60000). */
  maxBackoffMs?: number;
}

/** The next reconnect backoff: `minMs` on the first failure, then doubling, capped at `maxMs`
 * (mirrors runSyncPull's nextBackoff). */
function nextBackoff(current: number, minMs: number, maxMs: number): number {
  const next = current === 0 ? minMs : current * 2;
  return Math.min(next, maxMs);
}

/**
 * Run the box tunnel client until `deps.signal` aborts. Maintains `poolSize` (default 4) registered
 * idle connections to the relay; when the relay pairs one with a cloud client (`go`), dials the local
 * service and splices, then replenishes. Each idle connection runs a heartbeat; a connection that
 * fails to ESTABLISH drives a shared bounded-exponential backoff. Resolves when the signal aborts,
 * tearing every live socket down.
 */
export async function runTunnelClient(deps: TunnelClientDeps): Promise<void> {
  const poolSize = deps.poolSize ?? 4;
  const localHost = deps.localHost ?? "127.0.0.1";
  const heartbeatMs = deps.heartbeatMs ?? 15000;
  const minBackoffMs = deps.minBackoffMs ?? 1000;
  const maxBackoffMs = deps.maxBackoffMs ?? 60000;

  // Every live socket (relay + local), so an abort can destroy them all and leak no open handle.
  const sockets = new Set<Socket>();
  const track = (s: Socket): void => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };

  // Shared across all slots (spec: "a shared bounded-exponential backoff"): 0 = healthy, grows on a
  // failed establish, reset to 0 by any successful register. Read-modified-written synchronously (no
  // await between), so the `prev < max && next >= max` saturation edge fires exactly once even when
  // several slots fail concurrently.
  let backoff = 0;

  // Abort-aware delay: swallows the rejection an abort-cancelling `sleep` throws (the loop re-checks
  // `signal.aborted` after every nap, so a resolve and a reject are handled the same).
  const nap = async (ms: number): Promise<void> => {
    try {
      await deps.sleep(ms, deps.signal);
    } catch {
      // aborted mid-sleep; the caller's `signal.aborted` check unwinds it
    }
  };

  // One connection's whole life: dial, register, then either idle-with-heartbeat until it drops, or
  // splice on `go`. Resolves "failed" when the connection never registered (connect refused, reset
  // mid-handshake, or a `reject`) — the slot backs off — or "done" when a registered connection left
  // the pool (spliced, dropped, or torn down on abort) — the slot re-establishes with no backoff.
  function openConnection(): Promise<"failed" | "done"> {
    return new Promise<"failed" | "done">((resolve) => {
      // `settled` is the connection's "has left the pool" flag, read by the heartbeat (stop) and the
      // close handler (don't re-settle / don't log a lost connection for a spliced one). settle itself
      // needs no double-call guard: `resolve` is idempotent, so the first outcome always wins.
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
      let heartbeatStarted = false;

      // On `go`: dial the local service and splice. `rest` (bytes buffered past the `go` newline — the
      // cloud's first TLS bytes) is fed to the local socket FIRST so nothing already sent is dropped,
      // then both directions are wired synchronously. Node emits no further 'data' on relayConn until
      // this handler returns, so detaching the frame reader and attaching the pumps here cannot race a
      // lost chunk (CLAUDE.md §1, the named splice-leftover trap — `rest` is NOT assumed empty).
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
        settle("done"); // this connection left the pool; the slot re-establishes to replace it
      };

      // The idle heartbeat, started once on `ack`. Each tick sends `ping`; a `pong` (consumed in
      // onData) must arrive before the NEXT tick, else the path is dead. Destroying the socket routes
      // through the `close` handler, which logs connection_lost and settles — the slot then tops up.
      const heartbeat = async (): Promise<void> => {
        while (!deps.signal.aborted && !settled) {
          await nap(heartbeatMs);
          if (deps.signal.aborted || settled) return;
          if (awaitingPong) {
            relayConn.destroy(); // no pong since the last ping → drop and replace
            return;
          }
          awaitingPong = true;
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
            // A malformed frame from the relay tears down only this connection; its `close` handler
            // settles and the slot replaces it (a garbage line is not an uncaught crash).
            relayConn.destroy();
            return;
          }
          if (decoded === null) return; // partial frame; wait for more bytes
          buf = decoded.rest;
          const { frame } = decoded;
          if (frame.t === "ack") {
            registered = true;
            backoff = 0; // a successful register clears the shared reconnect backoff
            deps.log("info", "tunnel.connection_registered", { boxId: deps.boxId });
            if (!heartbeatStarted) {
              heartbeatStarted = true;
              void heartbeat();
            }
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
            relayConn.destroy(); // never registered → the close handler settles 'failed' → backoff
            return;
          }
          if (frame.t === "pong") {
            awaitingPong = false; // liveness confirmed for this heartbeat interval
            continue;
          }
          // Any other frame is ignored; keep reading.
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
          settle("done"); // shutdown tore the socket down — not a lost connection, no log, no backoff
          return;
        }
        if (registered) {
          // An idle/registered connection dropped (heartbeat miss, relay close, or a garbage frame):
          // report it and top the pool back up with no backoff — the relay is reachable.
          deps.log("warn", "tunnel.connection_lost", { boxId: deps.boxId });
          settle("done");
        } else {
          settle("failed"); // never registered (connect refused, reset mid-handshake, or reject)
        }
      });
    });
  }

  // One pool slot: keep a connection alive, replacing it forever until abort. A failed establish grows
  // the shared backoff (logging stream_stalled once on the saturation edge) then sleeps it; a
  // registered-then-lost connection is replaced immediately.
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

  // Abort tears down every live socket, which unblocks any registered slot (its `close` handler
  // settles) and cancels every pending nap — so the slots exit and Promise.all resolves promptly.
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
