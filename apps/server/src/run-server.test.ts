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
});
