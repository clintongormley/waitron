import { describe, expect, it, vi } from "vitest";
import { LiveData } from "./live-data.js";
import { LiveConnection } from "./live-connection.js";

class Stream extends EventTarget {
  close = vi.fn();
  send(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

describe("live connection", () => {
  it("shares a stream, refreshes on open and routes identity events to active queries", async () => {
    const data = new LiveData();
    const stream = new Stream();
    const open = vi.fn<(url: string) => Stream>(() => stream);
    const connection = new LiveConnection(data, { open });
    const read = vi.fn(async () => 1);
    const observed = data.observe(
      { key: "printer/p1", dependencies: [{ type: "printers", id: "p1" }], read },
      () => {},
    );
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();
    connection.start();
    await Promise.resolve();
    expect(open).toHaveBeenCalledOnce();
    expect(
      new URL(open.mock.calls[0]![0], "https://venue.test").searchParams.get("resources"),
    ).toBe(JSON.stringify([{ type: "printers", id: "p1" }]));
    stream.dispatchEvent(new Event("open"));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    stream.send("change", [{ type: "printers", id: "p2" }]);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    stream.send("change", [{ type: "printers", id: "p1" }]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    observed.unsubscribe();
    await Promise.resolve();
    expect(stream.close).toHaveBeenCalledOnce();
    connection.stop();
  });

  it("closes and clears cached data on session invalidation", async () => {
    const data = new LiveData();
    const stream = new Stream();
    const invalid = vi.fn();
    const connection = new LiveConnection(data, { open: () => stream, onSessionInvalid: invalid });
    const observed = data.observe(
      { key: "jobs", dependencies: [{ type: "print_jobs" }], read: async () => ["private job"] },
      () => {},
    );
    connection.start();
    await vi.waitFor(() => expect(observed.snapshot.value).toEqual(["private job"]));
    stream.send("session-invalid", { code: "management_session.expired" });
    expect(stream.close).toHaveBeenCalledOnce();
    expect(observed.snapshot.value).toBeUndefined();
    expect(invalid).toHaveBeenCalledWith("management_session.expired");
    observed.unsubscribe();
  });
});

it("reopens a permanently closed stream with backoff and cancels retries on logout", async () => {
  vi.useFakeTimers();
  const data = new LiveData();
  const streams: (Stream & { readyState: number })[] = [];
  const open = vi.fn(() => {
    const stream = Object.assign(new Stream(), { readyState: 2 });
    streams.push(stream);
    return stream;
  });
  const connection = new LiveConnection(data, { open });
  const read = vi.fn(async () => 1);
  data.observe({ key: "printers", dependencies: [{ type: "printers" }], read }, () => {});
  connection.start();
  try {
    await vi.advanceTimersByTimeAsync(0);
    streams[0]!.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(open).toHaveBeenCalledTimes(2);
    expect(streams[0]!.close).toHaveBeenCalledOnce();
    streams[1]!.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(open).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(open).toHaveBeenCalledTimes(3);
    streams[2]!.dispatchEvent(new Event("error"));
    connection.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(open).toHaveBeenCalledTimes(3);
  } finally {
    connection.stop();
    vi.useRealTimers();
  }
});

describe("live connection lifecycle", () => {
  it("subscribes to interests once however often it is started, and stop leaves none", () => {
    const data = new LiveData();
    let subscribed = 0;
    const subscribe = data.subscribeToInterests.bind(data);
    vi.spyOn(data, "subscribeToInterests").mockImplementation((changed) => {
      subscribed += 1;
      const unsubscribe = subscribe(changed);
      return () => {
        subscribed -= 1;
        unsubscribe();
      };
    });
    const connection = new LiveConnection(data, { open: () => new Stream() });
    connection.start();
    connection.start();
    expect(subscribed).toBe(1);
    connection.stop();
    expect(subscribed).toBe(0);
  });

  it("opens one stream when several interests arrive in the same tick", async () => {
    const data = new LiveData();
    const open = vi.fn<(url: string) => Stream>(() => new Stream());
    const connection = new LiveConnection(data, { open });
    connection.start();
    const a = data.observe(
      { key: "a", dependencies: [{ type: "a" }], read: async () => 1 },
      () => {},
    );
    const b = data.observe(
      { key: "b", dependencies: [{ type: "b" }], read: async () => 1 },
      () => {},
    );
    await Promise.resolve();
    expect(open).toHaveBeenCalledOnce();
    expect(
      new URL(open.mock.calls[0]![0], "https://venue.test").searchParams.get("resources"),
    ).toBe(JSON.stringify([{ type: "a" }, { type: "b" }]));
    a.unsubscribe();
    b.unsubscribe();
    connection.stop();
  });

  it("keeps its stream when a new view observes resources it already follows", async () => {
    const data = new LiveData();
    const stream = new Stream();
    const open = vi.fn(() => stream);
    const connection = new LiveConnection(data, { open });
    const first = data.observe(
      { key: "printers", dependencies: [{ type: "printers" }], read: async () => 1 },
      () => {},
    );
    connection.start();
    await Promise.resolve();
    const second = data.observe(
      { key: "printers?active", dependencies: [{ type: "printers" }], read: async () => 1 },
      () => {},
    );
    await Promise.resolve();
    expect(open).toHaveBeenCalledOnce();
    expect(stream.close).not.toHaveBeenCalled();
    first.unsubscribe();
    second.unsubscribe();
    connection.stop();
  });

  it("opens nothing when stopped before its first open, even if a view observes in that tick", async () => {
    const data = new LiveData();
    const open = vi.fn(() => new Stream());
    const connection = new LiveConnection(data, { open });
    connection.start();
    connection.stop();
    const observed = data.observe(
      { key: "printers", dependencies: [{ type: "printers" }], read: async () => 1 },
      () => {},
    );
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    observed.unsubscribe();
  });

  it("opens the management event stream with credentials by default", async () => {
    const constructed: { url: string; init: unknown }[] = [];
    vi.stubGlobal(
      "EventSource",
      class extends Stream {
        constructor(url: string, init: unknown) {
          super();
          constructed.push({ url, init });
        }
      },
    );
    const data = new LiveData();
    const connection = new LiveConnection(data);
    const observed = data.observe(
      { key: "printers", dependencies: [{ type: "printers" }], read: async () => 1 },
      () => {},
    );
    try {
      connection.start();
      await Promise.resolve();
      expect(constructed).toEqual([
        {
          url: `/management-api/events?resources=${encodeURIComponent(JSON.stringify([{ type: "printers" }]))}`,
          init: { withCredentials: true },
        },
      ]);
    } finally {
      observed.unsubscribe();
      connection.stop();
      vi.unstubAllGlobals();
    }
  });
});

describe("live connection events", () => {
  async function connected() {
    const data = new LiveData();
    const streams: Stream[] = [];
    const invalid = vi.fn();
    const connection = new LiveConnection(data, {
      open: () => {
        const stream = new Stream();
        streams.push(stream);
        return stream;
      },
      onSessionInvalid: invalid,
    });
    const read = vi.fn(async () => 1);
    const observed = data.observe(
      { key: "printer/p1", dependencies: [{ type: "printers", id: "p1" }], read },
      () => {},
    );
    connection.start();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(streams).toHaveLength(1);
    return { data, streams, stream: streams[0]!, invalid, read, observed, connection };
  }
  // Long enough for a scheduled read to have started, if one was scheduled.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("refreshes every query when the server resets the stream", async () => {
    const { stream, read, connection } = await connected();
    stream.dispatchEvent(new Event("reset"));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    connection.stop();
  });

  it("refreshes without reopening when the stream reports an error it will retry itself", async () => {
    vi.useFakeTimers();
    try {
      const data = new LiveData();
      const open = vi.fn(() => Object.assign(new Stream(), { readyState: 0 }));
      const connection = new LiveConnection(data, { open });
      const read = vi.fn(async () => 1);
      data.observe({ key: "printers", dependencies: [{ type: "printers" }], read }, () => {});
      connection.start();
      await vi.advanceTimersByTimeAsync(0);
      open.mock.results[0]!.value.dispatchEvent(new Event("error"));
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(open).toHaveBeenCalledOnce();
      expect(open.mock.results[0]!.value.close).not.toHaveBeenCalled();
      connection.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores events from a stream it has already replaced", async () => {
    const { data, streams, read, observed, connection } = await connected();
    const other = data.observe(
      { key: "tables", dependencies: [{ type: "tables" }], read: async () => 1 },
      () => {},
    );
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    streams[0]!.dispatchEvent(new Event("open"));
    streams[0]!.send("change", [{ type: "printers", id: "p1" }]);
    await settle();
    expect(read).toHaveBeenCalledOnce();
    other.unsubscribe();
    observed.unsubscribe();
    connection.stop();
  });

  it("invalidates every query of a type when a change names no id", async () => {
    const { stream, read, connection } = await connected();
    stream.send("change", [{ type: "printers" }]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    connection.stop();
  });

  it.each([
    ["a payload that is not a list", { type: "printers", id: "p1" }],
    ["a resource with no type", [{ type: "printers", id: "p1" }, { id: "p1" }]],
    ["a null resource", [{ type: "printers", id: "p1" }, null]],
    [
      "a resource whose id is not a string",
      [
        { type: "printers", id: "p1" },
        { type: "printers", id: 1 },
      ],
    ],
  ])("ignores the whole change message for %s", async (_, payload) => {
    const { stream, read, connection } = await connected();
    stream.send("change", payload);
    await settle();
    expect(read).toHaveBeenCalledOnce();
    connection.stop();
  });

  it("refreshes every query when a change message is not JSON", async () => {
    const { stream, read, connection } = await connected();
    stream.dispatchEvent(new MessageEvent("change", { data: "not json" }));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    connection.stop();
  });

  it("stays connected when a session-invalid message carries no code", async () => {
    const { stream, read, invalid, observed, connection } = await connected();
    stream.send("session-invalid", { reason: "expired" });
    await settle();
    expect(invalid).not.toHaveBeenCalled();
    expect(stream.close).not.toHaveBeenCalled();
    expect(observed.snapshot.value).toBe(1);
    expect(read).toHaveBeenCalledOnce();
    connection.stop();
  });

  it("refreshes and stays connected when a session-invalid message is not JSON", async () => {
    const { stream, read, invalid, connection } = await connected();
    stream.dispatchEvent(new MessageEvent("session-invalid", { data: "not json" }));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(invalid).not.toHaveBeenCalled();
    expect(stream.close).not.toHaveBeenCalled();
    connection.stop();
  });
});
