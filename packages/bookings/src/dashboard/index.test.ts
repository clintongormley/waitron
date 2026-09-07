import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { createRequest } from "@waitron/dashboard-kit";
import { BOOKINGS_DASHBOARD } from "./index.js";
import type { BookingsScreen } from "./bookings-screen.js";

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

describe("BOOKINGS_DASHBOARD contribution", () => {
  it("declares the bookings screen's identity, nav placement and permission", () => {
    expect(BOOKINGS_DASHBOARD.module).toBe("bookings");
    expect(BOOKINGS_DASHBOARD.screen).toMatchObject({
      id: "bookings",
      navLabelKey: "nav.bookings",
      group: "service",
      requiresPermission: "booking.manage",
    });
  });

  it("declares its strings in both languages, including the nav label", () => {
    expect(BOOKINGS_DASHBOARD.strings.en["nav.bookings"]).toBe("Bookings");
    expect(BOOKINGS_DASHBOARD.strings.es["nav.bookings"]).toBe("Reservas");
  });

  it("create() renders a screen wired to the context request (it loads through it on connect)", async () => {
    // The rendered screen calls listBookings + listTables on connect — reaching the injected fetch is
    // proof create() handed it a BookingApi built on the module context's request.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => "[]",
    } as Response);
    const handle = BOOKINGS_DASHBOARD.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    render(handle.render(), container);
    const screen = container.querySelector<BookingsScreen>("dashboard-bookings-screen")!;
    await screen.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/tables",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
