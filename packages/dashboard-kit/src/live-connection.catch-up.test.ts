import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveData } from "./live-data.js";
import { LiveConnection } from "./live-connection.js";

class Stream extends EventTarget {
  readyState = 1;
  close = vi.fn();
  send(type: string, data: unknown, lastEventId = ""): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data), lastEventId }));
  }
  open(): void {
    this.dispatchEvent(new Event("open"));
  }
}

let data: LiveData;
let streams: Stream[];
let urls: URL[];
let generation: number;
let connection: LiveConnection;

const since = (index: number) => urls[index]!.searchParams.get("since");

function watch(type: string, read = vi.fn(async () => type)) {
  const observed = data.observe({ key: type, dependencies: [{ type }], read }, () => {});
  return { read, observed };
}

async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  data = new LiveData();
  streams = [];
  urls = [];
  generation = 1;
  connection = new LiveConnection(data, {
    open: (url) => {
      const stream = new Stream();
      streams.push(stream);
      urls.push(new URL(url, "https://venue.test"));
      return stream;
    },
    sessionGeneration: () => generation,
  });
});

afterEach(() => {
  connection?.stop();
  vi.unstubAllGlobals();
});

it("leaves an in-flight success alone when nothing changed", async () => {
  let finish!: (value: string) => void;
  const printers = watch(
    "printers",
    vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue("printers"),
  );
  connection.start("run:4");
  await settled();
  expect(since(0)).toBe("run:4");
  streams[0]!.open();
  await settled();
  expect(data.connected).toBe(false);
  streams[0]!.send("ready", { missed: [] }, "run:9");
  expect(printers.observed.snapshot.loading).toBe(true);
  finish("printers");
  await settled();
  expect(data.connected).toBe(true);
  expect(printers.read).toHaveBeenCalledOnce();
  expect(printers.observed.snapshot).toMatchObject({ status: "ready", value: "printers" });
});

it("reads again only what the server says changed", async () => {
  const printers = watch("printers");
  const courses = watch("courses");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [{ type: "courses" }] }, "run:9");
  await settled();
  expect(printers.read).toHaveBeenCalledOnce();
  expect(courses.read).toHaveBeenCalledTimes(2);
});

it.each([
  ["cannot say what changed", {}],
  ["names changes it cannot use", { missed: [{ id: "p1" }] }],
  ["answers something else", null],
])("reads everything again when the server %s", async (_, answer) => {
  const printers = watch("printers");
  const courses = watch("courses");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", answer, "run:9");
  await settled();
  expect(printers.read).toHaveBeenCalledTimes(2);
  expect(courses.read).toHaveBeenCalledTimes(2);
});

it("reads everything again when the stream opens without a position", async () => {
  const printers = watch("printers");
  connection.start();
  await settled();
  expect(since(0)).toBeNull();
  streams[0]!.open();
  streams[0]!.send("ready", {}, "run:9");
  await settled();
  expect(printers.read).toHaveBeenCalledTimes(2);
});

it.each(["ready", "keepalive", "change", "reset"])(
  "a page that watches something new carries on from the last %s",
  async (last) => {
    const printers = watch("printers");
    connection.start("run:4");
    await settled();
    streams[0]!.open();
    streams[0]!.send("ready", { missed: [] }, "run:5");
    if (last !== "ready") streams[0]!.send(last, [], "run:7");
    await settled();
    const reads = printers.read.mock.calls.length;
    const courses = watch("courses");
    await settled();
    expect(since(1)).toBe(last === "ready" ? "run:5" : "run:7");
    expect(streams[0]!.close).toHaveBeenCalledOnce();
    streams[1]!.open();
    streams[1]!.send("ready", { missed: [] }, "run:8");
    await settled();
    expect(printers.read).toHaveBeenCalledTimes(reads);
    expect(courses.read).toHaveBeenCalledOnce();
  },
);

it("a change it cannot use leaves the position before it", async () => {
  watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [] }, "run:5");
  streams[0]!.send("change", { type: "printers" }, "run:7");
  watch("courses");
  await settled();
  expect(since(1)).toBe("run:5");
});

it("a stream replaced before it is ready passes its starting position on", async () => {
  watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  watch("courses");
  await settled();
  expect(since(1)).toBe("run:4");
});

it("an event without a position leaves none to carry on from", async () => {
  watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [] });
  watch("courses");
  await settled();
  expect(since(1)).toBeNull();
});

it("reads everything again when a stream reopens itself after an error", async () => {
  const printers = watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [] }, "run:5");
  streams[0]!.readyState = 0;
  streams[0]!.dispatchEvent(new Event("error"));
  await vi.waitFor(() => expect(printers.read).toHaveBeenCalledTimes(2));
  await settled();
  streams[0]!.open();
  await settled();
  expect(printers.read).toHaveBeenCalledTimes(3);
});

it("a stream that fails before it first opens reads everything again when it does", async () => {
  const printers = watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.readyState = 0;
  streams[0]!.dispatchEvent(new Event("error"));
  await vi.waitFor(() => expect(printers.read).toHaveBeenCalledTimes(2));
  await settled();
  streams[0]!.open();
  await settled();
  expect(printers.read).toHaveBeenCalledTimes(3);
});

it("a broken stream leaves no position for the one that replaces it", async () => {
  const printers = watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [] }, "run:5");
  streams[0]!.readyState = 0;
  streams[0]!.dispatchEvent(new Event("error"));
  watch("courses");
  await settled();
  expect(since(1)).toBeNull();
  streams[1]!.open();
  await settled();
  expect(printers.read).toHaveBeenCalledTimes(2);
});

it.each([
  [
    "the page is left and shown again",
    () => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("pageshow"));
    },
  ],
  [
    "another session starts",
    () => {
      generation = 2;
      connection.start("run:9");
    },
  ],
  [
    "it is stopped and started",
    () => {
      connection.stop();
      watch("courses");
      connection.start();
    },
  ],
])("no position is carried on when %s", async (_, act) => {
  watch("printers");
  connection.start("run:4");
  await settled();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [] }, "run:5");
  act();
  await settled();
  expect(since(1)).toBeNull();
});

it("reads a failed read again though nothing changed", async () => {
  const failing = vi.fn(async () => {
    throw new Error("refused");
  });
  const printers = watch("printers");
  watch("courses", failing as never);
  connection.start("run:4");
  await settled();
  expect(failing).toHaveBeenCalledOnce();
  streams[0]!.open();
  streams[0]!.send("ready", { missed: [] }, "run:5");
  await settled();
  expect(failing).toHaveBeenCalledTimes(2);
  expect(printers.read).toHaveBeenCalledOnce();
});

it.each(["answers", "fails"] as const)(
  "finishes recovery when an in-flight retry %s after ready",
  async (outcome) => {
    const error = new Error("refused");
    let finish!: () => void;
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = () => {
              if (outcome === "answers") resolve("courses");
              else reject(error);
            };
          }),
      )
      .mockResolvedValue("courses");
    const { observed } = watch("courses", read);
    connection.start("run:4");
    await settled();
    data.invalidate([{ type: "courses" }]);
    await settled();
    expect(read).toHaveBeenCalledTimes(2);
    streams[0]!.open();
    expect(observed.snapshot).toMatchObject({ status: "error", loading: true });
    streams[0]!.send("ready", { missed: [] }, "run:5");
    finish();
    await settled();
    expect(read).toHaveBeenCalledTimes(outcome === "answers" ? 2 : 3);
    expect(observed.snapshot).toMatchObject({ status: "ready", value: "courses" });
  },
);

it.each([true, false])(
  "retries a read that fails after the stream is ready (recovers: %s)",
  async (recovers) => {
    const error = new Error("refused");
    let fail!: (error: Error) => void;
    const read = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockImplementation(async () => {
        if (!recovers) throw error;
        return "fresh courses";
      });
    const { observed } = watch("courses", read);
    connection.start("run:4");
    await settled();
    streams[0]!.open();
    streams[0]!.send("ready", { missed: [] }, "run:5");
    expect(observed.snapshot.loading).toBe(true);
    fail(error);
    await settled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(observed.snapshot).toMatchObject(
      recovers ? { status: "ready", value: "fresh courses" } : { status: "error", error },
    );
  },
);
