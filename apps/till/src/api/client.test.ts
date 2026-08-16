import { describe, expect, it, vi } from "vitest";
import { TillApi, type MyAbsence, type MyShift, type MySwap, type TillProduct } from "./client.js";

/** A stub `fetch` reply: JSON body at the given status, content-type set like the server's. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TillApi", () => {
  it("recordSale POSTs lines+tender+workingOrderId with credentials and returns the ticket payload", async () => {
    const ticket = {
      invoiceNumber: "A/1",
      issuedAt: "2026-08-05T10:00:00.000Z",
      total: "3.00",
      vatBreakdown: [],
      change: "2.00",
      qr: "x",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(ticket));
    const api = new TillApi("", fetchStub);

    const result = await api.recordSale(
      [{ productId: "p", quantity: "2" }],
      { method: "cash", amount: "5.00" },
      "wo1",
    );

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/sales",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        // `workingOrderId` is the idempotency key: keyed on the same order, a lost-response retry
        // replays rather than filing a second chained fiscal record.
        body: JSON.stringify({
          lines: [{ productId: "p", quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
          workingOrderId: "wo1",
        }),
      }),
    );
    expect(result.change).toBe("2.00");
    expect(result.invoiceNumber).toBe("A/1");
  });

  it("pay POSTs id+lines(+tip+allowOffline) to /api/pay and returns the captured outcome with its ticket", async () => {
    const ticket = {
      invoiceNumber: "A/1",
      issuedAt: "2026-08-06T10:00:00.000Z",
      total: "3.00",
      vatBreakdown: [],
      lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
      change: "0.00",
      qr: "x",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ outcome: "captured", ticket }));
    const api = new TillApi("", fetchStub);

    const out = await api.pay({
      id: "wo1",
      lines: [{ productId: "cafe", quantity: "2" }],
      tip: "0.50",
      allowOffline: true,
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/pay",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "wo1",
          lines: [{ productId: "cafe", quantity: "2" }],
          tip: "0.50",
          allowOffline: true,
        }),
      }),
    );
    expect(out).toEqual({ outcome: "captured", ticket });
  });

  it("pay returns a non-captured outcome verbatim, with no ticket (declined — a card terminal has no exceptional/error shape, CLAUDE.md §5)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ outcome: "declined" }));
    const api = new TillApi("", fetchStub);

    const out = await api.pay({ id: "wo1", lines: [] });

    // A no-tip/no-allowOffline call sends only id+lines — JSON.stringify drops the undefined-valued
    // optional fields rather than sending them as explicit nulls.
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/pay",
      expect.objectContaining({
        body: JSON.stringify({ id: "wo1", lines: [] }),
      }),
    );
    expect(out).toEqual({ outcome: "declined" });
  });

  it("throws { code } from a 4xx error body (login with a bad PIN)", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "pin.invalid" } }), { status: 401 }),
      );

    await expect(new TillApi("", fetchStub).login("p", "0000")).rejects.toMatchObject({
      code: "pin.invalid",
    });
  });

  it("falls back to server.internal when the error body carries no code", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}, 500));

    await expect(new TillApi("", fetchStub).getTill()).rejects.toMatchObject({
      code: "server.internal",
    });
  });

  it("login POSTs the credentials and returns the person id", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ personId: "u1" }));
    const api = new TillApi("", fetchStub);

    const r = await api.login("u1", "1234");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: "u1", pin: "1234" }),
      }),
    );
    expect(r.personId).toBe("u1");
  });

  it("getTill GETs the boot info with no request body or content-type", async () => {
    // The boot payload now also carries the authored-or-default `layout` (the widget arrangement) and
    // `receipt` (the non-fiscal trim) — the client passes both through untouched, typed as `TillInfo`,
    // so this literal is a compile-time proof the shape carries them and the `.toEqual` a runtime proof
    // they round-trip.
    const info = {
      locale: "es-ES",
      venueName: "Deli",
      nif: "B12345678",
      orderFlow: "prepay",
      cardProvider: "none",
      tipsEnabled: false,
      layout: [
        { type: "product-grid", region: "main", config: { columns: 4 } },
        { type: "basket", region: "aside", config: {} },
      ],
      receipt: { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" },
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(info));
    const api = new TillApi("", fetchStub);

    const r = await api.getTill();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/till",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    // A read carries neither a body nor a content-type header.
    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(r).toEqual(info);
    // The layout + receipt survive the round-trip typed.
    expect(r.layout[0]).toEqual({ type: "product-grid", region: "main", config: { columns: 4 } });
    expect(r.receipt).toEqual({
      headerSubtitle: "Calle Mayor 1",
      footerMessage: "Gracias por su visita",
    });
  });

  it("listStaff GETs the pre-login roster", async () => {
    const roster = [{ personId: "u1", displayName: "Ana" }];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(roster));

    const r = await new TillApi("", fetchStub).listStaff();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/staff",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(roster);
  });

  it("listProducts GETs the sellable catalogue, carrying each product's allergens", async () => {
    // Typed as `TillProduct[]` so the mock is a COMPILE-TIME proof the client shape carries
    // `allergens` — the EU-14 declaration map keyed by allergen code (menu & allergens, Task 4).
    // Before that field was added to `TillProduct` this literal failed `tsc` with an excess-property
    // error; the runtime `.toEqual` then proves the client passes the map through the JSON body
    // untouched. One product carries a declaration (both presences plus the optional `source`
    // specificity), a second is unreviewed (`null`), so both shapes round-trip.
    const products: TillProduct[] = [
      {
        id: "p",
        descriptions: { "es-ES": "Café" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        category: null,
        allergens: {
          milk: { presence: "contains" },
          nuts: { presence: "may_contain", source: "almendra" },
        },
      },
      {
        id: "q",
        descriptions: { "es-ES": "Agua mineral" },
        pricingUnit: "each",
        unitPrice: "1.20",
        vatClass: "general",
        category: "Bebidas",
        allergens: null,
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(products));

    const r = await new TillApi("", fetchStub).listProducts();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(products);
    // The allergen map survives the round-trip typed — read a declaration off the returned product.
    expect(r[0]!.allergens).toEqual({
      milk: { presence: "contains" },
      nuts: { presence: "may_contain", source: "almendra" },
    });
    expect(r[1]!.allergens).toBeNull();
  });

  it("logout DELETEs the session", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));

    await new TillApi("", fetchStub).logout();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("prefixes every path with the configured baseUrl", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ locale: "es-ES", venueName: "D", nif: "N", orderFlow: "prepay" }),
      );

    await new TillApi("https://till.example", fetchStub).getTill();

    expect(fetchStub).toHaveBeenCalledWith(
      "https://till.example/api/till",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("defaults baseUrl to '' and fetchImpl to the global fetch", () => {
    // Exercises the constructor's default parameter initializers with no network call.
    expect(() => new TillApi()).not.toThrow();
  });

  it("parkOrder POSTs the client-minted id, lines and label, returning the persisted number", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ id: "wo1", orderNumber: 7 }));
    const api = new TillApi("", fetchStub);

    const r = await api.parkOrder({
      id: "wo1",
      lines: [{ productId: "cafe", quantity: "2" }],
      label: "Mesa 4",
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "wo1",
          lines: [{ productId: "cafe", quantity: "2" }],
          label: "Mesa 4",
        }),
      }),
    );
    expect(r).toEqual({ id: "wo1", orderNumber: 7 });
  });

  it("listWorkingOrders GETs the cross-till held list and returns the summaries", async () => {
    const summaries = [
      {
        id: "wo1",
        orderNumber: 7,
        label: "Mesa 4",
        itemCount: 2,
        total: "3.00",
        openedAt: "2026-08-06T10:00:00.000Z",
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(summaries));

    const r = await new TillApi("", fetchStub).listWorkingOrders();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(summaries);
  });

  it("retrieveWorkingOrder GETs the addressed order and returns its label + rebuild lines", async () => {
    // The server sends `quantity` at numeric(_,3) scale ("2.000"); the client passes it through as
    // sent — the basket-display normalisation is a later task's concern, not the client's.
    const order = {
      id: "wo1",
      orderNumber: 7,
      label: "Mesa 4",
      lines: [{ productId: "cafe", quantity: "2.000" }],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(order));

    const r = await new TillApi("", fetchStub).retrieveWorkingOrder("wo1");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(order);
  });

  it("updateWorkingOrder PUTs the whole new basket to the addressed order (empty 200 body)", async () => {
    // The server answers PUT with an EMPTY 200 body (`c.body(null, 200)`), so the client must
    // resolve void without trying to JSON-parse nothing.
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const api = new TillApi("", fetchStub);

    await expect(
      api.updateWorkingOrder("wo1", {
        lines: [{ productId: "cafe", quantity: "3" }],
        label: "Mesa 5",
      }),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [{ productId: "cafe", quantity: "3" }],
          label: "Mesa 5",
        }),
      }),
    );
  });

  it("abandonWorkingOrder DELETEs the addressed order (empty 200 body, no request body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const api = new TillApi("", fetchStub);

    await expect(api.abandonWorkingOrder("wo1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
    // A discard carries neither a body nor a content-type header.
    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("surfaces the server's { code } when a working-order request 4xxs (retrieve of a closed order)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "working_order.not_found" } }), {
        status: 404,
      }),
    );

    await expect(new TillApi("", fetchStub).retrieveWorkingOrder("gone")).rejects.toMatchObject({
      code: "working_order.not_found",
    });
  });

  it("placeOrder POSTs to the addressed order's /place route with no body, returning the result", async () => {
    const result = {
      id: "wo1",
      status: "placed",
      invoiceNumber: "A/1",
      issuedAt: "2026-08-06T10:00:00.000Z",
      total: "1.50",
      qr: "x",
      vatBreakdown: [{ rate: "21", base: "1.24", tax: "0.26" }],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(result));

    const r = await new TillApi("", fetchStub).placeOrder("wo1");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/place",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    // A no-body POST carries neither a request body nor a content-type header.
    const init = fetchStub.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(r).toEqual(result);
  });

  it("placeOrder surfaces { code } for a non-open order", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "working_order.not_open" } }), {
        status: 409,
      }),
    );

    await expect(new TillApi("", fetchStub).placeOrder("wo1")).rejects.toMatchObject({
      code: "working_order.not_open",
    });
  });

  it("collectOrder POSTs the tender to the addressed order's /collect route, returning the ticket", async () => {
    const ticket = {
      invoiceNumber: "A/1",
      issuedAt: "2026-08-06T10:00:00.000Z",
      total: "1.50",
      vatBreakdown: [],
      change: "0.00",
      qr: "x",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(ticket));

    const r = await new TillApi("", fetchStub).collectOrder("wo1", {
      method: "cash",
      amount: "1.50",
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/collect",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tender: { method: "cash", amount: "1.50" } }),
      }),
    );
    expect(r).toEqual(ticket);
  });

  it("advancePrep POSTs { to } to the addressed order's /prep route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      new TillApi("", fetchStub).advancePrep("wo1", "preparing"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/prep",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "preparing" }),
      }),
    );
  });

  it("advancePrep surfaces { code } for an illegal transition", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "order_prep.invalid_transition" } }), {
        status: 409,
      }),
    );

    await expect(new TillApi("", fetchStub).advancePrep("wo1", "ready")).rejects.toMatchObject({
      code: "order_prep.invalid_transition",
    });
  });

  it("sendToPrep POSTs an empty object (no `to`) to the addressed order's /prep route", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).sendToPrep("wo1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/prep",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("cancelOrder POSTs the reason to the addressed order's /cancel route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      new TillApi("", fetchStub).cancelOrder("wo1", "Cliente cambió de idea"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/cancel",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Cliente cambió de idea" }),
      }),
    );
  });

  it("cancelOrder surfaces { code } for a blank reason", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "working_order.reason_required" } }), {
        status: 400,
      }),
    );

    await expect(new TillApi("", fetchStub).cancelOrder("wo1", "")).rejects.toMatchObject({
      code: "working_order.reason_required",
    });
  });

  it("listPrepQueue GETs the node-scoped prep queue", async () => {
    const queue = [
      {
        id: "wo1",
        orderNumber: 7,
        label: "Mesa 4",
        state: "queued",
        queuedAt: "2026-08-06T10:00:00.000Z",
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(queue));

    const r = await new TillApi("", fetchStub).listPrepQueue();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/prep-queue",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(queue);
  });

  it("listMyShifts GETs the schedule shifts window and returns the rows", async () => {
    // Typed `MyShift[]` so the mock is a compile-time proof the client shape carries every field the
    // server sends (offsets, role, rosterVersionId).
    const shifts: MyShift[] = [
      {
        id: "s1",
        locationId: "loc1",
        startsAt: "2026-05-04T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-05-04T17:00:00Z",
        endsOffsetMinutes: 0,
        role: "bar",
        rosterVersionId: null,
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(shifts));

    const r = await new TillApi("", fetchStub).listMyShifts("2026-05-04", "2026-05-11");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/schedule/shifts?from=2026-05-04&to=2026-05-11",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(shifts);
  });

  it("listMySwaps GETs the schedule swaps and returns the rows (with direction + status)", async () => {
    const swaps: MySwap[] = [
      {
        id: "sw1",
        requestedByPersonId: "other",
        fromShiftId: "s1",
        toPersonId: "me",
        toShiftId: null,
        status: "requested",
        createdAt: "2026-05-04T10:00:00Z",
        direction: "offered_to_me",
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(swaps));

    const r = await new TillApi("", fetchStub).listMySwaps();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/schedule/swaps",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(swaps);
  });

  it("requestSwap POSTs the offer and returns { swapId }", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ swapId: "sw1" }, 201));
    const api = new TillApi("", fetchStub);

    const r = await api.requestSwap({ fromShiftId: "s1", toPersonId: "col", toShiftId: null });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/schedule/swaps",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromShiftId: "s1", toPersonId: "col", toShiftId: null }),
      }),
    );
    expect(r).toEqual({ swapId: "sw1" });
  });

  it("requestSwap surfaces { code } for a shift the requester does not own", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "swap.not_permitted" } }), { status: 403 }),
    );

    await expect(
      new TillApi("", fetchStub).requestSwap({
        fromShiftId: "s1",
        toPersonId: "col",
        toShiftId: null,
      }),
    ).rejects.toMatchObject({ code: "swap.not_permitted" });
  });

  it("acceptSwap POSTs to the addressed swap's /accept route (empty 204 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(new TillApi("", fetchStub).acceptSwap("sw1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/schedule/swaps/sw1/accept",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    // A no-body POST carries neither a request body nor a content-type header.
    const init = fetchStub.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("listMyAbsences GETs the schedule absences and returns the rows", async () => {
    const absences: MyAbsence[] = [
      {
        id: "a1",
        personId: "me",
        kind: "holiday",
        startsOn: "2026-06-01",
        endsOn: "2026-06-03",
        status: "requested",
        note: null,
        createdAt: "2026-05-04T10:00:00Z",
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(absences));

    const r = await new TillApi("", fetchStub).listMyAbsences();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/schedule/absences",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(absences);
  });

  it("requestAbsence POSTs the request and returns { absenceId }", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ absenceId: "a1" }, 201));
    const api = new TillApi("", fetchStub);

    const r = await api.requestAbsence({
      kind: "holiday",
      startsOn: "2026-07-01",
      endsOn: "2026-07-05",
      note: "Vacaciones",
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/schedule/absences",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "holiday",
          startsOn: "2026-07-01",
          endsOn: "2026-07-05",
          note: "Vacaciones",
        }),
      }),
    );
    expect(r).toEqual({ absenceId: "a1" });
  });

  it("requestAbsence surfaces { code } on an overlapping range", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "absence.overlaps" } }), { status: 409 }),
    );

    await expect(
      new TillApi("", fetchStub).requestAbsence({
        kind: "leave",
        startsOn: "2026-08-12",
        endsOn: "2026-08-18",
        note: null,
      }),
    ).rejects.toMatchObject({ code: "absence.overlaps" });
  });
});
