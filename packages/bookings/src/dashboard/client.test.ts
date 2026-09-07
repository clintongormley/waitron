import { describe, expect, it, vi } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { BookingApi } from "./client.js";

// Wire-pin suite: the exact URLs, methods and bodies the booking routes are called with. Moved
// byte-identical from apps/dashboard/src/api/client.test.ts — the proof the wire did not move when the
// methods came across onto BookingApi. `new DashboardApi("", stub)` became
// `new BookingApi(createRequest({ fetchImpl: stub }))`; every assertion below is unchanged.

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/** An empty 204 — `text()` → "" — the shape the void-returning routes answer with. Exercises the
 * request primitive's empty-body branch, which resolves `undefined` instead of `JSON.parse`-ing
 * nothing. */
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
    // Load-bearing (anti-#52): the body carries a plain `YYYY-MM-DD` + `HH:MM`, never a `…Z` instant.
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

// listTables is the core /management-api/tables read (NOT one of the seven booking routes), carried on
// BookingApi because the screen calls it on connect to populate the form's table picker + seat prompt.
// This wire-pin case is COPIED from the app's floor-plan suite (client.test.ts:1279) — the app keeps its
// own copy, since floor-screen.ts still uses DashboardApi.listTables.
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
