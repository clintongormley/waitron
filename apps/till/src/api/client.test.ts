import { describe, expect, it, vi } from "vitest";
import { TillApi } from "./client.js";

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
    const info = { locale: "es-ES", venueName: "Deli", nif: "B12345678", orderFlow: "prepay" };
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

  it("listProducts GETs the sellable catalogue", async () => {
    const products = [
      {
        id: "p",
        descriptions: { "es-ES": "Café" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        category: null,
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(products));

    const r = await new TillApi("", fetchStub).listProducts();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(products);
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
});
