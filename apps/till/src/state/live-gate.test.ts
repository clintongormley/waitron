import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillLiveConnection } from "../api/live-connection.js";
import { liveGate } from "./live-gate.js";

const stops: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

it("with no connection keeps the fifteen-second timer and stops it", async () => {
  const run = vi.fn();
  const gate = liveGate(undefined, {
    types: ["devices"],
    intervalMs: 15_000,
    run,
    quietWhileConnected: true,
  });
  stops.push(() => gate.stop());
  await vi.advanceTimersByTimeAsync(14_999);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledOnce();
  gate.stop();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(run).toHaveBeenCalledOnce();
});

it.each([true, false])(
  "quiet=%s refreshes on up and matching bursts, keeping only the intended timer",
  async (quietWhileConnected) => {
    let event!: (name: string, data: string) => void;
    const connection = new TillLiveConnection({
      read: (_types, receive, signal) => {
        event = receive;
        return new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    });
    const run = vi.fn();
    const gate = liveGate(connection, {
      types: ["devices"],
      intervalMs: 15_000,
      run,
      quietWhileConnected,
    });
    stops.push(() => {
      gate.stop();
      connection.stop();
    });
    connection.start();
    expect(event).toBeTypeOf("function");
    event("ready", "{}");
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    event("change", '[{"type":"printers"}]');
    await Promise.resolve();
    expect(run).toHaveBeenCalledOnce();
    event("change", '[{"type":"devices"}]');
    event("change", '[{"type":"devices"}]');
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(quietWhileConnected ? 2 : 3);
    event("keepalive", "{}");
    gate.stop();
    event("change", '[{"type":"devices"}]');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(quietWhileConnected ? 2 : 3);
  },
);

it("a disconnected stream wakes a quiet timer immediately", async () => {
  let event!: (name: string, data: string) => void;
  let end!: () => void;
  const connection = new TillLiveConnection({
    read: (_types, receive) => {
      event = receive;
      return new Promise<void>((resolve) => {
        end = resolve;
      });
    },
  });
  const run = vi.fn();
  const gate = liveGate(connection, {
    types: ["devices"],
    intervalMs: 15_000,
    run,
    quietWhileConnected: true,
  });
  stops.push(() => {
    gate.stop();
    connection.stop();
  });
  connection.start();
  event("ready", "{}");
  await Promise.resolve();
  expect(run).toHaveBeenCalledOnce();
  end();
  await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);
});
