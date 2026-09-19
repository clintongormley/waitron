import { afterEach, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";
import { startChangeListener } from "./change-listener.js";

interface Client extends EventEmitter {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}
const state = vi.hoisted(() => ({
  clients: [] as Client[],
  connects: [] as (() => Promise<void>)[],
}));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    default: {
      Client: class extends EventEmitter {
        connect = vi.fn(state.connects.shift() ?? (async () => {}));
        query = vi.fn(async () => {});
        end = vi.fn(async () => {
          this.emit("end");
        });
        constructor() {
          super();
          state.clients.push(this);
        }
      },
    },
  };
});
afterEach(() => {
  state.clients.length = 0;
  state.connects.length = 0;
  vi.useRealTimers();
});

it("ignores malformed notifications and accepts collection identities without exposing extra values", async () => {
  const onChange = vi.fn();
  const listener = await startChangeListener("test", { onChange, onReset: () => {} });
  const client = state.clients[0]!;
  for (const value of [
    null,
    {},
    { resources: null },
    { resources: [null] },
    { resources: [{ type: 1 }] },
    { resources: [{ type: "printers", id: 1 }] },
  ]) {
    client.emit("notification", { channel: "waitron_changes", payload: JSON.stringify(value) });
  }
  client.emit("notification", { channel: "waitron_changes" });
  client.emit("notification", { channel: "other", payload: "{}" });
  expect(onChange).not.toHaveBeenCalled();
  client.emit("notification", {
    channel: "waitron_changes",
    payload: JSON.stringify({
      // The parser copies only the fields it knows; anything else the payload carries — `secret`
      // here — is dropped rather than passed through onto the change.
      resources: [{ type: "printers", secret: "hidden" }],
    }),
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    resources: [{ type: "printers" }],
  });
  await listener.close();
  client.emit("notification", { channel: "waitron_changes", payload: "{}" });
  client.emit("error", new Error("old connection"));
  expect(onChange).toHaveBeenCalledOnce();
});

it("retries failed reconnects once per backoff and ignores retired clients", async () => {
  vi.useFakeTimers();
  const onReset = vi.fn();
  const onError = vi.fn();
  const listener = await startChangeListener("test", { onChange: () => {}, onReset, onError });
  const first = state.clients[0]!;
  state.connects.push(async () => {
    throw new Error("offline");
  });
  first.emit("error", new Error("dropped"));
  first.emit("end");
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.clients).toHaveLength(2);
  expect(state.clients[1]!.end).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2000);
  expect(state.clients).toHaveLength(3);
  expect(onReset).toHaveBeenCalledTimes(2);
  first.emit("error", new Error("old"));
  first.emit("notification", { channel: "waitron_changes", payload: "{}" });
  expect(onError).toHaveBeenCalledTimes(2);
  state.clients[2]!.emit("end");
  await listener.close();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(state.clients).toHaveLength(3);
});

it("closes a failed initial connection", async () => {
  state.connects.push(async () => {
    throw new Error("offline");
  });
  await expect(
    startChangeListener("test", { onChange: () => {}, onReset: () => {} }),
  ).rejects.toThrow("offline");
  expect(state.clients[0]!.end).toHaveBeenCalledOnce();
});

it("stops a reconnect already waiting for its connection", async () => {
  vi.useFakeTimers();
  const onReset = vi.fn();
  const listener = await startChangeListener("test", { onChange: () => {}, onReset });
  let connect!: () => void;
  state.connects.push(
    () =>
      new Promise<void>((resolve) => {
        connect = resolve;
      }),
  );
  state.clients[0]!.emit("end");
  await vi.advanceTimersByTimeAsync(1000);
  const closed = listener.close();
  connect();
  await closed;
  expect(onReset).toHaveBeenCalledOnce();
  expect(state.clients[1]!.query).not.toHaveBeenCalled();
});

it("does not signal a reset after shutdown while LISTEN is still completing", async () => {
  vi.useFakeTimers();
  const onReset = vi.fn();
  const listener = await startChangeListener("test", { onChange: () => {}, onReset });
  let connect!: () => void;
  let finishQuery!: () => void;
  state.connects.push(
    () =>
      new Promise<void>((resolve) => {
        connect = resolve;
      }),
  );
  state.clients[0]!.emit("end");
  await vi.advanceTimersByTimeAsync(1000);
  state.clients[1]!.query.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishQuery = resolve;
      }),
  );
  connect();
  await Promise.resolve();
  await Promise.resolve();
  const closed = listener.close();
  finishQuery();
  await closed;
  expect(onReset).toHaveBeenCalledOnce();
});

// A connection that refuses to close is the one failure the listener must absorb rather than pass
// on: `end()` is called on a connection the listener is already finished with, so a rejection there
// says nothing about whether live updates can carry on. Each of the three call sites is reached in
// a different state, so each gets its own case.

it("keeps reconnecting when the connection it is replacing refuses to close", async () => {
  vi.useFakeTimers();
  const onReset = vi.fn();
  const onError = vi.fn();
  const listener = await startChangeListener("test", { onChange: () => {}, onReset, onError });
  const first = state.clients[0]!;
  first.end.mockRejectedValue(new Error("socket already gone"));

  first.emit("end");
  await vi.advanceTimersByTimeAsync(1000);

  expect(state.clients).toHaveLength(2);
  expect(onReset).toHaveBeenCalledTimes(2);
  expect(onError).not.toHaveBeenCalled();
  await listener.close();
});

it("reports the connect failure, not the close failure, when a failed connection also refuses to close", async () => {
  state.connects.push(async () => {
    state.clients.at(-1)!.end.mockRejectedValue(new Error("socket already gone"));
    throw new Error("offline");
  });

  await expect(
    startChangeListener("test", { onChange: () => {}, onReset: () => {} }),
  ).rejects.toThrow("offline");
  expect(state.clients[0]!.end).toHaveBeenCalledOnce();
});

it("closes cleanly when the live connection refuses to close", async () => {
  const listener = await startChangeListener("test", { onChange: () => {}, onReset: () => {} });
  state.clients[0]!.end.mockRejectedValue(new Error("socket already gone"));

  await expect(listener.close()).resolves.toBeUndefined();
});
