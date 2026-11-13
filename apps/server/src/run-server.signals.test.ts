import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installShutdownHandlers, restartProcess } from "./run-server.js";

const CHILD = fileURLToPath(new URL("./testing/shutdown-signals-child.ts", import.meta.url));

function runChild(how: "ask" | "signal" | "early") {
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), CHILD, how], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }>(
    (resolve) => child.once("close", (code, signal) => resolve({ code, signal, out })),
  );
}

describe("repeated requests to restart during a slow shutdown", () => {
  // Why the asking must stop: `once` has removed the listener, so Node's default action applies.
  it("a second SIGTERM kills a process that is not process 1 before its close finishes", async () => {
    const result = await runChild("signal");

    expect(result.signal).toBe("SIGTERM");
    expect(result.out).toContain("close started");
    expect(result.out).not.toContain("close finished");
  }, 30_000);

  it("asking again and again lets the close finish and the process exit cleanly", async () => {
    const result = await runChild("ask");

    // Failing case, an ask that always signals: `signal` SIGTERM, and `close finished` is missing.
    expect(result.out).toContain("close finished");
    expect(
      result.out
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line).event),
    ).toEqual(["server.shutdown_complete"]);
    expect(result).toMatchObject({ code: 0, signal: null });
  }, 30_000);

  it("a restart asked for before the handlers are installed shuts down through them once they are", async () => {
    const result = await runChild("early");

    expect(result.out.split("\n").filter((line) => !line.startsWith("{"))).toEqual([
      "handlers going in",
      "close started",
      "close finished",
      "",
    ]);
    expect(result).toMatchObject({ code: 0, signal: null });
  }, 30_000);

  it("keeps an ask made before the handlers exist, sends no signal, and starts the shutdown once they are installed", async () => {
    vi.resetModules();
    const fresh = await import("./run-server.js");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    let closes = 0;
    try {
      fresh.restartProcess();
      expect(kill).not.toHaveBeenCalled();
      fresh.installShutdownHandlers(
        { close: () => ((closes += 1), new Promise<void>(() => {})) },
        {
          on: () => {},
          write: (_line, done) => done(),
          exit: () => {},
          now: () => new Date("2026-09-08T00:00:00Z"),
          setTimer: () => ({ cancel: () => {} }),
        },
      );
      expect(closes).toBe(1);
      fresh.restartProcess();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it("sends this process SIGTERM until a shutdown is under way, and nothing after", () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const handlers = new Map<string, () => void>();
    installShutdownHandlers(
      { close: () => new Promise<void>(() => {}) },
      {
        on: (signal, handler) => void handlers.set(signal, handler),
        write: (_line, done) => done(),
        exit: () => {},
        now: () => new Date("2026-09-08T00:00:00Z"),
        setTimer: () => ({ cancel: () => {} }),
      },
    );

    restartProcess();
    restartProcess();
    expect(kill.mock.calls).toEqual([
      [process.pid, "SIGTERM"],
      [process.pid, "SIGTERM"],
    ]);

    handlers.get("SIGTERM")!();
    restartProcess();
    expect(kill).toHaveBeenCalledTimes(2);
    kill.mockRestore();
  });
});

describe("a restart the server asks for itself", () => {
  async function freshHandlers(target: {
    close(): Promise<void>;
    beforeRestart?: () => Promise<void>;
  }) {
    vi.resetModules();
    const fresh = await import("./run-server.js");
    const handlers = new Map<string, () => void>();
    const exit = vi.fn();
    const install = () =>
      fresh.installShutdownHandlers(target, {
        on: (signal, handler) => void handlers.set(signal, handler),
        write: (_line, done) => done(),
        exit,
        now: () => new Date("2026-09-08T00:00:00Z"),
        setTimer: () => ({ cancel: () => {} }),
      });
    return { fresh, handlers, exit, install };
  }

  function recorded() {
    const order: string[] = [];
    return {
      order,
      target: {
        beforeRestart: vi.fn(async () => void order.push("before restart")),
        close: vi.fn(async () => void order.push("close")),
      },
    };
  }

  it("runs the server's own step before closing, whether the ask came before or after the handlers were installed", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const early = recorded();
      const one = await freshHandlers(early.target);
      one.fresh.restartProcess();
      one.install();
      await vi.waitFor(() => expect(one.exit).toHaveBeenCalledWith(0));
      expect(early.order).toEqual(["before restart", "close"]);

      const late = recorded();
      const two = await freshHandlers(late.target);
      two.install();
      two.fresh.restartProcess();
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
      two.handlers.get("SIGTERM")!();
      await vi.waitFor(() => expect(two.exit).toHaveBeenCalledWith(0));
      expect(late.order).toEqual(["before restart", "close"]);
    } finally {
      kill.mockRestore();
    }
  });

  it("does not run it for a signal from outside", async () => {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const outside = recorded();
      const h = await freshHandlers(outside.target);
      h.install();
      h.handlers.get(signal)!();
      await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
      expect(outside.order).toEqual(["close"]);
    }
  });

  it("still closes and exits cleanly when that step fails", async () => {
    const close = vi.fn(() => Promise.resolve());
    const h = await freshHandlers({
      beforeRestart: () => Promise.reject(new Error("EROFS")),
      close,
    });
    h.fresh.restartProcess();
    h.install();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
