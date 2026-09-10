/**
 * Close a raw http/https listener so it actually resolves — dropping keep-alive sockets first.
 *
 * Node's `server.close()` stops accepting new connections but its callback fires only once EVERY
 * existing connection has ended, idle keep-alive sockets included. A browser holds one open: the
 * setup "waiting for the box to come back" screen polls this very server over a keep-alive
 * connection, so a plain `close()` never resolves — which wedged the setup→trading self-restart (the
 * process never exited, so Docker's `restart: unless-stopped` never fired). `closeIdleConnections()`
 * drops the idle ones at once; `closeAllConnections()`, after a short grace for genuinely in-flight
 * requests, drops the rest. Both are http.Server methods absent from http2 (which `serve()`'s return
 * type unions in), so both are optional and called only when present.
 */

import { type Timer, unrefTimer } from "./unref-timer.js";

export interface CloseListenerDeps {
  /** Grace before force-closing still-open connections (ms). */
  graceMs?: number;
  /** Injected for tests; default is an unref'd setTimeout. */
  setTimer?: (ms: number, fn: () => void) => Timer;
}

export interface RawListener {
  close(callback: (error?: Error) => void): void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

const DEFAULT_GRACE_MS = 500;

export async function closeListener(
  server: RawListener,
  deps: CloseListenerDeps = {},
): Promise<void> {
  server.closeIdleConnections?.();
  // Register close() before arming the grace timer, so the forced closeAllConnections fires into a
  // close() already waiting to resolve.
  const closed = new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const setTimer = deps.setTimer ?? unrefTimer;
  const timer = setTimer(deps.graceMs ?? DEFAULT_GRACE_MS, () => server.closeAllConnections?.());
  try {
    await closed;
  } finally {
    timer.cancel();
  }
}
