import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveConnection } from "./live-connection.js";
import { LiveData } from "./live-data.js";

class Stream extends EventTarget {
  readyState = 0;
  close = vi.fn();
  send(type: string, value: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(value) }));
  }
}

let page: EventTarget;
let connection: LiveConnection;
let data: LiveData;
let streams: Stream[];
let values: number[];
let generation: number;
let invalid: ReturnType<typeof vi.fn<(code: string, generation?: number) => void>>;

beforeEach(async () => {
  vi.useFakeTimers();
  page = new EventTarget();
  vi.stubGlobal("window", page);
  data = new LiveData();
  streams = [];
  values = [];
  generation = 1;
  invalid = vi.fn();
  connection = new LiveConnection(data, {
    open: () => {
      const stream = new Stream();
      streams.push(stream);
      return stream;
    },
    sessionGeneration: () => generation,
    onSessionInvalid: invalid,
  });
  data.observe(
    {
      key: "alerts",
      dependencies: [{ type: "alerts" }],
      read: async () => {
        const value = values.length + 1;
        values.push(value);
        return value;
      },
    },
    () => {},
  );
  connection.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(values).toEqual([1]);
});

afterEach(() => {
  connection.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("starts no read when a stream errors just before pagehide", async () => {
  streams[0]!.dispatchEvent(new Event("error"));
  // Chromium can report the stream failure before it dispatches pagehide during reload.
  await Promise.resolve();
  page.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(values).toEqual([1]);
  expect(streams).toHaveLength(1);
  expect(streams[0]!.close).toHaveBeenCalledOnce();
});

it("holds a read already queued by a change when the document is hidden", async () => {
  streams[0]!.send("change", [{ type: "alerts" }]);
  page.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);
  expect(values).toEqual([1]);
});

it("holds timer and newly observed reads until the document returns", async () => {
  data.observe(
    { key: "clock", dependencies: [], refreshMs: 100, read: async () => values.push(10) },
    () => {},
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(values).toEqual([1, 10]);
  page.dispatchEvent(new Event("pagehide"));
  data.observe(
    { key: "late", dependencies: [{ type: "printers" }], read: async () => values.push(20) },
    () => {},
  );
  data.refresh();
  connection.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(values).toEqual([1, 10]);
  expect(streams).toHaveLength(1);
  page.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(0);
  expect(values).toEqual([1, 10, 3, 10, 20]);
  expect(streams).toHaveLength(2);
});

it("retains observers and snapshots for history restoration then refreshes once", async () => {
  const observed = data.observe(
    { key: "alerts", dependencies: [{ type: "alerts" }], read: async () => 999 },
    () => {},
  );
  page.dispatchEvent(new Event("pagehide"));
  expect(observed.snapshot.value).toBe(1);
  page.dispatchEvent(new Event("pageshow"));
  page.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(0);
  expect(values).toEqual([1, 2]);
  expect(observed.snapshot.value).toBe(2);
  expect(streams).toHaveLength(2);
});

it("keeps refreshing after a cancelled beforeunload without waiting for pageshow", async () => {
  const cancel = (event: Event): void => event.preventDefault();
  page.addEventListener("beforeunload", cancel);
  const leaving = new Event("beforeunload", { cancelable: true });
  expect(page.dispatchEvent(leaving)).toBe(false);
  streams[0]!.dispatchEvent(new Event("error"));
  await vi.advanceTimersByTimeAsync(1);
  expect(values).toEqual([1, 2]);
  expect(streams[0]!.close).not.toHaveBeenCalled();
});

it("ignores old-generation errors deferred before a session change", async () => {
  streams[0]!.dispatchEvent(new Event("error"));
  generation = 2;
  await vi.advanceTimersByTimeAsync(1);
  expect(values).toEqual([1]);
  connection.start();
  await vi.advanceTimersByTimeAsync(0);
  streams[1]!.dispatchEvent(new Event("error"));
  await vi.advanceTimersByTimeAsync(1);
  expect(values).toEqual([1, 2]);
});

it("does not revive a stopped connection when the document returns", async () => {
  page.dispatchEvent(new Event("pagehide"));
  connection.stop();
  page.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(values).toEqual([1]);
  expect(streams).toHaveLength(1);
});

it("ignores every old-stream event while hidden and after history restoration", async () => {
  const old = streams[0]!;
  page.dispatchEvent(new Event("pagehide"));
  for (const type of ["open", "error", "reset"]) old.dispatchEvent(new Event(type));
  old.send("change", [{ type: "alerts" }]);
  old.send("session-invalid", { code: "node.reset" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(values).toEqual([1]);
  expect(invalid).not.toHaveBeenCalled();
  page.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(0);
  old.dispatchEvent(new Event("error"));
  old.send("session-invalid", { code: "management_session.expired" });
  await vi.advanceTimersByTimeAsync(1);
  expect(values).toEqual([1, 2]);
  expect(invalid).not.toHaveBeenCalled();
  streams[1]!.send("session-invalid", { code: "management_session.expired" });
  expect(invalid).toHaveBeenCalledWith("management_session.expired", 1);
});

it("cancels a closed-stream retry while the page is away", async () => {
  streams[0]!.readyState = 2;
  streams[0]!.dispatchEvent(new Event("error"));
  await vi.advanceTimersByTimeAsync(1);
  expect(values).toEqual([1, 2]);
  page.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(streams).toHaveLength(1);
  page.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(0);
  expect(streams).toHaveLength(2);
});
