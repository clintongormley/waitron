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
