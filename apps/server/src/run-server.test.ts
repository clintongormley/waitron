import { describe, expect, it, vi } from "vitest";
import { installShutdownHandlers } from "./run-server.js";

function harness(closeImpl: () => Promise<void>) {
  const handlers = new Map<string, () => void>();
  const exit = vi.fn();
  const written: string[] = [];
  installShutdownHandlers(
    { close: closeImpl },
    {
      on: (sig, fn) => void handlers.set(sig, fn),
      write: (line, done) => {
        written.push(line);
        done();
      },
      exit,
      now: () => new Date("2026-09-08T00:00:00Z"),
    },
  );
  return { handlers, exit, written };
}

describe("installShutdownHandlers", () => {
  it("closes and exits 0 on SIGTERM", async () => {
    const h = harness(() => Promise.resolve());
    h.handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
  });

  it("logs a classified code and exits 1 when close rejects", async () => {
    const h = harness(() => Promise.reject(new Error("pool end failed")));
    h.handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(1));
    expect(h.written.join("")).toContain("server.shutdown_failed");
    // The raw driver message can embed the connection string — it must not reach the sink.
    expect(h.written.join("")).not.toContain("pool end failed");
  });

  it("a second signal of a DIFFERENT name does not start a second shutdown", async () => {
    const close = vi.fn(() => Promise.resolve());
    const h = harness(close);
    h.handlers.get("SIGTERM")!();
    h.handlers.get("SIGINT")!();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });

  // A box's whole restart mechanism is SIGTERM → shutdown → exit → Docker restarts into trading mode.
  // If close() hangs (a keep-alive socket, a stuck pool), the process must STILL exit or the box never
  // comes back — the setup→trading hang seen on real hardware. A deadline forces the exit.
  it("forces exit when close() hangs past the shutdown deadline", () => {
    let fire: (() => void) | undefined;
    const exit = vi.fn();
    const written: string[] = [];
    const handlers = new Map<string, () => void>();
    installShutdownHandlers(
      { close: () => new Promise<void>(() => {}) }, // never resolves
      {
        on: (sig, fn) => void handlers.set(sig, fn),
        write: (line, done) => {
          written.push(line);
          done();
        },
        exit,
        now: () => new Date("2026-09-08T00:00:00Z"),
        setTimer: (_ms, fn) => {
          fire = fn;
          return { cancel: () => {} };
        },
      },
    );
    handlers.get("SIGTERM")!();
    expect(exit).not.toHaveBeenCalled(); // still waiting on close()
    fire!(); // the deadline elapses
    expect(exit).toHaveBeenCalledWith(0);
    expect(written.join("")).toContain("server.shutdown_timeout");
  });

  // The deadline's exit must not depend on the log write completing — a stalled/broken stdout pipe
  // must not be able to keep a wedged box from restarting. (The write callback is never invoked here.)
  it("forces exit even when the shutdown-timeout log write never completes", () => {
    let fire: (() => void) | undefined;
    const exit = vi.fn();
    const handlers = new Map<string, () => void>();
    installShutdownHandlers(
      { close: () => new Promise<void>(() => {}) },
      {
        on: (sig, fn) => void handlers.set(sig, fn),
        write: () => {
          /* never calls done — models a stalled pipe */
        },
        exit,
        now: () => new Date("2026-09-08T00:00:00Z"),
        setTimer: (_ms, fn) => {
          fire = fn;
          return { cancel: () => {} };
        },
      },
    );
    handlers.get("SIGTERM")!();
    fire!();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("cancels the deadline when close() resolves cleanly (no forced exit)", async () => {
    let cancelled = false;
    const exit = vi.fn();
    const handlers = new Map<string, () => void>();
    installShutdownHandlers(
      { close: () => Promise.resolve() },
      {
        on: (sig, fn) => void handlers.set(sig, fn),
        write: (_line, done) => done(),
        exit,
        now: () => new Date("2026-09-08T00:00:00Z"),
        setTimer: () => ({
          cancel: () => {
            cancelled = true;
          },
        }),
      },
    );
    handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(cancelled).toBe(true);
  });
});
