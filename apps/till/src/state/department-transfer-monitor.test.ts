import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../api/client.js";
import { DepartmentTransferMonitor } from "./department-transfer-monitor.js";
import type { DepartmentTransfer } from "../api/client.js";

const pending: DepartmentTransfer = {
  id: "request-1",
  tabId: "tab-1",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "sender",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending",
  reason: null,
  createdAt: "2026-10-07T09:00:00.000Z",
  resolvedAt: null,
  revision: 0,
};
const monitors: { stop(): void }[] = [];
beforeEach(() =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }),
);
afterEach(() => {
  for (const monitor of monitors.splice(0)) monitor.stop();
  vi.useRealTimers();
});
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
function desk() {
  let incoming = [pending];
  let sent = [pending];
  let readError: { code: string; status: number } | undefined;
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const reads: string[] = [];
  const api = new client.TillApi("", async (input, init) => {
    const url = String(input);
    if (url.endsWith("/events")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.push(controller);
        },
      });
      init?.signal?.addEventListener(
        "abort",
        () => {
          void body.cancel().catch(() => undefined);
        },
        { once: true },
      );
      return new Response(body);
    }
    reads.push(url);
    if (readError) return json({ error: { code: readError.code, params: {} } }, readError.status);
    if (url.endsWith("/incoming")) return json({ count: incoming.length, requests: incoming });
    if (url === "/api/working-orders/tab-1/department-transfers") return json({ requests: sent });
    throw new Error(`Unexpected read ${url}`);
  });
  const invalid: string[] = [];
  const monitor = new DepartmentTransferMonitor({
    api,
    changed() {},
    onAccessLost(code) {
      invalid.push(code);
    },
  });
  monitors.push(monitor);
  return {
    monitor,
    streams,
    reads,
    invalid,
    queue(rows: DepartmentTransfer[]) {
      incoming = rows;
    },
    source(rows: DepartmentTransfer[]) {
      sent = rows;
    },
    refuse(code: string, status: number) {
      readError = { code, status };
    },
    recover() {
      readError = undefined;
    },
    signal(event: string, data = "{}") {
      streams.at(-1)!.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`));
    },
  };
}

function consumedResponse(body: unknown) {
  const response = json(body);
  const text = response.text.bind(response);
  let finish!: () => void;
  const consumed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  response.text = async () => {
    const value = await text();
    finish();
    return value;
  };
  return { response, consumed };
}

describe("DepartmentTransferMonitor", () => {
  it("loads pending requests once per desk and dismisses only the notification", async () => {
    const first = desk();
    const second = desk();
    first.monitor.start();
    second.monitor.start();
    await settle();
    await expect.poll(() => first.monitor.snapshot.incoming).toEqual([pending]);
    await expect.poll(() => second.monitor.snapshot.incoming).toEqual([pending]);
    await expect.poll(() => first.monitor.snapshot.notifications).toEqual([pending]);
    first.monitor.dismiss(pending.id);
    await expect.poll(() => first.monitor.snapshot.incoming).toEqual([pending]);
    await expect.poll(() => first.monitor.snapshot.notifications).toEqual([]);
    await expect.poll(() => second.monitor.snapshot.notifications).toEqual([pending]);
    first.signal("change");
    await settle();
    await expect.poll(() => first.monitor.snapshot.notifications).toEqual([]);
    expect(first.reads.every((url) => url.endsWith("/incoming"))).toBe(true);
  });

  it("reloads a durable request after a disconnected device reconnects", async () => {
    const source = desk();
    source.queue([]);
    source.monitor.start();
    await settle();
    source.streams[0]!.close();
    await settle();
    source.queue([pending]);
    vi.advanceTimersByTime(999);
    await settle();
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(source.streams).toHaveLength(2);
    source.signal("ready");
    await settle();
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([pending]);
    await expect.poll(() => source.monitor.snapshot.notifications).toEqual([pending]);
  });

  it("removes a resolved request from both receiving queues without writing", async () => {
    const first = desk();
    const second = desk();
    first.monitor.start();
    second.monitor.start();
    await settle();
    await expect.poll(() => first.monitor.snapshot.incoming).toEqual([pending]);
    await expect.poll(() => second.monitor.snapshot.incoming).toEqual([pending]);
    first.queue([]);
    second.queue([]);
    first.signal("change");
    second.signal("change");
    await settle();
    await expect.poll(() => first.monitor.snapshot.incoming).toEqual([]);
    await expect.poll(() => second.monitor.snapshot.incoming).toEqual([]);
    await expect.poll(() => first.monitor.snapshot.notifications).toEqual([]);
    expect(first.reads.every((url) => url.endsWith("/incoming"))).toBe(true);
  });

  it.each(["accepted", "declined", "withdrawn"] as const)(
    "notifies the sender of %s using source history rather than destination browsing",
    async (status) => {
      const source = desk();
      source.queue([]);
      source.monitor.watchSource("tab-1");
      source.monitor.start();
      await settle();
      await expect.poll(() => source.monitor.snapshot.sent).toEqual([pending]);
      await expect.poll(() => source.monitor.snapshot.notifications).toEqual([]);
      const resolved = {
        ...pending,
        status,
        resolvedBy: "receiver",
        resolvedAt: "2026-10-07T09:05:00.000Z",
        reason: status === "declined" ? "Closing soon" : null,
        revision: 1,
      };
      source.source([resolved]);
      source.signal("change");
      await settle();
      await expect.poll(() => source.monitor.snapshot.sent).toEqual([resolved]);
      await expect.poll(() => source.monitor.snapshot.notifications).toEqual([resolved]);
      source.monitor.dismiss(resolved.id);
      source.signal("change");
      await settle();
      await expect.poll(() => source.monitor.snapshot.sent).toEqual([resolved]);
      await expect.poll(() => source.monitor.snapshot.notifications).toEqual([]);
      expect(
        source.reads.every(
          (url) =>
            url.endsWith("/incoming") || url === "/api/working-orders/tab-1/department-transfers",
        ),
      ).toBe(true);
    },
  );

  it("keeps a sender's updates while the profile is not a designated receiving desk", async () => {
    const reads: string[] = [];
    const api = new client.TillApi("", async (url) => {
      reads.push(String(url));
      if (String(url).endsWith("/incoming"))
        return json({ error: { code: "department_transfer.not_allowed", params: {} } }, 403);
      if (String(url).endsWith("/events")) return new Response(new ReadableStream());
      return json({ requests: [pending] });
    });
    const monitor = new DepartmentTransferMonitor({ api, changed() {} });
    monitors.push(monitor);
    monitor.watchSource("tab-1");
    monitor.start();
    await settle();
    await expect.poll(() => monitor.snapshot.receivingAllowed).toBe(false);
    await expect.poll(() => monitor.snapshot.incoming).toEqual([]);
    await expect.poll(() => monitor.snapshot.sent).toEqual([pending]);
    expect(monitor.running).toBe(true);
  });

  it("stops and clears another operator's rows on a stream permission refusal", async () => {
    const source = desk();
    source.monitor.start();
    await settle();
    source.signal("session-invalid", '{"code":"device_profile.not_admitted"}');
    await settle();
    expect(source.monitor.running).toBe(false);
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([]);
    await expect.poll(() => source.monitor.snapshot.notifications).toEqual([]);
    expect(source.invalid).toEqual(["device_profile.not_admitted"]);
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(source.streams).toHaveLength(1);
  });

  it("polls durable reads when the stream sends no change and retains the last queue after a read failure", async () => {
    const source = desk();
    source.monitor.start();
    await settle();
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([pending]);
    source.refuse("server.internal", 500);
    vi.advanceTimersByTime(15_000);
    await settle();
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([pending]);
    await expect
      .poll(() => source.monitor.snapshot.error)
      .toEqual({ code: "server.internal", status: 500 });
    source.recover();
    source.queue([]);
    vi.advanceTimersByTime(15_000);
    await settle();
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([]);
    await expect.poll(() => source.monitor.snapshot.error).toBeUndefined();
  });

  it("ignores an old source response after switching tabs and loads the new tab", async () => {
    let resolve!: (response: Response) => void;
    const api = new client.TillApi("", async (url) => {
      if (String(url).endsWith("/events")) return new Response(new ReadableStream());
      if (String(url).endsWith("/incoming")) return json({ count: 0, requests: [] });
      if (String(url).includes("tab-1"))
        return new Promise<Response>((answer) => {
          resolve = answer;
        });
      return json({ requests: [] });
    });
    const monitor = new DepartmentTransferMonitor({ api, changed() {} });
    monitors.push(monitor);
    monitor.watchSource("tab-1");
    monitor.start();
    await settle();
    monitor.watchSource("tab-2");
    await settle();
    const late = consumedResponse({ requests: [pending] });
    resolve(late.response);
    await late.consumed;
    await settle();
    await expect.poll(() => monitor.snapshot.sent).toEqual([]);
  });

  it("does not apply a late queue response after stop and restart", async () => {
    let resolve!: (response: Response) => void;
    let requests = 0;
    const api = new client.TillApi("", async (url) => {
      if (String(url).endsWith("/events")) return new Response(new ReadableStream());
      if (++requests === 1)
        return new Promise<Response>((answer) => {
          resolve = answer;
        });
      return json({ count: 0, requests: [] });
    });
    const monitor = new DepartmentTransferMonitor({ api, changed() {} });
    monitors.push(monitor);
    monitor.start();
    await settle();
    monitor.stop();
    monitor.start();
    await settle();
    await expect.poll(() => monitor.snapshot.receivingAllowed).toBe(true);
    const late = consumedResponse({ count: 1, requests: [pending] });
    resolve(late.response);
    await late.consumed;
    await settle();
    await expect.poll(() => monitor.snapshot.incoming).toEqual([]);
    await expect.poll(() => monitor.snapshot.notifications).toEqual([]);
  });
  it("clears loaded rows immediately when a durable read loses person permissions", async () => {
    const source = desk();
    source.monitor.start();
    await expect.poll(() => source.monitor.snapshot.incoming).toEqual([pending]);
    source.refuse("authorization.not_permitted", 403);
    source.monitor.refresh();
    await expect.poll(() => source.monitor.running).toBe(false);
    expect(source.monitor.snapshot.incoming).toEqual([]);
    expect(source.invalid).toEqual(["authorization.not_permitted"]);
  });

  it("ends an initially forbidden connection without scheduling retries", async () => {
    const api = new client.TillApi("", async (url) =>
      String(url).endsWith("/events")
        ? json({ error: { code: "device.forbidden_action", params: {} } }, 403)
        : json({ count: 0, requests: [] }),
    );
    const codes: string[] = [];
    const monitor = new DepartmentTransferMonitor({
      api,
      changed() {},
      onAccessLost(code) {
        codes.push(code);
      },
    });
    monitors.push(monitor);
    monitor.start();
    await expect.poll(() => monitor.running).toBe(false);
    expect(codes).toEqual(["device.forbidden_action"]);
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(monitor.running).toBe(false);
  });

  it("coalesces repeated reloads while a read is out, then reads the newer queue", async () => {
    let resolve!: (response: Response) => void;
    let reads = 0;
    const api = new client.TillApi("", async (url) => {
      if (String(url).endsWith("/events")) return new Response(new ReadableStream());
      if (++reads === 1)
        return new Promise<Response>((answer) => {
          resolve = answer;
        });
      return json({ count: 1, requests: [pending] });
    });
    const monitor = new DepartmentTransferMonitor({ api, changed() {} });
    monitors.push(monitor);
    monitor.start();
    for (let i = 0; i < 10; i++) monitor.refresh();
    expect(reads).toBe(1);
    resolve(json({ count: 0, requests: [] }));
    await expect.poll(() => monitor.snapshot.incoming).toEqual([pending]);
    expect(reads).toBe(2);
  });

  it("bounds a read that never answers and ignores its late response", async () => {
    let resolve!: (response: Response) => void;
    let reads = 0;
    const api = new client.TillApi("", async (url) => {
      if (String(url).endsWith("/events")) return new Response(new ReadableStream());
      if (++reads === 1)
        return new Promise<Response>((answer) => {
          resolve = answer;
        });
      return json({ count: 0, requests: [] });
    });
    const monitor = new DepartmentTransferMonitor({ api, changed() {} });
    monitors.push(monitor);
    monitor.start();
    vi.advanceTimersByTime(25_000);
    await settle();
    await expect.poll(() => monitor.snapshot.receivingAllowed).toBe(true);
    const late = consumedResponse({ count: 1, requests: [pending] });
    resolve(late.response);
    await late.consumed;
    await settle();
    expect(monitor.snapshot.incoming).toEqual([]);
    expect(reads).toBe(2);
  });
  it("forgets the watched source tab when an operator's session ends", async () => {
    const source = desk();
    source.queue([]);
    source.monitor.watchSource("tab-1");
    source.monitor.start();
    await expect.poll(() => source.monitor.snapshot.sent).toEqual([pending]);
    source.monitor.stop();
    const previousReads = source.reads.length;
    source.monitor.start();
    await expect.poll(() => source.monitor.snapshot.receivingAllowed).toBe(true);
    expect(source.reads.slice(previousReads)).toEqual(["/api/department-transfers/incoming"]);
    expect(source.monitor.snapshot.sent).toEqual([]);
  });
  it("does not clear a source-history failure when the receiving queue recovers", async () => {
    let sourceState: "ready" | "failed" | "waiting" = "ready";
    let incoming: DepartmentTransfer[] = [];
    const api = new client.TillApi("", async (url) => {
      if (String(url).endsWith("/events")) return new Response(new ReadableStream());
      if (String(url).endsWith("/incoming"))
        return json({ count: incoming.length, requests: incoming });
      if (String(url).includes("tab-2")) return json({ requests: [] });
      if (sourceState === "failed")
        return json({ error: { code: "server.internal", params: {} } }, 500);
      if (sourceState === "waiting") return new Promise<Response>(() => {});
      return json({ requests: [pending] });
    });
    const monitor = new DepartmentTransferMonitor({ api, changed() {} });
    monitors.push(monitor);
    monitor.watchSource("tab-1");
    monitor.start();
    await expect.poll(() => monitor.snapshot.sent).toEqual([pending]);
    sourceState = "failed";
    monitor.refresh();
    await expect
      .poll(() => monitor.snapshot.error)
      .toEqual({ code: "server.internal", status: 500 });
    sourceState = "waiting";
    incoming = [{ ...pending, id: "incoming-2" }];
    monitor.refresh();
    await expect.poll(() => monitor.snapshot.incoming).toEqual([{ ...pending, id: "incoming-2" }]);
    expect(monitor.snapshot.error).toEqual({ code: "server.internal", status: 500 });
    monitor.watchSource("tab-2");
    await expect.poll(() => monitor.snapshot.error).toBeUndefined();
  });
});
