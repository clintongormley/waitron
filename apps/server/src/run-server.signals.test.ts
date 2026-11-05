import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installShutdownHandlers, restartProcess } from "./run-server.js";

const CHILD = fileURLToPath(new URL("./testing/shutdown-signals-child.ts", import.meta.url));

function runChild(how: "ask" | "signal") {
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
    expect(result).toMatchObject({ code: 0, signal: null });
  }, 30_000);

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
