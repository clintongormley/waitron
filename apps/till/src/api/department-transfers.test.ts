import { afterEach, describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

const request = {
  id: "request-1",
  tabId: "tab-1",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "sender-1",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending",
  reason: null,
  createdAt: "2026-10-07T09:00:00.000Z",
  resolvedAt: null,
  revision: 0,
};
const detail = {
  request,
  tab: {
    id: "tab-1",
    revision: 7,
    status: "placed",
    label: "Lunch",
    orderNumber: 12,
    deliveryTableId: null,
  },
  lines: [
    {
      id: "line-1",
      name: "Soup",
      variantName: null,
      quantity: "0.500",
      unitPriceGross: "2.80",
      note: "No salt",
      parentLineId: null,
    },
  ],
  outstandingWork: [
    {
      id: "work-1",
      lineId: "line-1",
      stationId: "kitchen-1",
      state: "queued",
      note: "No salt",
      firedAt: "2026-10-07T09:01:00.000Z",
      awayAt: null,
      courseId: null,
    },
  ],
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const controllers: AbortController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
});
function stream() {
  const abort = new AbortController();
  controllers.push(abort);
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } }));
  return {
    abort,
    body,
    fetchImpl,
    api: new TillApi("https://primary.test", fetchImpl),
    send(text: string) {
      writer.enqueue(new TextEncoder().encode(text));
    },
    end() {
      writer.close();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

describe("departmental transfer client", () => {
  it("reads the desk queue, current work, source history and usable destinations through separate gated routes", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.credentials).toBe("include");
      expect(init?.signal).toBe(abort.signal);
      switch (url) {
        case "https://primary.test/api/department-transfers/incoming":
          return json({ count: 1, requests: [request] });
        case "https://primary.test/api/department-transfers/request-1":
          return json(detail);
        case "https://primary.test/api/working-orders/tab-1/department-transfers":
          return json({ requests: [request] });
        case "https://primary.test/api/department-transfers/destinations":
          return json({ destinations: [{ id: "restaurant", name: "Restaurant" }] });
        default:
          throw new Error(`Unexpected route ${String(url)}`);
      }
    });
    const api = new TillApi("https://primary.test", fetchImpl);
    const abort = new AbortController();
    expect(await api.listIncomingDepartmentTransfers({ signal: abort.signal })).toEqual({
      count: 1,
      requests: [request],
    });
    expect(await api.getDepartmentTransfer("request-1", { signal: abort.signal })).toEqual(detail);
    expect(await api.listSentDepartmentTransfers("tab-1", { signal: abort.signal })).toEqual({
      requests: [request],
    });
    expect(await api.listDepartmentTransferDestinations({ signal: abort.signal })).toEqual({
      destinations: [{ id: "restaurant", name: "Restaurant" }],
    });
  });

  it.each([
    [
      "request",
      "/api/working-orders/tab-1/department-transfers",
      { destinationDepartmentId: "restaurant" },
    ],
    ["withdraw", "/api/department-transfers/request-1/withdraw", undefined],
    [
      "accept",
      "/api/department-transfers/request-1/accept",
      { revision: 7, zoneId: "terrace", tableId: "table-2" },
    ],
    ["decline", "/api/department-transfers/request-1/decline", { reason: "Closing soon" }],
  ] as const)(
    "sends %s only as an explicit write with the server's command fields",
    async (action, path, body) => {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
        expect(url).toBe(path);
        expect(init).toEqual(
          body === undefined
            ? { method: "POST", credentials: "include" }
            : {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              },
        );
        return json(request);
      });
      const api = new TillApi("", fetchImpl);
      const result =
        action === "request"
          ? await api.requestDepartmentTransfer("tab-1", "restaurant")
          : action === "withdraw"
            ? await api.withdrawDepartmentTransfer("request-1")
            : action === "accept"
              ? await api.acceptDepartmentTransfer("request-1", {
                  revision: 7,
                  zoneId: "terrace",
                  tableId: "table-2",
                })
              : await api.declineDepartmentTransfer("request-1", "Closing soon");
      expect(result).toEqual(request);
    },
  );

  it("keeps field, revision and authentication refusals intact for the editor", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(
          {
            error: { code: "department_transfer.destination_invalid", params: { field: "zoneId" } },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        json({ error: { code: "working_order.out_of_date", params: { revision: 8 } } }, 409),
      )
      .mockResolvedValueOnce(
        json({ error: { code: "department_transfer.not_allowed", params: {} } }, 403),
      );
    const api = new TillApi("", fetchImpl);
    await expect(
      api.acceptDepartmentTransfer("request-1", { revision: 7, zoneId: "terrace", tableId: null }),
    ).rejects.toEqual({
      code: "department_transfer.destination_invalid",
      field: "zoneId",
      status: 409,
    });
    await expect(
      api.acceptDepartmentTransfer("request-1", { revision: 7, zoneId: "terrace", tableId: null }),
    ).rejects.toEqual({ code: "working_order.out_of_date", revision: 8, status: 409 });
    await expect(api.listIncomingDepartmentTransfers()).rejects.toEqual({
      code: "department_transfer.not_allowed",
      status: 403,
    });
  });

  it("reloads on authenticated ready and change frames split across network chunks, ignoring keepalive and unknown events", async () => {
    const source = stream();
    const reloads: string[] = [];
    const done = source.api.readDepartmentTransferEvents((event) => reloads.push(event), {
      signal: source.abort.signal,
    });
    source.send(": comment\r\nevent: rea");
    source.send("dy\r\ndata: {}\r\n\r\nevent: keepalive\ndata: {}\n\nevent: change\ndata: {}\n");
    source.send("\nevent: unknown\ndata: {}\n\n");
    await vi.waitFor(() => expect(reloads).toEqual(["ready", "change"]));
    source.end();
    await done;
    expect(source.fetchImpl).toHaveBeenCalledWith(
      "https://primary.test/api/department-transfers/events",
      {
        method: "GET",
        credentials: "include",
        headers: { accept: "text/event-stream" },
        signal: source.abort.signal,
      },
    );
    expect(source.body.locked).toBe(false);
  });

  it("ends a revoked stream before any later reload and releases its reader", async () => {
    const source = stream();
    const reloads: string[] = [];
    const done = source.api.readDepartmentTransferEvents((event) => reloads.push(event), {
      signal: source.abort.signal,
    });
    const rejected = expect(done).rejects.toEqual({ code: "device_profile.not_admitted" });
    source.send(
      'event: ready\ndata: {}\n\nevent: session-invalid\ndata: {"code":"device_profile.not_admitted"}\n\nevent: change\ndata: {}\n\n',
    );
    await rejected;
    expect(reloads).toEqual(["ready"]);
    expect(source.cancelled).toBe(true);
    expect(source.body.locked).toBe(false);
  });

  it.each([401, 403])(
    "ends an initially refused stream (%s) with the domain code",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json({ error: { code: "department_transfer.not_allowed", params: {} } }, status),
        );
      const reloads: string[] = [];
      await expect(
        new TillApi("", fetchImpl).readDepartmentTransferEvents((event) => reloads.push(event)),
      ).rejects.toEqual({ code: "department_transfer.not_allowed", status });
      expect(reloads).toEqual([]);
    },
  );

  it("cancels an idle reader on logout even when a transport ignores fetch's signal", async () => {
    const source = stream();
    const reloads: string[] = [];
    const done = source.api.readDepartmentTransferEvents((event) => reloads.push(event), {
      signal: source.abort.signal,
    });
    source.send("event: ready\ndata: {}\n\n");
    await vi.waitFor(() => expect(reloads).toEqual(["ready"]));
    source.abort.abort();
    await done;
    expect(source.cancelled).toBe(true);
    expect(source.body.locked).toBe(false);
  });
});
