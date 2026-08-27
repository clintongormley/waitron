// The box-side tunnel client. The box sits behind NAT with no inbound ports, so it dials OUT to the
// relay and keeps a pool of registered idle connections open; when the relay pairs one with a cloud
// client (a `go` frame), the box dials its own local service port and splices raw bytes between the
// two, TLS end-to-end. This module knows nothing of sync, cursors, or SQL — its one job is "keep the
// box reachable through the relay by proxying to a local port" (spec §5).
//
// Scope: the single-connection happy path plus pool replenishment. Heartbeat, reconnect and bounded
// backoff on a failure to ESTABLISH connections are Task 4, layered onto this same file; the fields
// `heartbeatMs`/`minBackoffMs`/`maxBackoffMs` are accepted now so the boot wiring is stable, and the
// supervisory loop is added around this structure without a rewrite.
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
  /** Abort-aware sleep, injected so Task 4's backoff asserts durations instead of waiting them
   * (the loop.ts idiom). Unused on this task's happy path; accepted now for a stable boot signature. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Aborts the whole client: every connection is torn down and {@link runTunnelClient} resolves. */
  signal: AbortSignal;
  /** Structured logger — `tunnel.*` codes are logged as free strings, never thrown, and their params
   * carry ids and counts only, never a token or a payload byte. */
  log: (level: "info" | "warn" | "error", code: string, params?: Record<string, unknown>) => void;
  /** Task 4: idle heartbeat interval. Accepted now, unused here. */
  heartbeatMs?: number;
  /** Task 4: first reconnect backoff. Accepted now, unused here. */
  minBackoffMs?: number;
  /** Task 4: reconnect backoff ceiling. Accepted now, unused here. */
  maxBackoffMs?: number;
}

/**
 * Run the box tunnel client until `deps.signal` aborts. Maintains `poolSize` (default 4) registered
 * idle connections to the relay; when the relay pairs one with a cloud client (`go`), dials the local
 * service and splices, then replenishes the pool. Resolves when the signal aborts, tearing every
 * live socket down.
 */
export async function runTunnelClient(deps: TunnelClientDeps): Promise<void> {
  const poolSize = deps.poolSize ?? 4;
  const localHost = deps.localHost ?? "127.0.0.1";

  // Connections that count toward `poolSize`: still connecting, or registered and idle. A connection
  // handed to a splice leaves this set (it no longer keeps the box reachable), which is what a
  // `go`-driven top-up replaces.
  const pool = new Set<Socket>();
  // Every live socket (relay + local), so an abort can destroy them all and leak no open handle.
  const sockets = new Set<Socket>();

  const track = (s: Socket): void => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };

  // Open new relay connections until `poolSize` are connecting-or-registered. Never runs after abort,
  // so a torn-down connection during shutdown is not replaced.
  const topUp = (): void => {
    if (deps.signal.aborted) return;
    while (pool.size < poolSize) openConnection();
  };

  function openConnection(): void {
    const relayConn = connect(deps.relayPort, deps.relayHost);
    pool.add(relayConn);
    track(relayConn);
    // Widened to `Buffer` (not the narrower `Buffer<ArrayBuffer>` that `Buffer.alloc` infers) so it
    // accepts `decodeFrame`'s `rest`, which is a `subarray` view (`Buffer<ArrayBufferLike>`).
    let buf: Buffer = Buffer.alloc(0);

    // On `go`: dial the local service and splice. `rest` (bytes buffered past the `go` newline — the
    // cloud's first TLS bytes) is fed to the local socket FIRST so nothing already sent is dropped,
    // then both directions are wired synchronously. Node emits no further 'data' on relayConn until
    // this handler returns, so detaching the frame reader and attaching the pumps here cannot race a
    // lost chunk (CLAUDE.md §1, the named splice-leftover trap — `rest` is NOT assumed empty).
    const startSplice = (rest: Buffer): void => {
      relayConn.off("data", onData);
      pool.delete(relayConn);
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
      topUp(); // replace the slot this connection just left
    };

    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        let decoded: ReturnType<typeof decodeFrame>;
        try {
          decoded = decodeFrame(buf);
        } catch {
          // A malformed frame from the relay tears down only this connection; its `close` handler
          // replaces it (carry-forward: a garbage line is not an uncaught crash).
          relayConn.destroy();
          return;
        }
        if (decoded === null) return; // partial frame; wait for more bytes
        buf = decoded.rest;
        const { frame } = decoded;
        if (frame.t === "ack") {
          deps.log("info", "tunnel.connection_registered", { boxId: deps.boxId });
          continue;
        }
        if (frame.t === "go") {
          startSplice(buf);
          return;
        }
        if (frame.t === "reject") {
          deps.log("warn", "tunnel.registration_rejected", { boxId: deps.boxId, code: frame.code });
          relayConn.destroy();
          return;
        }
        // Any other frame is ignored; keep reading. Heartbeat is box-INITIATED — the box SENDS `ping`
        // and the relay replies `pong` (testing/relay.ts) — so the only frame that ever arrives here at
        // rest is `pong`. Task 4 adds the ping sender and reads that pong for liveness; Task 3 builds no
        // heartbeat (YAGNI), so there is deliberately no inbound-ping handling here.
      }
    };

    relayConn.on("connect", () => {
      relayConn.write(encodeFrame({ t: "register", boxId: deps.boxId, token: deps.token }));
    });
    relayConn.on("data", onData);
    relayConn.on("error", () => relayConn.destroy());
    relayConn.on("close", () => {
      // Replace only a connection still in the pool; a spliced connection was already replaced when it
      // left the pool, so its later close must not over-provision.
      if (pool.delete(relayConn)) topUp();
    });
  }

  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      for (const s of sockets) s.destroy();
      resolve();
    };
    if (deps.signal.aborted) {
      onAbort();
      return;
    }
    deps.signal.addEventListener("abort", onAbort, { once: true });
    topUp();
  });
}
