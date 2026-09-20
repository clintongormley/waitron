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
  options: [] as Record<string, unknown>[],
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
        constructor(options: Record<string, unknown>) {
          super();
          state.clients.push(this);
          state.options.push(options);
        }
      },
    },
  };
});
afterEach(() => {
  state.clients.length = 0;
  state.connects.length = 0;
  state.options.length = 0;
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

it("passes on the id a resource identity carries", async () => {
  // The other side of the identity parser from the case above, which covers the shapes that are
  // refused and the one that has no id. A change about ONE row is the common case in production and
  // nothing was reaching the branch that copies its id.
  const onChange = vi.fn();
  const listener = await startChangeListener("test", { onChange, onReset: () => {} });
  state.clients[0]!.emit("notification", {
    channel: "waitron_changes",
    payload: JSON.stringify({ resources: [{ type: "printers", id: "printer-1" }] }),
  });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    resources: [{ type: "printers", id: "printer-1" }],
  });
  await listener.close();
});

it("ignores a notification on another channel that would otherwise be a change", async () => {
  // The suite already emits on another channel, but with a payload that is refused anyway — so it
  // passes whether the channel is checked or not. This one carries a payload that WOULD produce a
  // change, which is what makes the channel the only reason nothing happens.
  const onChange = vi.fn();
  const listener = await startChangeListener("test", { onChange, onReset: () => {} });
  state.clients[0]!.emit("notification", {
    channel: "some_other_channel",
    payload: JSON.stringify({ resources: [{ type: "printers", id: "printer-1" }] }),
  });
  expect(onChange).not.toHaveBeenCalled();
  await listener.close();
});

it("survives a payload that is valid JSON but not an object", async () => {
  // `42` and `"text"` parse fine and then have to be refused before anything asks what is in them.
  // Asking `"resources" in 42` is a TypeError, and this handler runs on an event emitter, so it
  // would not be a rejected promise anybody sees — it would take the process down.
  const onChange = vi.fn();
  const listener = await startChangeListener("test", { onChange, onReset: () => {} });
  for (const payload of ["42", '"text"', "true"]) {
    expect(() =>
      state.clients[0]!.emit("notification", { channel: "waitron_changes", payload }),
    ).not.toThrow();
  }
  // And the same shape one level in, where each identity is asked what type it is.
  expect(() =>
    state.clients[0]!.emit("notification", {
      channel: "waitron_changes",
      payload: JSON.stringify({ resources: [42] }),
    }),
  ).not.toThrow();
  expect(onChange).not.toHaveBeenCalled();
  await listener.close();
});

it("names itself to the server, bounds its own connect, and asks to listen", async () => {
  // The connection is a separate one from the pool the application uses, so a DBA looking at
  // pg_stat_activity sees a name rather than an anonymous session; without the timeout a
  // half-open socket would leave the listener waiting for ever instead of retrying; and without
  // the LISTEN there is no live update at all, only a connection that looks healthy.
  const listener = await startChangeListener("postgres://example/db", {
    onChange: () => {},
    onReset: () => {},
  });
  expect(state.options[0]).toEqual({
    connectionString: "postgres://example/db",
    application_name: "waitron-live-updates",
    connectionTimeoutMillis: 5000,
  });
  expect(state.clients[0]!.query).toHaveBeenCalledExactlyOnceWith("listen waitron_changes");
  await listener.close();
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

it("absorbs connection failures when the caller asked for no error callback", async () => {
  // onError is optional, and both places that use it are on paths a dropped connection reaches on
  // its own. Calling it unconditionally would turn a recoverable disconnect into a thrown
  // TypeError inside an event handler and inside a promise nobody is watching.
  vi.useFakeTimers();
  const listener = await startChangeListener("test", { onChange: () => {}, onReset: () => {} });
  expect(() => state.clients[0]!.emit("error", new Error("dropped"))).not.toThrow();
  state.connects.push(async () => {
    throw new Error("offline");
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.clients).toHaveLength(2);
  await expect(listener.close()).resolves.toBeUndefined();
});

it("ignores a connection it has already replaced", async () => {
  // A connection the listener has moved on from still emits — the socket closes, the driver
  // reports the error that killed it — and every one of those events arrives after a healthy
  // replacement is running. Acting on them would report a failure that is not happening and open
  // a third connection nobody needs.
  vi.useFakeTimers();
  const onError = vi.fn();
  const listener = await startChangeListener("test", {
    onChange: () => {},
    onReset: () => {},
    onError,
  });
  const first = state.clients[0]!;
  first.emit("end");
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.clients).toHaveLength(2);

  onError.mockClear();
  first.emit("error", new Error("old socket"));
  first.emit("end");
  await vi.advanceTimersByTimeAsync(20_000);
  expect(onError).not.toHaveBeenCalled();
  expect(state.clients).toHaveLength(2);
  await listener.close();
});

it("reconnects after a reported error without waiting for the socket to close", async () => {
  // The driver reports some failures as an error with no end event behind them, so the error
  // handler has to start the reconnect itself rather than leave it to the end handler.
  vi.useFakeTimers();
  const listener = await startChangeListener("test", {
    onChange: () => {},
    onReset: () => {},
    onError: vi.fn(),
  });
  state.clients[0]!.emit("error", new Error("dropped"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.clients).toHaveLength(2);
  await listener.close();
});

it("waits twice as long before each further reconnect attempt", async () => {
  // A server that is down stays down, and a fixed one-second retry would hammer it. The first
  // retry is after a second, the next after two.
  vi.useFakeTimers();
  const listener = await startChangeListener("test", {
    onChange: () => {},
    onReset: () => {},
    onError: vi.fn(),
  });
  state.connects.push(async () => {
    throw new Error("offline");
  });
  state.clients[0]!.emit("end");

  await vi.advanceTimersByTimeAsync(1000);
  expect(state.clients).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1500);
  expect(state.clients).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(600);
  expect(state.clients).toHaveLength(3);
  await listener.close();
});

it("schedules one reconnect however often a dying connection reports itself", async () => {
  // A dropped connection commonly emits an error and then an end, and can emit several errors.
  // Each one asks for a reconnect; only the first may set a timer, or one disconnect opens three
  // connections.
  vi.useFakeTimers();
  const listener = await startChangeListener("test", {
    onChange: () => {},
    onReset: () => {},
    onError: vi.fn(),
  });
  const first = state.clients[0]!;
  first.emit("error", new Error("dropped"));
  first.emit("error", new Error("dropped again"));
  first.emit("end");
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.clients).toHaveLength(2);
  await listener.close();
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
