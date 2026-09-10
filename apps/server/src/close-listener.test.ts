import { describe, it, expect } from "vitest";
import { closeListener } from "./close-listener.js";

/** A fake raw http/https listener. `resolveOnAllClosed` models Node's real behaviour: `close()`'s
 *  callback fires only once the last connection is gone — i.e. only after `closeAllConnections()`. */
function fakeServer(opts: { resolveOnAllClosed?: boolean } = {}) {
  const calls = { idle: 0, all: 0 };
  let cb: ((e?: Error) => void) | undefined;
  return {
    calls,
    closeIdleConnections() {
      calls.idle++;
    },
    closeAllConnections() {
      calls.all++;
      if (opts.resolveOnAllClosed) cb?.();
    },
    close(callback: (e?: Error) => void) {
      cb = callback;
    },
    finish(e?: Error) {
      cb?.(e);
    },
  };
}

// Fire the grace timer synchronously so the test needs no real clock.
const immediate = (_ms: number, fn: () => void) => {
  fn();
  return { cancel: () => {} };
};

describe("closeListener", () => {
  it("force-closes all connections after the grace so a keep-alive socket cannot hang close()", async () => {
    // The bug: a browser keep-alive (the setup 'waiting for the box' poll) keeps a socket open, and
    // Node's close() never resolves until every connection ends. This fake resolves ONLY when
    // closeAllConnections runs — so if closeListener did not force them, this would hang forever.
    const s = fakeServer({ resolveOnAllClosed: true });
    await closeListener(s, { graceMs: 5, setTimer: immediate });
    expect(s.calls.idle).toBe(1);
    expect(s.calls.all).toBe(1);
  });

  it("drops idle connections immediately, before the grace", async () => {
    const s = fakeServer();
    const p = closeListener(s, { graceMs: 5, setTimer: () => ({ cancel: () => {} }) });
    expect(s.calls.idle).toBe(1); // called synchronously, not awaiting the grace
    s.finish();
    await p;
  });

  it("cancels the grace timer when close() resolves on its own", async () => {
    const s = fakeServer();
    let cancelled = false;
    const p = closeListener(s, {
      graceMs: 5,
      setTimer: () => ({
        cancel: () => {
          cancelled = true;
        },
      }),
    });
    s.finish(); // clean close, no keep-alive to force
    await p;
    expect(cancelled).toBe(true);
    expect(s.calls.all).toBe(0);
  });

  it("rejects when close() reports an error", async () => {
    const s = fakeServer();
    const p = closeListener(s, { setTimer: immediate });
    s.finish(new Error("boom"));
    await expect(p).rejects.toThrow("boom");
  });

  it("tolerates a listener without the connection-dropping methods (http2)", async () => {
    let cb: ((e?: Error) => void) | undefined;
    const bare = {
      close(callback: (e?: Error) => void) {
        cb = callback;
      },
    };
    const p = closeListener(bare, { setTimer: immediate });
    cb?.();
    await expect(p).resolves.toBeUndefined();
  });
});
