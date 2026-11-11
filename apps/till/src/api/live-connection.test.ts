import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillLiveConnection } from "./live-connection.js";
import { TillApi } from "./client.js";

const connections: TillLiveConnection[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const connection of connections.splice(0)) connection.stop();
  vi.useRealTimers();
});

function setup() {
  const reads: {
    types: readonly string[];
    event: (event: string, data: string) => void;
    signal: AbortSignal;
    end: () => void;
  }[] = [];
  const connection = new TillLiveConnection({
    read: (types, event, signal) =>
      new Promise<void>((end) => {
        reads.push({ types, event, signal, end });
        signal.addEventListener("abort", () => end(), { once: true });
      }),
  });
  connections.push(connection);
  connection.addInterests("device", ["devices"]);
  connection.start();
  expect(reads).toHaveLength(1);
  return { connection, reads };
}

it("is up only after ready and dispatches changes as resource types", () => {
  const { connection, reads } = setup();
  const up = vi.fn();
  const changes: unknown[] = [];
  connection.addEventListener("up", up);
  connection.addEventListener("change", (event) => changes.push((event as CustomEvent).detail));
  expect(connection.up).toBe(false);
  reads[0]!.event("ready", "{}");
  reads[0]!.event("change", '[{"type":"devices"},{"type":"printers"}]');
  expect(connection.up).toBe(true);
  expect(up).toHaveBeenCalledOnce();
  expect(changes).toEqual([{ types: ["devices", "printers"] }]);
});

it("counts silence down after thirty seconds and backs off reconnects from one to two seconds", async () => {
  const { connection, reads } = setup();
  const down = vi.fn();
  connection.addEventListener("down", down);
  reads[0]!.event("ready", "{}");
  await vi.advanceTimersByTimeAsync(29_999);
  expect(connection.up).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(connection.up).toBe(false);
  expect(down).toHaveBeenCalledOnce();
  expect(reads[0]!.signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(999);
  expect(reads).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads).toHaveLength(2);
  reads[1]!.end();
  await vi.advanceTimersByTimeAsync(1999);
  expect(reads).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads).toHaveLength(3);
});

it("keepalives every fifteen seconds keep the connection up", async () => {
  const { connection, reads } = setup();
  reads[0]!.event("ready", "{}");
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(15_000);
    reads[0]!.event("keepalive", "{}");
  }
  expect(connection.up).toBe(true);
  expect(reads).toHaveLength(1);
});

it("a revoked device stops, dispatches unauthorized and ignores late events", async () => {
  const { connection, reads } = setup();
  const unauthorized = vi.fn();
  const change = vi.fn();
  connection.addEventListener("unauthorized", unauthorized);
  connection.addEventListener("change", change);
  reads[0]!.event("ready", "{}");
  reads[0]!.event("session-invalid", '{"code":"device.unauthorized"}');
  reads[0]!.event("ready", "{}");
  reads[0]!.event("change", '[{"type":"devices"}]');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(connection.up).toBe(false);
  expect(unauthorized).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
  expect(reads).toHaveLength(1);
});

it("reopens only when the union of interests changes and keeps other owners", () => {
  const { connection, reads } = setup();
  connection.addInterests("device", ["devices"]);
  connection.addInterests("screen", ["devices"]);
  expect(reads).toHaveLength(1);
  connection.addInterests("transfers", ["department_transfer_requests"]);
  expect(reads.at(-1)!.types).toEqual(["department_transfer_requests", "devices"]);
  expect(reads[0]!.signal.aborted).toBe(true);
  connection.removeInterests("transfers");
  expect(reads.at(-1)!.types).toEqual(["devices"]);
  connection.stop();
  reads.at(-1)!.event("ready", "{}");
  expect(connection.up).toBe(false);
});

it("reads the shared stream with the device proof and no signed-in person, forwarding keepalives", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        'event: ready\ndata: {}\n\nevent: keepalive\ndata: {}\n\nevent: change\ndata: [{"type":"devices"}]\n\n',
      ),
    );
  const api = new TillApi("https://box.test", fetchImpl);
  api.namePersonFrom(() => ({ personId: "person-1" }), vi.fn());
  const received: string[][] = [];
  expect(api.readLiveEvents).toBeTypeOf("function");
  await api.readLiveEvents(["devices"], (name, data) => received.push([name, data]));
  const [url, options] = fetchImpl.mock.calls[0]!;
  expect(new URL(String(url)).pathname).toBe("/api/live/events");
  expect(JSON.parse(new URL(String(url)).searchParams.get("resources")!)).toEqual([
    { type: "devices" },
  ]);
  expect(new Headers(options?.headers).get("x-waitron-person")).toBeNull();
  expect(new Headers(options?.headers).get("accept")).toBe("text/event-stream");
  expect(options?.credentials).toBe("include");
  expect(received).toEqual([
    ["ready", "{}"],
    ["keepalive", "{}"],
    ["change", '[{"type":"devices"}]'],
  ]);
});
