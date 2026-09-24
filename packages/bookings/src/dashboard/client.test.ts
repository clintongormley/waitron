import { describe, expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { BookingApi } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/** An empty 204, the shape the void-returning routes answer with. */
function emptyResponse(): Response {
  return { ok: true, status: 204, json: async () => undefined, text: async () => "" } as Response;
}

const api = (fetchImpl: typeof fetch) => new BookingApi(createRequest({ fetchImpl }));

describe("BookingApi — bookings", () => {
  const booking = {
    id: "bk-1",
    bookingDate: "2026-08-20",
    bookingTime: "20:00:00",
    partySize: 4,
    contactName: "García",
    contactPhone: null,
    notes: null,
    tableId: null,
    tabId: null,
    status: "booked",
    createdBy: "p1",
    createdAt: "2026-08-19T10:00:00.000Z",
  };

  it("listBookings GETs the day's collection with the date query and credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([booking]));
    expect(await api(fetchImpl as unknown as typeof fetch).listBookings("2026-08-20")).toEqual([
      booking,
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings?date=2026-08-20", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createBooking POSTs the plain local date+time (NOT a UTC instant) and returns { id } (201)", async () => {
    const input = {
      bookingDate: "2026-08-20",
      bookingTime: "20:00",
      partySize: 4,
      contactName: "García",
      contactPhone: null,
      notes: null,
      tableId: null,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "bk-1" }, true, 201));
    expect(await api(fetchImpl as unknown as typeof fetch).createBooking(input)).toEqual({
      id: "bk-1",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const sentBody = fetchImpl.mock.calls[0]![1].body as string;
    expect(sentBody).not.toContain("T20:00");
    expect(sentBody).not.toContain("Z");
  });

  it("updateBooking PATCHes the patch and resolves undefined on a 204", async () => {
    const patch = { partySize: 6, contactName: "García Pérez" };
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await expect(
      api(fetchImpl as unknown as typeof fetch).updateBooking("bk-1", patch),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  });

  it("seatBooking POSTs the optional table and returns { tabId }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tabId: "tab-9" }));
    expect(
      await api(fetchImpl as unknown as typeof fetch).seatBooking("bk-1", { tableId: "t-1" }),
    ).toEqual({ tabId: "tab-9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/seat", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableId: "t-1" }),
    });
  });

  it("seatBooking POSTs an empty body when no table is passed (reuse the booking's own table)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tabId: "tab-9" }));
    expect(await api(fetchImpl as unknown as typeof fetch).seatBooking("bk-1")).toEqual({
      tabId: "tab-9",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/seat", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("cancelBooking POSTs .../cancel and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await expect(
      api(fetchImpl as unknown as typeof fetch).cancelBooking("bk-1"),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/cancel", {
      method: "POST",
      credentials: "include",
    });
  });

  it("markNoShow POSTs .../no-show and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await expect(
      api(fetchImpl as unknown as typeof fetch).markNoShow("bk-1"),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/no-show", {
      method: "POST",
      credentials: "include",
    });
  });

  it("completeBooking POSTs .../complete and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    await expect(
      api(fetchImpl as unknown as typeof fetch).completeBooking("bk-1"),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/complete", {
      method: "POST",
      credentials: "include",
    });
  });

  it("rejects with the envelope code when the table is busy (tab.already_open)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "tab.already_open" } }, false, 409));
    await expect(
      api(fetchImpl as unknown as typeof fetch).seatBooking("bk-1", { tableId: "t-1" }),
    ).rejects.toMatchObject({
      code: "tab.already_open",
    });
  });
});

// listTables is core's read, not a booking route: the screen needs it for the table picker.
describe("BookingApi — listTables", () => {
  it("listTables GETs /management-api/tables with credentials", async () => {
    const rows = [
      {
        id: "t1",
        label: "4",
        zoneId: "z1",
        capacity: 2,
        active: true,
        createdAt: "2026-08-17T00:00:00Z",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    expect(await api(fetchImpl as unknown as typeof fetch).listTables()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables", {
      method: "GET",
      credentials: "include",
    });
  });
});

// `background` is the copy live refreshes read through: its GETs are passive, so an automatic poll
// does not count as session activity. The primitive marks a passive GET `x-waitron-live: 1`.
describe("BookingApi — background", () => {
  it("marks the background copy's GETs passive and leaves the original's GETs active", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse([]));
    const liveData = {} as NonNullable<BookingApi["liveData"]>;
    const foreground = new BookingApi(
      createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    );
    const background = foreground.background;

    await background.listBookings("2026-08-20");
    await background.listTables();
    await foreground.listBookings("2026-08-20");
    await foreground.listTables();

    const calls = fetchImpl.mock.calls as [string, RequestInit][];
    expect(calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/management-api/bookings?date=2026-08-20", "GET"],
      ["/management-api/tables", "GET"],
      ["/management-api/bookings?date=2026-08-20", "GET"],
      ["/management-api/tables", "GET"],
    ]);
    for (const [, init] of calls.slice(0, 2)) {
      expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
    }
    // The original's GETs carry no headers at all — the exact init the wire-pin cases above expect.
    expect(fetchImpl).toHaveBeenNthCalledWith(3, "/management-api/bookings?date=2026-08-20", {
      method: "GET",
      credentials: "include",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(4, "/management-api/tables", {
      method: "GET",
      credentials: "include",
    });
    // The copy carries the same live-data source.
    expect(background.liveData).toBe(liveData);
    expect(background).not.toBe(foreground);
  });
});
