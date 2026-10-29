import { expect, it, vi } from "vitest";
import { LiveData } from "./live-data.js";
import { LiveConnection } from "./live-connection.js";

class Stream extends EventTarget {
  close = vi.fn();
  send(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

it("ignores old-account stream changes and expiry and reconnects for the next generation", async () => {
  let generation = 1;
  const data = new LiveData();
  const streams: Stream[] = [];
  const onSessionInvalid = vi.fn();
  const read = vi.fn(async () => "current");
  const observed = data.observe(
    { key: "items", dependencies: [{ type: "printers" }], read },
    () => {},
  );
  const connection = new LiveConnection(data, {
    open: () => {
      const stream = new Stream();
      streams.push(stream);
      return stream;
    },
    onSessionInvalid,
    sessionGeneration: () => generation,
  });
  try {
    connection.start();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    generation = 2;
    streams[0]!.send("change", [{ type: "printers" }]);
    streams[0]!.send("session-invalid", { code: "management_session.expired" });
    await Promise.resolve();
    expect(onSessionInvalid).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(observed.snapshot.value).toBe("current");
    connection.start();
    await vi.waitFor(() => expect(streams).toHaveLength(2));
    expect(streams[0]!.close).toHaveBeenCalledOnce();
    streams[1]!.send("change", [{ type: "printers" }]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    streams[1]!.send("session-invalid", { code: "management_session.expired" });
    expect(onSessionInvalid).toHaveBeenCalledWith("management_session.expired", 2);
  } finally {
    connection.stop();
    observed.unsubscribe();
  }
});

it("still reports node reset delivered by an old stream", async () => {
  let generation = 1;
  const data = new LiveData();
  const stream = new Stream();
  const onSessionInvalid = vi.fn();
  const observed = data.observe(
    { key: "items", dependencies: [{ type: "printers" }], read: async () => [] },
    () => {},
  );
  const connection = new LiveConnection(data, {
    open: () => stream,
    onSessionInvalid,
    sessionGeneration: () => generation,
  });
  try {
    connection.start();
    await Promise.resolve();
    generation = 2;
    stream.send("session-invalid", { code: "node.reset" });
    expect(onSessionInvalid).toHaveBeenCalledWith("node.reset", 1);
  } finally {
    connection.stop();
    observed.unsubscribe();
  }
});
