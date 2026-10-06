import { describe, expect, it, vi } from "vitest";
import {
  TillApi,
  isNetworkFailure,
  menuOfferToTillProduct,
  type AllocationPreview,
  type BillBalance,
  type BillPaymentAsk,
  type BillPaymentRequest,
  type BillPaymentResult,
  type BillPaymentView,
  type BillRefundRequest,
  type BillRefundResult,
  type FloorZone,
  type MyAbsence,
  type MyShift,
  type MySwap,
  type ProductCatalogue,
  type KitchenNotice,
  type TabLine,
  type TableServiceStatus,
  type TableState,
  type TillMenuOffer,
  type UnpaidDepartureRequest,
  type UnpaidDepartureResult,
} from "./client.js";

/** A stub `fetch` reply: JSON body at the given status, content-type set like the server's. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TillApi", () => {
  it("reads a filed F1 ticket with GET and returns its recorded recipient and amounts", async () => {
    const ticket = {
      invoiceType: "F1",
      invoiceNumber: "FF/7",
      locale: "es-ES",
      issuedAt: "2026-10-05T13:00:00.000Z",
      issuer: { venueName: "Deli SL", nif: "B12345674", domicile: "Calle Mayor 1, Madrid" },
      recipient: {
        legalName: "Cliente SL",
        taxId: "B87654321",
        countryCode: "ES",
        address: "Calle Mayor 2, Madrid",
      },
      orderLabel: null,
      orderNumber: 7,
      total: "12.10",
      vatBreakdown: [{ rate: "21.00", base: "10.00", tax: "2.10" }],
      lines: [],
      tender: { method: "cash", change: "7.90" },
      qr: "https://example.test/verify/7",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(ticket));
    expect(await new TillApi("", fetchStub).getFiledTicket("order-7")).toEqual(ticket);
    expect(fetchStub).toHaveBeenCalledWith("/api/sales/order-7", {
      method: "GET",
      credentials: "include",
    });
  });

  it.each([
    [404, "working_order.not_found"],
    [401, "session.required"],
  ])("preserves a filed-ticket read refusal (%s)", async (status, code) => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code, params: {} } }, status));
    await expect(new TillApi("", fetchStub).getFiledTicket("order-7")).rejects.toMatchObject({
      code,
      status,
    });
  });

  it("confirms customer handover through an authenticated POST and returns the recorded staff stamp", async () => {
    const status = {
      status: "done",
      jobId: "job-1",
      canRetry: false,
      handover: { personId: "staff-1", confirmedAt: "2026-10-05T13:00:00.000Z" },
    };
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(status)));
    const api = new TillApi("", fetchStub);
    expect(await api.confirmReceiptHandover("order-1")).toEqual(status);
    expect(fetchStub).toHaveBeenCalledWith("/api/sales/order-1/receipt/handover", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(await api.getReceiptPrintStatus("order-1")).toEqual(status);
  });

  it.each([
    [409, "receipt.not_printed"],
    [401, "session.expired"],
  ])("preserves a handover refusal (%s)", async (status, code) => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code, params: {} } }, status));
    await expect(
      new TillApi("", fetchStub).confirmReceiptHandover("order-1"),
    ).rejects.toMatchObject({ code, status });
  });

  it("sends an invoice choice under the working order revision", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 4 }));
    const api = new TillApi("", fetchStub);
    const choice = {
      revision: 3,
      invoiceType: "F1" as const,
      recipient: {
        taxId: "B12345674",
        legalName: "Cliente SL",
        address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        countryCode: "ES",
      },
    };

    expect(await api.setOrderInvoiceChoice("order-1", choice)).toEqual({ revision: 4 });
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/order-1/invoice-choice",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(choice),
      }),
    );
  });

  it("reports made-here items from a successful answer and ignores an answer without them", async () => {
    const item = {
      lineId: "line-1",
      name: "Lager",
      quantity: "2",
      unitName: null,
      soldInEach: true,
      optionSnapshots: [],
      extras: [],
      note: null,
    };
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ madeHere: [item] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const api = new TillApi("", fetchStub);
    const received = vi.fn();
    api.onMadeHere(received);
    await api.getTill();
    await api.getTill();
    expect(received).toHaveBeenCalledExactlyOnceWith([item]);
  });

  it("recordSale POSTs lines+tender+workingOrderId with credentials and returns the ticket payload", async () => {
    const ticket = {
      orderLabel: null,
      orderNumber: 1,
      invoiceNumber: "A/1",
      issuedAt: "2026-08-05T10:00:00.000Z",
      total: "3.00",
      vatBreakdown: [],
      tender: { method: "cash", change: "2.00" },
      qr: "x",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(ticket));
    const api = new TillApi("", fetchStub);

    const result = await api.recordSale(
      [{ menuItemId: "mi-p", quantity: "2" }],
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
          lines: [{ menuItemId: "mi-p", quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
          workingOrderId: "wo1",
        }),
      }),
    );
    expect(result.tender).toEqual({ method: "cash", change: "2.00" });
    expect(result.invoiceNumber).toBe("A/1");
  });

  it("sends a walk-up full-invoice request with its recipient in the first cash request", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ invoiceNumber: "FF/1" }));
    const api = new TillApi("", fetchStub);
    const recipient = {
      taxId: "B12345674",
      legalName: "Cliente SL",
      address: "Calle Mayor 2, 28013 Madrid",
      countryCode: "ES",
    };

    await api.recordSale(
      [{ menuItemId: "mi-cafe", quantity: "2" }],
      { method: "cash", amount: "5.00" },
      "wo1",
      undefined,
      { invoiceType: "F1", recipient },
    );

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/sales",
      expect.objectContaining({
        body: JSON.stringify({
          lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
          workingOrderId: "wo1",
          invoiceType: "F1",
          recipient,
        }),
      }),
    );
  });

  it("pay POSTs id+lines(+tip+allowOffline) to /api/pay and returns the captured outcome with its ticket", async () => {
    const ticket = {
      orderLabel: null,
      orderNumber: 1,
      invoiceNumber: "A/1",
      issuedAt: "2026-08-06T10:00:00.000Z",
      total: "3.00",
      vatBreakdown: [],
      lines: [{ descriptions: { "es-ES": "Café" }, quantity: "2", gross: "3.00" }],
      tender: { method: "cash", change: "0.00" },
      qr: "x",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ outcome: "captured", ticket }));
    const api = new TillApi("", fetchStub);

    const out = await api.pay({
      id: "wo1",
      lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
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
          lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
          tip: "0.50",
          allowOffline: true,
        }),
      }),
    );
    expect(out).toEqual({ outcome: "captured", ticket });
  });

  it("sends a walk-up full-invoice request with its recipient in the first card request", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ outcome: "declined" }));
    const recipient = {
      taxId: "B12345674",
      legalName: "Cliente SL",
      address: "Calle Mayor 2, 28013 Madrid",
      countryCode: "ES",
    };

    await new TillApi("", fetchStub).pay({
      id: "wo-card",
      lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
      invoiceType: "F1",
      recipient,
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/pay",
      expect.objectContaining({
        body: JSON.stringify({
          id: "wo-card",
          lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
          invoiceType: "F1",
          recipient,
        }),
      }),
    );
  });

  it("cancels a pending pretend reader payment for the current order", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ cancelled: true }));
    const api = new TillApi("", fetchStub);

    expect(await api.cancelDemoReaderPayment("order-1", "attempt-1")).toBe(true);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/demo-reader/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workingOrderId: "order-1", attemptId: "attempt-1" }),
      }),
    );
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

  it("surfaces the error body's params alongside the code (pin.throttled retryAfterSeconds)", async () => {
    // The lock screen's countdown reads `retryAfterSeconds` off the thrown object.
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "pin.throttled", params: { retryAfterSeconds: 5 } } }),
          { status: 429 },
        ),
      );

    await expect(new TillApi("", fetchStub).login("p", "0000")).rejects.toMatchObject({
      code: "pin.throttled",
      retryAfterSeconds: 5,
    });
  });

  it("keeps the validated code and status even when the body's params carry their own", async () => {
    // A server (buggy or hostile) that puts `code`/`status` keys inside `params` must NOT override
    // either — the lock screen branches on `code`.
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "pin.throttled",
            params: { code: null, status: 999, retryAfterSeconds: 5 },
          },
        }),
        { status: 429 },
      ),
    );

    await expect(new TillApi("", fetchStub).login("p", "0000")).rejects.toMatchObject({
      code: "pin.throttled",
      status: 429,
      retryAfterSeconds: 5,
    });
  });

  it("falls back to server.internal when the error body carries no code", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}, 500));

    await expect(new TillApi("", fetchStub).getTill()).rejects.toMatchObject({
      code: "server.internal",
    });
  });

  it("falls back to server.internal (not a parse error) when the error body is not JSON", async () => {
    // Left unguarded, the SyntaxError `res.json()` throws would reach the caller as a fake network
    // failure.
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response("Bad Gateway", { status: 502, headers: { "content-type": "text/plain" } }),
      );

    await expect(new TillApi("", fetchStub).getTill()).rejects.toMatchObject({
      code: "server.internal",
      status: 502,
    });
  });

  it("falls back to server.internal when the error body is the literal JSON null", async () => {
    // `null` parses cleanly, so a bare try/catch never runs and reading `.error` off it would throw a
    // TypeError.
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(null, 500));

    await expect(new TillApi("", fetchStub).getTill()).rejects.toMatchObject({
      code: "server.internal",
      status: 500,
    });
  });

  it("login POSTs the credentials and returns the person id + their permissions", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ personId: "u1", permissions: ["venue.configure"] }));
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
    expect(r.permissions).toEqual(["venue.configure"]);
  });

  it("getTill GETs the boot info with no request body or content-type", async () => {
    const info = {
      locale: "es-ES",
      venueName: "Deli",
      nif: "B12345678",
      orderFlow: "prepay",
      receiptPrintMode: "on_request",
      bumpMode: "line",
      fireControl: "waiter",
      cardProvider: "none",
      tipsEnabled: false,
      canvas: {
        formFactor: "till",
        tabs: [
          {
            key: "counter",
            title: "Counter",
            columns: 12,
            cards: [{ type: "product-grid", colSpan: 8, rowSpan: 6, config: { columns: 4 } }],
          },
        ],
      },
      capabilities: [],
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
    // The canvas + receipt survive the round-trip typed.
    expect(r.canvas.tabs[0].key).toBe("counter");
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

  it("openDrawer POSTs an empty body to /api/drawer/open when no override is given", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await new TillApi("", fetchStub).openDrawer();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/drawer/open",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("openDrawer POSTs { override } carrying the supervisor's personId + PIN when one is given", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await new TillApi("", fetchStub).openDrawer({ personId: "sup-1", pin: "4321" });

    // The PIN travels ONLY in this authenticated request body — never in the URL or a query string.
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/drawer/open");
    expect(url).not.toContain("4321");
    expect(init.body).toBe(JSON.stringify({ override: { personId: "sup-1", pin: "4321" } }));
  });

  it("listDrawerAuthorizers GETs the eligible supervisors from /api/drawer/authorizers", async () => {
    const roster = [{ personId: "sup-1", displayName: "Responsable" }];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(roster));

    const r = await new TillApi("", fetchStub).listDrawerAuthorizers();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/drawer/authorizers",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(roster);
  });

  it("listRefundAuthorizers GETs who may approve a bill refund from /api/refund-authorizers", async () => {
    const roster = [{ personId: "sup-1", displayName: "Responsable" }];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(roster));

    const r = await new TillApi("", fetchStub).listRefundAuthorizers();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/refund-authorizers",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(roster);
  });

  it("listProducts GETs the location's menus + products, carrying each product's allergens and menu tag", async () => {
    // Typed as `ProductCatalogue` so `tsc` checks the client shape carries `menus`, `allergens` and
    // `catalogueId`. One product carries a declaration (both presences plus the optional `source`), the
    // other is unreviewed (`null`).
    const payload: ProductCatalogue = {
      menus: [
        { id: "cat-food", name: "Comida", isDefault: true },
        { id: "cat-drinks", name: "Bebidas", isDefault: false },
      ],
      products: [
        {
          id: "p",
          name: "Café",
          customerName: { es: "Café para el cliente" },
          pricingUnit: "each",
          unitPrice: "1.50",
          vatClass: "general",
          category: null,
          allergens: {
            milk: { presence: "contains" },
            nuts: { presence: "may_contain", source: "almendra" },
          },
          catalogueId: "cat-drinks",
          catalogueName: "Bebidas",
        },
        {
          id: "q",
          name: "Agua mineral",
          customerName: { es: "Agua mineral para el cliente" },
          pricingUnit: "each",
          unitPrice: "1.20",
          vatClass: "general",
          category: "Bebidas",
          allergens: null,
          catalogueId: "cat-drinks",
          catalogueName: "Bebidas",
        },
      ],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(payload));

    const r = await new TillApi("", fetchStub).listProducts();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(payload);
    // The menus half round-trips (default-flagged) for the switcher.
    expect(r.menus).toEqual(payload.menus);
    // The allergen map survives the round-trip typed — read a declaration off the returned product.
    expect(r.products[0]!.allergens).toEqual({
      milk: { presence: "contains" },
      nuts: { presence: "may_contain", source: "almendra" },
    });
    expect(r.products[1]!.allergens).toBeNull();
  });

  it("listZoneOffers GETs menu-item identities for the selected service zone, cancellably", async () => {
    const payload = {
      context: { zoneId: "zone-upstairs", departmentId: "restaurant", serviceMode: "table_tab" },
      defaultMenuId: "drinks",
      menus: [{ id: "drinks", name: "Drinks", isDefault: true }],
      offers: [
        {
          id: "upstairs-negroni",
          menuId: "drinks",
          productId: "negroni",
          grossPrice: "11.00",
          active: true,
          menuName: "Drinks",
          placements: [[]],
          descriptions: { en: "Negroni" },
          pricingUnit: "each" as const,
          vatClass: "general" as const,
          category: "Cocktails",
        },
      ],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(payload));
    const read = new AbortController();

    await expect(
      new TillApi("", fetchStub).listZoneOffers("zone-upstairs", { signal: read.signal }),
    ).resolves.toEqual(payload);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/service-zones/zone-upstairs/offers",
      expect.objectContaining({ method: "GET", credentials: "include", signal: read.signal }),
    );
  });

  it("menuState GETs the zone's live versions and what they hold that cannot be sold, cancellably", async () => {
    const payload = {
      menus: [{ menuId: "lunch", versionId: "version-2" }],
      unavailable: {
        products: ["burger", "bacon"],
        optionLabels: ["label-rare"],
      },
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(payload));
    const read = new AbortController();

    await expect(
      new TillApi("", fetchStub).menuState("zone upstairs", { signal: read.signal }),
    ).resolves.toEqual(payload);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/menu-state?zoneId=zone%20upstairs",
      expect.objectContaining({ method: "GET", credentials: "include", signal: read.signal }),
    );
  });

  it("listDefaultZoneOffers resolves the configured counter zone", async () => {
    const payload = {
      context: { zoneId: "counter", departmentId: "deli", serviceMode: "prepay" as const },
      defaultMenuId: "takeaway",
      menus: [{ id: "takeaway", name: "Takeaway", isDefault: true }],
      offers: [],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(payload));

    await expect(new TillApi("", fetchStub).listDefaultZoneOffers()).resolves.toEqual(payload);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/default-service-zone/offers",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("uses the accepted service zone for a subsequent order", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          context: { zoneId: "counter", departmentId: "deli", serviceMode: "prepay" },
          defaultMenuId: "takeaway",
          menus: [],
          offers: [],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "wo-1", orderNumber: 4 }));
    const api = new TillApi("", fetchStub);
    await api.listDefaultZoneOffers();
    api.setServiceZone("counter");

    await api.parkOrder({ id: "wo-1", lines: [{ menuItemId: "ham", quantity: "1" }] });

    expect(JSON.parse(fetchStub.mock.calls[1]![1]!.body as string)).toEqual({
      id: "wo-1",
      lines: [{ menuItemId: "ham", quantity: "1" }],
      zoneId: "counter",
    });
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
      lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
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
          lines: [{ menuItemId: "mi-cafe", quantity: "2" }],
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
    // The server sends `quantity` as a three-place decimal string ("2.000"); the client passes it
    // through as sent.
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

  it("updateWorkingOrder PUTs the whole new basket to the addressed order and resolves the revision the server answers", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ revision: 4 }), { status: 200 }));
    const api = new TillApi("", fetchStub);

    await expect(
      api.updateWorkingOrder("wo1", {
        lines: [{ menuItemId: "mi-cafe", quantity: "3" }],
        label: "Mesa 5",
        revision: 4,
      }),
    ).resolves.toEqual({ revision: 4 });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [{ menuItemId: "mi-cafe", quantity: "3" }],
          label: "Mesa 5",
          revision: 4,
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
    const result = { id: "wo1", status: "placed" };
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
      tender: { method: "cash", change: "0.00" },
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

  it("listStations GETs the venue's active kitchen stations", async () => {
    const stations = [
      { id: "st-1", name: "Cocina", displayOrder: 0, isDefault: true, active: true, open: true },
      { id: "st-2", name: "Barra", displayOrder: 1, isDefault: false, active: true, open: false },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(stations));

    const r = await new TillApi("", fetchStub).listStations();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/stations",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(stations);
  });

  it("posts a dish station move and returns the moved lines", async () => {
    const body = { submissionId: "sub-1", lineIds: ["line-1"], stationId: "station-2" };
    const result = {
      revision: 4,
      stationId: "station-2",
      moved: [{ workingOrderLineId: "line-1", fromStationId: "station-1" }],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(result));
    const answer = await new TillApi("", fetchStub).moveDishStation("order-1", body);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/order-1/lines/move-station",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify(body),
      }),
    );
    expect(answer).toEqual(result);
  });

  it("getStationQueue GETs one station's queue grouped by order", async () => {
    const groups = [
      {
        orderId: "wo-1",
        orderNumber: 7,
        label: "Mesa 4",
        queuedAt: "2026-08-17T10:00:00.000Z",
        items: [
          {
            id: "ti-1",
            workingOrderLineId: "wol-1",
            state: "queued",
            descriptions: { "es-ES": "Paella" },
            quantity: "2.000",
          },
          {
            id: "ti-2",
            workingOrderLineId: "wol-2",
            state: "preparing",
            descriptions: { "es-ES": "Agua" },
            quantity: "1.000",
          },
        ],
      },
    ];
    const notices: KitchenNotice[] = [
      {
        id: "kn-1",
        stationId: "st-1",
        workingOrderId: "wo-1",
        orderLabel: "Mesa 4",
        kind: "void",
        lineName: "Paella kitchen",
        unitName: null,
        soldInEach: false,
        quantity: "1",
        note: "sin gambas",
        wasStarted: true,
        movedTo: null,
        reroutedTo: null,
        direction: null,
        cancelledExtra: null,
        createdAt: "2026-08-17T10:05:00.000Z",
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ items: groups, notices }));

    const r = await new TillApi("", fetchStub).getStationQueue("st-1");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/stations/st-1/queue",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual({ items: groups, notices });
  });

  it("retrieveWorkingOrder and getTabLines hand a caller's abort signal to fetch", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const api = new TillApi("", fetchStub);
    const signal = new AbortController().signal;

    await api.retrieveWorkingOrder("wo-1", { signal });
    await api.getTabLines("wo-1", { signal });

    expect(fetchStub.mock.calls.map(([url, init]) => [url, init?.signal])).toEqual([
      ["/api/working-orders/wo-1", signal],
      ["/api/working-orders/wo-1/lines", signal],
    ]);
  });

  it("getStationQueue and getDeviceStation hand a caller's abort signal to fetch", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => jsonResponse({ items: [], notices: [] }));
    const api = new TillApi("", fetchStub);
    const signal = new AbortController().signal;

    await api.getStationQueue("st-1", { signal });
    await api.getDeviceStation({ signal });

    expect(fetchStub.mock.calls.map(([, init]) => init?.signal)).toEqual([signal, signal]);
  });

  it("an aborted read rejects with fetch's own abort error, which reads as no answer", async () => {
    const fetchStub = vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)),
        ),
    );
    const controller = new AbortController();
    const read = new TillApi("", fetchStub as unknown as typeof fetch).getStationQueue("st-1", {
      signal: controller.signal,
    });
    controller.abort();
    const error = await read.catch((caught: unknown) => caught);
    // The client passes the abort through untouched rather than mapping it to a `{ code }`.
    expect(error).toBe(controller.signal.reason);
    expect((error as DOMException).name).toBe("AbortError");
    expect(isNetworkFailure(error)).toBe(true);
  });

  it("acknowledgeKitchenNotice POSTs to the notice's acknowledge route, and a display to its device twin", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const api = new TillApi("", fetchStub);

    await expect(api.acknowledgeKitchenNotice("kn-1")).resolves.toBeUndefined();
    await expect(api.deviceAcknowledgeKitchenNotice("kn-2")).resolves.toBeUndefined();

    expect(
      fetchStub.mock.calls.map(([path, init]) => [path, (init as RequestInit).method]),
    ).toEqual([
      ["/api/kitchen-notices/kn-1/acknowledge", "POST"],
      ["/api/device/kitchen-notices/kn-2/acknowledge", "POST"],
    ]);
  });

  it("advanceTicketItem POSTs { to } to the ticket item's advance route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      new TillApi("", fetchStub).advanceTicketItem("ti-1", "preparing"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/ticket-items/ti-1/advance",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "preparing" }),
      }),
    );
  });

  it("advanceTicketItem surfaces { code } for an illegal transition", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "ticket.invalid_transition" } }), {
        status: 409,
      }),
    );

    await expect(
      new TillApi("", fetchStub).advanceTicketItem("ti-1", "ready"),
    ).rejects.toMatchObject({ code: "ticket.invalid_transition" });
  });

  it("advanceTicket POSTs { to } to the whole-ticket advance route (order + station, empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      new TillApi("", fetchStub).advanceTicket("wo-1", "st-1", "ready"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo-1/stations/st-1/advance",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "ready" }),
      }),
    );
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

  it("markCollected POSTs an empty object to the order's /collect route — the counter handover (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).markCollected("wo1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo1/collect",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("markCollected with a submission id POSTs it, and hands a caller's abort signal to fetch", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const signal = new AbortController().signal;

    await new TillApi("", fetchStub).markCollected("wo1", "sub-1", { signal });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo1/collect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ submissionId: "sub-1" }),
        signal,
      }),
    );
  });

  it("listCounterWaiting GETs the counter's waiting orders and returns them", async () => {
    const rows = [
      {
        id: "wo1",
        orderNumber: 3,
        label: null,
        status: "settled",
        openedAt: "2026-10-01T10:00:00.000Z",
        settledAt: "2026-10-01T10:01:00.000Z",
        collectedAt: null,
        total: "18.00",
        canHandOver: true,
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(rows));

    const r = await new TillApi("", fetchStub).listCounterWaiting();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/counter-waiting",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(rows);
  });

  it("retrievePlacedOrder GETs the addressed sent order with a caller's abort signal", async () => {
    const order = { id: "wo1", orderNumber: 7, label: null, revision: 2, lines: [] };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(order));
    const signal = new AbortController().signal;

    const r = await new TillApi("", fetchStub).retrievePlacedOrder("wo1", { signal });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/placed",
      expect.objectContaining({ method: "GET", signal }),
    );
    expect(r).toEqual(order);
  });

  it("markCollected surfaces { code } when the order is not collectable", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "working_order.not_settled" } }), {
        status: 409,
      }),
    );

    await expect(new TillApi("", fetchStub).markCollected("wo1")).rejects.toMatchObject({
      code: "working_order.not_settled",
    });
  });

  it("reprintOrder POSTs an empty object to the order's /reprint route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).reprintOrder("wo1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo1/reprint",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("reprintOrder surfaces { code } when the order id is unknown/malformed", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "working_order.not_found" } }), {
        status: 404,
      }),
    );

    await expect(new TillApi("", fetchStub).reprintOrder("wo1")).rejects.toMatchObject({
      code: "working_order.not_found",
    });
  });

  it.each([
    { status: "not_queued" },
    { status: "queued", jobId: "original-1", canRetry: false },
    { status: "failed", jobId: "original-2", canRetry: true },
    { status: "done", jobId: "original-3", canRetry: false },
  ])("reads the original receipt status without requesting a print: $status", async (status) => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(status));
    expect(await new TillApi("", fetchStub).getReceiptPrintStatus("wo1")).toEqual(status);
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(fetchStub).toHaveBeenCalledWith("/api/sales/wo1/receipt", {
      method: "GET",
      credentials: "include",
    });
  });

  it("retries an original through its sale and returns the new job id", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ jobId: "retry-1" }));
    expect(await new TillApi("", fetchStub).retryReceipt("wo1")).toEqual({ jobId: "retry-1" });
    expect(fetchStub).toHaveBeenCalledWith("/api/sales/wo1/receipt/retry", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });

  it("surfaces a failed-original retry refusal so the view can refresh its status", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "print_job.not_resendable", params: { id: "original-1" } } },
          409,
        ),
      );
    await expect(new TillApi("", fetchStub).retryReceipt("wo1")).rejects.toEqual({
      code: "print_job.not_resendable",
      status: 409,
      id: "original-1",
    });
  });

  it.each([
    ["printReceipt", "/api/sales/wo1/receipt"],
    ["printPaymentSlip", "/api/sales/wo1/payment-slip"],
  ] as const)("%s POSTs an empty object to %s", async (method, path) => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const api = new TillApi("", fetchStub);

    await expect(api[method]("wo1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      path,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it.each([
    [undefined, {}],
    ["gl-ES", { language: "gl-ES" }],
  ] as const)(
    "reprint with language %s POSTs %j to the sale's /reprint route",
    async (language, body) => {
      const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

      await expect(new TillApi("", fetchStub).reprint("wo1", language)).resolves.toBeUndefined();

      expect(fetchStub).toHaveBeenCalledWith(
        "/api/sales/wo1/reprint",
        expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
      );
    },
  );

  it("fireCourse POSTs an empty object to the order+course fire route — the kitchen-fire release (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).fireCourse("wo1", "co2")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo1/courses/co2/fire",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("fireCourse surfaces { code } when the course is unknown or retired", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "course.not_found" } }), {
        status: 404,
      }),
    );

    await expect(new TillApi("", fetchStub).fireCourse("wo1", "co2")).rejects.toMatchObject({
      code: "course.not_found",
    });
  });

  it("getExpoQueue GETs this node's cross-station pass queue (courses across stations)", async () => {
    const queue = [
      {
        orderId: "wo-1",
        orderNumber: 7,
        openedMinutes: 3,
        courses: [
          {
            courseId: "co-1",
            courseName: "Entrantes",
            displayOrder: 0,
            fired: true,
            away: false,
            items: [
              {
                id: "ti-1",
                name: { "es-ES": "Paella" },
                qty: "2.000",
                stationName: "Cocina",
                state: "ready",
                firedAt: "2026-08-17T10:00:00.000Z",
                awayAt: null,
              },
            ],
          },
        ],
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(queue));

    const r = await new TillApi("", fetchStub).getExpoQueue();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/expo/queue",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(queue);
  });

  it("reads watcher summaries and a watcher board, then sends a Done mark", async () => {
    const watchers = [{ id: "pass", name: "Pass", runsPass: true }];
    const board = { watcher: { ...watchers[0], active: true }, orders: [] };
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(watchers))
      .mockResolvedValueOnce(jsonResponse(board))
      .mockResolvedValueOnce(jsonResponse({}));
    const api = new TillApi("", fetchStub);
    expect(await api.listWatchers()).toEqual(watchers);
    expect(await api.getWatcherQueue("pass")).toEqual(board);
    await api.markWatcherDone("pass", ["ti-1"], true);
    expect(fetchStub.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/watchers", "GET"],
      ["/api/watchers/pass/queue", "GET"],
      ["/api/watchers/pass/done", "POST"],
    ]);
    expect(JSON.parse(fetchStub.mock.calls[2]![1].body)).toEqual({
      ticketItemIds: ["ti-1"],
      done: true,
    });
  });

  it("bumpCourseReady POSTs an empty object to the order+course /ready route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).bumpCourseReady("wo1", "co2")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo1/courses/co2/ready",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("markCourseAway POSTs an empty object to the order+course /away route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).markCourseAway("wo1", "co2")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/orders/wo1/courses/co2/away",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  });

  it("markCourseAway surfaces { code } when the course is unknown or retired", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "course.not_found" } }), {
        status: 404,
      }),
    );

    await expect(new TillApi("", fetchStub).markCourseAway("wo1", "co2")).rejects.toMatchObject({
      code: "course.not_found",
    });
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

  it("cancelOrder sends a supervisor's PIN beside the reason when one is given", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await new TillApi("", fetchStub).cancelOrder("wo1", "Wrong table", {
      personId: "sup-1",
      pin: "1234",
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          reason: "Wrong table",
          override: { personId: "sup-1", pin: "1234" },
        }),
      }),
    );
  });

  it("cancelOrder hands the caller's signal to the request, still sending the reason alone", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const { signal } = new AbortController();

    await new TillApi("", fetchStub).cancelOrder("wo1", "Wrong table", undefined, { signal });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo1/cancel",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Wrong table" }),
        signal,
      }),
    );
  });

  it("listCancelCreditAuthorizers GETs who may approve cancelling an invoiced bill", async () => {
    const roster = [{ personId: "sup-1", displayName: "Responsable" }];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(roster));

    const r = await new TillApi("", fetchStub).listCancelCreditAuthorizers();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/cancel-credit-authorizers",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(roster);
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
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
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
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
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

  // --- Live floor: zones, occupancy read-model, served markers, tab open/round ---

  it("listZones GETs the venue's active floor-plan zones and returns them", async () => {
    // Typed `FloorZone[]` so the mock is a compile-time proof the client shape carries every field
    // the server sends (`id`, `name`, `displayOrder`, `active`).
    const zones: FloorZone[] = [
      { id: "z1", name: "Terraza", displayOrder: 0, active: true },
      { id: "z2", name: "Interior", displayOrder: 1, active: true },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(zones));

    const r = await new TillApi("", fetchStub).listZones();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/zones",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(zones);
  });

  it("listStatuses GETs the venue's ACTIVE service statuses and returns them", async () => {
    // Typed `TableServiceStatus[]` so the mock is a compile-time proof the client mirror carries every
    // field the `GET /api/statuses` route sends (`id`, `label`, `color`).
    const statuses: TableServiceStatus[] = [
      { id: "s1", label: "Bill requested", color: "#ef4444" },
      { id: "s2", label: "Needs cleaning", color: "amber" },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(statuses));

    const r = await new TillApi("", fetchStub).listStatuses();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/statuses",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(statuses);
  });

  it("getTablesState GETs the occupancy read-model, decoding zoneId + pendingToServe + readyToServe + enRoute + timingBand and the tab fields", async () => {
    // Typed `TableState[]` so `tsc` checks the client mirror carries every field. An open-tab row
    // carries the optional tab fields and a manual `status`; a free row omits the tab fields and nulls
    // zone/capacity/status.
    const rows: TableState[] = [
      {
        id: "t1",
        label: "Mesa 1",
        zoneId: "z1",
        capacity: 4,
        state: "open-tab",
        condition: "free",
        hasOpenTab: true,
        tabLineCount: 3,
        tabTotal: "12.50",
        pendingDeliveries: 0,
        pendingToServe: 2,
        readyToServe: 3,
        enRoute: 1,
        timingBand: "forgotten",
        status: { id: "s1", label: "Reservada", color: "#ff0000" },
        nextReservation: { time: "20:30" },
        // A PLACED table carries its coordinates, shape and rotation…
        posX: 250,
        posY: 400,
        shape: "round",
        rotation: 15,
        signals: [],
        party: null,
      },
      {
        id: "t2",
        label: "Mesa 2",
        zoneId: null,
        capacity: null,
        state: "free",
        condition: "needs_clearing",
        hasOpenTab: false,
        pendingDeliveries: 0,
        pendingToServe: 0,
        readyToServe: 0,
        enRoute: 0,
        timingBand: "fresh",
        status: null,
        nextReservation: null,
        // …while an UNPLACED table nulls all four (it belongs in the tray, not on the map).
        posX: null,
        posY: null,
        shape: null,
        rotation: null,
        signals: [],
        party: null,
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(rows));

    const r = await new TillApi("", fetchStub).getTablesState();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/tables/state",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(rows);
    expect(r[0]).toMatchObject({
      zoneId: "z1",
      pendingToServe: 2,
      readyToServe: 3,
      enRoute: 1,
      posX: 250,
      shape: "round",
    });
    expect(r[1]).toMatchObject({ posX: null, shape: null });
  });

  it("getTabLines GETs the open tab's lines, decoding the locked price + served state per line", async () => {
    // Typed `TabLine[]` so `tsc` checks the client mirror declares every field. The first line was
    // sold as a variant, so it names its parent product; the second is a CHILD extras row with no
    // ticket item (`state: null`), naming its parent dish by `parentLineNo` and its list by `listId`.
    const lines: TabLine[] = [
      {
        stationId: null,
        movable: false,
        id: "line-1",
        lineNo: 1,
        productId: "cafe-large",
        parentProductId: "cafe",
        menuItemId: "mi-cafe",
        note: "sin azúcar",
        listId: null,
        quantity: "1.000",
        unitPriceGross: "1.50",
        servedAt: "2026-08-06T10:00:00.000Z",
        courseId: null,
        sentAt: "2026-08-06T09:59:00.000Z",
        firedAt: "2026-08-06T09:59:00.000Z",
        state: "queued",
        groupId: "g1",
      },
      {
        stationId: null,
        movable: false,
        id: "line-2",
        lineNo: 2,
        productId: "agua",
        parentProductId: null,
        menuItemId: null,
        note: null,
        parentLineNo: 1,
        listId: "list-extras",
        quantity: "2.000",
        unitPriceGross: "2.00",
        servedAt: null,
        courseId: "course-1",
        sentAt: "2026-08-06T09:59:00.000Z",
        firedAt: null,
        state: null,
        groupId: null,
      },
    ];
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ lines, revision: 3, editSentLines: false }));

    const tab = await new TillApi("", fetchStub).getTabLines("ord-1");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/ord-1/lines",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(tab).toEqual({ lines, revision: 3, editSentLines: false });
    const r = tab.lines;
    // The served-state signal survives the round-trip decoded per line.
    expect(r[0]!.servedAt).not.toBeNull();
    expect(r[1]!.servedAt).toBeNull();
    expect(r[0]!.state).toBe("queued");
    expect(r[1]!.state).toBeNull();
    // The child marker survives too: null on the dish, the parent's line number on the child.
    expect(r[0]!.parentLineNo ?? null).toBeNull();
    expect(r[1]!.parentLineNo).toBe(1);
  });

  it("getTabLines surfaces { code } when the tab is not open", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "tab.not_open" } }), { status: 409 }),
      );

    await expect(new TillApi("", fetchStub).getTabLines("ord-1")).rejects.toMatchObject({
      code: "tab.not_open",
    });
  });

  // --- Coursing editing: per-line re-course and send/recall of held lines ---

  it("setLineCourse PATCHes { courseId } to the line's /course route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      new TillApi("", fetchStub).setLineCourse("wo-1", 2, "c-9"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/lines/2/course",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId: "c-9" }),
      }),
    );
  });

  it("setLineCourse PATCHes { courseId: null } to CLEAR a line's course", async () => {
    // `null` is a first-class value the route accepts (`courseId: string | null`) — clearing the
    // course, not an absent field — so it must ride the body as an explicit null.
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await new TillApi("", fetchStub).setLineCourse("wo-1", 2, null);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/lines/2/course",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId: null }),
      }),
    );
  });

  it("setLineCourse surfaces { code } for an unknown/retired course or an already-fired line", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "course.not_found" } }), { status: 404 }),
      );

    await expect(new TillApi("", fetchStub).setLineCourse("wo-1", 2, "gone")).rejects.toMatchObject(
      { code: "course.not_found" },
    );
  });

  it("sendLines POSTs { lineNos } to the tab's /lines/send route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).sendLines("wo-1", [2, 3])).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/lines/send",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineNos: [2, 3] }),
      }),
    );
  });

  it("sendLines surfaces { code } when the tab is not open", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "tab.not_open" } }), { status: 409 }),
      );

    await expect(new TillApi("", fetchStub).sendLines("wo-1", [2, 3])).rejects.toMatchObject({
      code: "tab.not_open",
    });
  });

  it("recallLines POSTs { lineNos } to the tab's /lines/recall route (empty 200 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(new TillApi("", fetchStub).recallLines("wo-1", [2, 3])).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/lines/recall",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineNos: [2, 3] }),
      }),
    );
  });

  it("recallLines surfaces { code } for a line the kitchen has already started", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "ticket.already_started" } }), {
        status: 409,
      }),
    );

    await expect(new TillApi("", fetchStub).recallLines("wo-1", [2, 3])).rejects.toMatchObject({
      code: "ticket.already_started",
    });
  });

  describe("adjustments (service plan Task 11)", () => {
    const ask = {
      expectedRevision: 7,
      lineId: "line-1",
      reasonId: "reason-1",
      action: "discount_percent" as const,
      percentBp: 1000,
      note: null,
    };

    it("listAdjustmentReasons GETs the active reasons", async () => {
      const reasons = [
        {
          id: "reason-1",
          name: "Complaint",
          actions: ["comp"],
          noteRequired: false,
          maxPercentBp: null,
          maxAmount: "30.00",
          applyRole: "supervisor",
          approverRole: "manager",
        },
      ];
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse(reasons));

      await expect(new TillApi("", fetchStub).listAdjustmentReasons()).resolves.toEqual(reasons);
      expect(fetchStub).toHaveBeenCalledWith(
        "/api/adjustment-reasons",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    it("listAdjustmentApprovers GETs the people at or above a role", async () => {
      const roster = [{ personId: "m-1", displayName: "Marta" }];
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse(roster));

      await expect(new TillApi("", fetchStub).listAdjustmentApprovers("manager")).resolves.toEqual(
        roster,
      );
      expect(fetchStub).toHaveBeenCalledWith(
        "/api/adjustment-approvers?role=manager",
        expect.objectContaining({ method: "GET", credentials: "include" }),
      );
    });

    it("previewAdjustment POSTs the ask to the bill's preview route", async () => {
      const preview = { reduction: "3.00", nominalValue: "30.00", needsApproval: null, lines: [] };
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse(preview));

      await expect(new TillApi("", fetchStub).previewAdjustment("wo-1", ask)).resolves.toEqual(
        preview,
      );
      expect(fetchStub).toHaveBeenCalledWith(
        "/api/working-orders/wo-1/adjustments/preview",
        expect.objectContaining({ method: "POST", body: JSON.stringify(ask) }),
      );
    });

    it("applyAdjustment POSTs the command under the caller's signal, and surfaces a refusal's params", async () => {
      const command = {
        ...ask,
        submissionId: "sub-1",
        approver: { personId: "m-1", pin: "7777" },
      };
      const answer = { adjustmentIds: ["a-1"], revision: 8, party: { id: "v1", revision: 5 } };
      const fetchStub = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(answer))
        .mockResolvedValueOnce(
          jsonResponse(
            {
              error: { code: "adjustment.approval_required", params: { approverRole: "manager" } },
            },
            403,
          ),
        );
      const api = new TillApi("", fetchStub);
      const signal = new AbortController().signal;

      await expect(api.applyAdjustment("wo-1", command, { signal })).resolves.toEqual(answer);
      expect(fetchStub).toHaveBeenCalledWith(
        "/api/working-orders/wo-1/adjustments",
        expect.objectContaining({ method: "POST", body: JSON.stringify(command), signal }),
      );
      await expect(api.applyAdjustment("wo-1", command)).rejects.toEqual({
        code: "adjustment.approval_required",
        approverRole: "manager",
        status: 403,
      });
    });
  });

  it("updateOrderLine PUTs the changed fields of one line with the revision it was read at, and resolves the one the server answers", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revision: 8, party: { id: "v1", revision: 5 } }), {
        status: 200,
      }),
    );

    await expect(
      new TillApi("", fetchStub).updateOrderLine(
        "ord-1",
        3,
        { quantity: "2", note: null, extras: [] },
        7,
      ),
    ).resolves.toEqual({ revision: 8, party: { id: "v1", revision: 5 } });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/ord-1/lines/3",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ quantity: "2", note: null, extras: [], revision: 7 }),
      }),
    );
  });

  it("setTableStatus POSTs { statusId } to the TABLE's /status route (empty 200 body)", async () => {
    // Keyed by TABLE id (not order id): a manual service status belongs to the table, not to a tab.
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      new TillApi("", fetchStub).setTableStatus("tbl-1", "st-1"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/tables/tbl-1/status",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statusId: "st-1" }),
      }),
    );
  });

  it("setTableStatus POSTs { statusId: null } to CLEAR a table's status", async () => {
    // `null` is a first-class value the route accepts (`statusId: string | null`) — clearing the badge,
    // not an absent field — so it must ride the body as an explicit null.
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    await new TillApi("", fetchStub).setTableStatus("tbl-1", null);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/tables/tbl-1/status",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statusId: null }),
      }),
    );
  });

  it("setTableStatus surfaces { code } for an unknown status", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "status.not_found" } }), { status: 404 }),
      );

    await expect(new TillApi("", fetchStub).setTableStatus("tbl-1", "gone")).rejects.toMatchObject({
      code: "status.not_found",
    });
  });

  // --- Table actions on a party (/api/parties/:id/<verb>) and bill actions (/api/bills/:id/<verb>) ---

  it("moveGuests POSTs the target table, the bill choice and both parties read to the party's /move route", async () => {
    const answer = { partyId: "v7", mainBillId: "wo-7", merged: true };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(
      new TillApi("", fetchStub).moveGuests("v1", "tbl-7", "merge", {
        expectedPartyRevision: 3,
        otherPartyId: "v7",
        expectedOtherPartyRevision: 9,
      }),
    ).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/move",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toTableId: "tbl-7",
          bills: "merge",
          expectedPartyRevision: 3,
          otherPartyId: "v7",
          expectedOtherPartyRevision: 9,
        }),
      }),
    );
  });

  it("moveBill POSTs where the bill goes, the bill choice and the parties read to the bill's /move route, and answers the move", async () => {
    const answer = { partyId: "v7", billId: "wo-check", merged: false };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(
      new TillApi("", fetchStub).moveBill("wo-check", { tableId: "tbl-7" }, "separate", {
        expectedPartyRevision: 3,
        partyId: "v1",
        otherPartyId: "v7",
        expectedOtherPartyRevision: 9,
      }),
    ).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/bills/wo-check/move",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: { tableId: "tbl-7" },
          bills: "separate",
          expectedPartyRevision: 3,
          partyId: "v1",
          otherPartyId: "v7",
          expectedOtherPartyRevision: 9,
        }),
      }),
    );
  });

  it("moveBill sends a counter order read with no party, to a table read free, as partyId and otherPartyId null", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ partyId: "v-new", billId: "wo-12", merged: false }));

    await new TillApi("", fetchStub).moveBill("wo-12", { tableId: "tbl-9" }, "merge", {
      partyId: null,
      otherPartyId: null,
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/bills/wo-12/move",
      expect.objectContaining({
        body: JSON.stringify({
          to: { tableId: "tbl-9" },
          bills: "merge",
          partyId: null,
          otherPartyId: null,
        }),
      }),
    );
  });

  it("moveBill sends a move to the counter with the counter's zone, or null", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ partyId: null, billId: "wo-4", merged: false }),
    );
    const api = new TillApi("", fetchStub);

    await api.moveBill("wo-4", { counter: { zoneId: "z-bar" } }, "merge", {
      expectedPartyRevision: 3,
      partyId: "v1",
    });
    await api.moveBill("wo-4", { counter: { zoneId: null } }, "merge", {
      expectedPartyRevision: 3,
      partyId: "v1",
    });

    const bodies = fetchStub.mock.calls.map((call) =>
      JSON.parse((call as unknown as [string, RequestInit])[1].body as string),
    );
    expect(bodies[0]).toEqual({
      to: { counter: { zoneId: "z-bar" } },
      bills: "merge",
      expectedPartyRevision: 3,
      partyId: "v1",
    });
    expect(bodies[1].to).toEqual({
      counter: { zoneId: null },
    });
  });

  it("moveBill rejects with the server's code and params", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "party.main_bill_stays", params: { partyId: "v1" } } }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      new TillApi("", fetchStub).moveBill("wo-4", { counter: { zoneId: null } }, "merge", {
        expectedPartyRevision: 3,
        partyId: "v1",
      }),
    ).rejects.toEqual({ code: "party.main_bill_stays", partyId: "v1", status: 409 });
  });

  it("joinTables POSTs the table, the bill choice and a table read free as otherPartyId null to the party's /join route", async () => {
    const answer = { partyId: "v1", mainBillId: "wo-4", merged: false };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(
      new TillApi("", fetchStub).joinTables("v1", "tbl-9", "separate", {
        expectedPartyRevision: 3,
        otherPartyId: null,
      }),
    ).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/join",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tableId: "tbl-9",
          bills: "separate",
          expectedPartyRevision: 3,
          otherPartyId: null,
        }),
      }),
    );
  });

  it("splitTable POSTs the table, the chosen bill or null, and the revision to the party's /split-table route", async () => {
    const answer = { partyId: "v-new", mainBillId: null };
    const fetchStub = vi.fn(async () => jsonResponse(answer));
    const api = new TillApi("", fetchStub);

    await expect(api.splitTable("v1", "tbl-5", "wo-check", 3)).resolves.toEqual(answer);
    await api.splitTable("v1", "tbl-5", null, 4);

    expect(fetchStub).toHaveBeenNthCalledWith(
      1,
      "/api/parties/v1/split-table",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tableId: "tbl-5", billId: "wo-check", expectedPartyRevision: 3 }),
      }),
    );
    expect(fetchStub).toHaveBeenNthCalledWith(
      2,
      "/api/parties/v1/split-table",
      expect.objectContaining({
        body: JSON.stringify({ tableId: "tbl-5", billId: null, expectedPartyRevision: 4 }),
      }),
    );
  });

  it("setPartyName PUTs the name, or null to clear it, and the revision to the party's /name route", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ revision: 4, name: "Ana" }));
    const api = new TillApi("", fetchStub);

    await expect(api.setPartyName("v1", "Ana", 3)).resolves.toEqual({ revision: 4, name: "Ana" });
    await api.setPartyName("v1", null, 4);

    expect(fetchStub).toHaveBeenNthCalledWith(
      1,
      "/api/parties/v1/name",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ name: "Ana", expectedPartyRevision: 3 }),
      }),
    );
    expect(fetchStub).toHaveBeenNthCalledWith(
      2,
      "/api/parties/v1/name",
      expect.objectContaining({ body: JSON.stringify({ name: null, expectedPartyRevision: 4 }) }),
    );
  });

  it("setPartyName surfaces a refusal naming the field as { code, field }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "management.request_invalid", params: { field: "name" } } },
          400,
        ),
      );

    await expect(
      new TillApi("", fetchStub).setPartyName("v1", "x".repeat(41), 3),
    ).rejects.toMatchObject({ code: "management.request_invalid", field: "name" });
  });

  it("mergeBills POSTs { fromBillId } to the /merge route of the bill merged into, and answers nothing", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      new TillApi("", fetchStub).mergeBills("wo-into", "wo-from", {}),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/bills/wo-into/merge",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromBillId: "wo-from" }),
      }),
    );
  });

  it("transferItems POSTs { toBillId, transfers } to the /transfer route of the bill the items leave", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      new TillApi("", fetchStub).transferItems(
        "wo-src",
        "wo-dst",
        [{ lineNo: 1 }, { lineNo: 2, quantity: "1.000" }],
        {},
      ),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/bills/wo-src/transfer",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toBillId: "wo-dst",
          transfers: [{ lineNo: 1 }, { lineNo: 2, quantity: "1.000" }],
        }),
      }),
    );
  });

  it("splitBill POSTs the chosen lines to the bill's /split route and answers the new bill's id", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ billId: "wo-new" }));

    const result = await new TillApi("", fetchStub).splitBill("wo-7", [{ lineNo: 1 }], {});

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/bills/wo-7/split",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transfers: [{ lineNo: 1 }] }),
      }),
    );
    expect(result).toEqual({ billId: "wo-new" });
  });

  it("mergeBills surfaces a refusal as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "bill.presented", params: { workingOrderId: "wo-from" } } },
          409,
        ),
      );

    await expect(
      new TillApi("", fetchStub).mergeBills("wo-into", "wo-from", {}),
    ).rejects.toMatchObject({ code: "bill.presented", workingOrderId: "wo-from" });
  });

  // --- Floor-plan placement (the on-till routes, not the management ones) ---

  it("setTablePlacement PUTs the placement body to the TABLE's /placement route (empty 204 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new TillApi("", fetchStub);

    await expect(
      api.setTablePlacement("tbl-1", {
        posX: 100,
        posY: 200,
        shape: "round",
        rotation: 0,
        zoneId: "z1",
      }),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/tables/tbl-1/placement",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ posX: 100, posY: 200, shape: "round", rotation: 0, zoneId: "z1" }),
      }),
    );
  });

  it("clearPlacement DELETEs the TABLE's /placement route (empty 204 body, no request body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new TillApi("", fetchStub);

    await expect(api.clearPlacement("tbl-1")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/tables/tbl-1/placement",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
    // An un-place carries neither a request body nor a content-type header.
    const init = fetchStub.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("setTablePlacement surfaces { code } when the placement value is invalid", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "placement.invalid" } }), { status: 400 }),
      );

    await expect(
      new TillApi("", fetchStub).setTablePlacement("tbl-1", {
        posX: 9999,
        posY: 0,
        shape: "round",
        rotation: 0,
        zoneId: "z1",
      }),
    ).rejects.toMatchObject({ code: "placement.invalid" });
  });

  // --- Device mode: the httpOnly device cookie rides `credentials: "include"`, so these never send a
  // token themselves. ---

  it("join POSTs only { name } to /api/device/join and returns the id + the number", async () => {
    // ONLY the name goes up, and nothing about the venue comes back: the profile and the binding are
    // chosen in the dashboard's accept dialog, so the join call reads no catalogue.
    const result = { joinId: "jr-1", verificationNumber: "47" };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(result));

    const r = await new TillApi("", fetchStub).join("Front counter");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/join",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Front counter" }),
      }),
    );
    expect(r).toEqual(result);
  });

  it("join surfaces { code } when the venue's pairing window is shut", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "device.pairing_closed" } }), {
        status: 403,
      }),
    );

    await expect(new TillApi("", fetchStub).join("Front counter")).rejects.toMatchObject({
      code: "device.pairing_closed",
    });
  });

  it("joinStatus GETs /api/device/join/status with no body and returns the status", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ status: "approved" }));

    const r = await new TillApi("", fetchStub).joinStatus();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/join/status",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual({ status: "approved" });
  });

  it("getDeviceStation GETs /api/device/station and returns the bound station + its queue", async () => {
    const station = {
      id: "st-1",
      queue: [
        {
          orderId: "wo-1",
          orderNumber: 7,
          label: "Mesa 4",
          queuedAt: "2026-08-17T10:00:00.000Z",
          status: "settled",
          items: [
            {
              id: "ti-1",
              workingOrderLineId: "wol-1",
              state: "queued",
              descriptions: { "es-ES": "Paella" },
              quantity: "2.000",
              course: null,
              firedAt: "2026-08-17T10:00:00.000Z",
            },
          ],
        },
      ],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ station }));

    const r = await new TillApi("", fetchStub).getDeviceStation();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/station",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual({ station });
  });

  it("getDeviceStation surfaces { code: 'device.unauthorized' } when the cookie is missing/rejected", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "device.unauthorized" } }), {
        status: 401,
      }),
    );

    await expect(new TillApi("", fetchStub).getDeviceStation()).rejects.toMatchObject({
      code: "device.unauthorized",
    });
  });

  it("getDeviceIdentity GETs /api/device/me and returns the device's non-secret identity", async () => {
    const identity = {
      deviceId: "dev-1",
      formFactor: "phone-portrait",
      name: "Camarero 1",
      stationId: null,
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(identity));

    const r = await new TillApi("", fetchStub).getDeviceIdentity();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/me",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(identity);
  });

  it("getDeviceIdentity surfaces { code: 'device.unauthorized' } when the cookie is missing/rejected", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "device.unauthorized" } }), {
        status: 401,
      }),
    );

    await expect(new TillApi("", fetchStub).getDeviceIdentity()).rejects.toMatchObject({
      code: "device.unauthorized",
    });
  });

  it("setDevicePrinters PUTs only the field given to /api/device/printers and returns the stored pair", async () => {
    const stored = { receiptPrinterId: "P-off", paymentSlipPrinterId: "S1" };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(stored));

    const r = await new TillApi("", fetchStub).setDevicePrinters({ paymentSlipPrinterId: "S1" });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/printers",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ paymentSlipPrinterId: "S1" }),
      }),
    );
    expect(r).toEqual(stored);
  });

  it("deviceAdvance POSTs { to } to the device ticket-item advance route (empty 204 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      new TillApi("", fetchStub).deviceAdvance("ti-1", "preparing"),
    ).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/ticket-items/ti-1/advance",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: "preparing" }),
      }),
    );
  });

  it("deviceAdvance surfaces { code: 'device.forbidden_station' } for a foreign item", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "device.forbidden_station" } }), {
        status: 403,
      }),
    );

    await expect(
      new TillApi("", fetchStub).deviceAdvance("ti-foreign", "ready"),
    ).rejects.toMatchObject({ code: "device.forbidden_station" });
  });

  // --- Per-user language preference ---

  it("getLocales GETs the public /api/locales list with the browser match", async () => {
    const body = {
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "en-GB",
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(body));

    const r = await new TillApi("", fetchStub).getLocales();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/locales",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    // A public read carries neither a request body nor a content-type header.
    const init = fetchStub.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(r).toEqual(body);
  });

  it("login response carries the operator's per-user locale (or null when unset)", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ personId: "u1", permissions: [], locale: "en-GB" }));
    const r = await new TillApi("", fetchStub).login("u1", "1234");
    expect(r.locale).toBe("en-GB");
  });

  it("putLocale PUTs the chosen code to /api/session/locale and resolves void on the 204", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new TillApi("", fetchStub);

    const out = await api.putLocale("en-GB");

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/session/locale",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: "en-GB" }),
      }),
    );
    expect(out).toBeUndefined();
  });

  it("reportBattery PUTs the level and charging state to /api/device/battery and resolves void on the 204", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const api = new TillApi("", fetchStub);

    const out = await api.reportBattery({ level: 82, charging: false });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/battery",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: 82, charging: false }),
      }),
    );
    expect(out).toBeUndefined();
  });

  it("reportBattery hands a caller's abort signal to fetch", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const signal = new AbortController().signal;

    await new TillApi("", fetchStub).reportBattery({ level: 82, charging: false }, { signal });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/device/battery",
      expect.objectContaining({ method: "PUT", signal }),
    );
  });
});

describe("TillApi: a seated party", () => {
  const post = (body: unknown) =>
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("seatTable POSTs the guest count to the table's /seat route and returns the party and its tab", async () => {
    const answer = { partyId: "v1", tabId: "wo-1", revision: 0, orderNumber: 12 };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(new TillApi("", fetchStub).seatTable("tbl-1", 3)).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith("/api/tables/tbl-1/seat", post({ guestCount: 3 }));
  });

  it("seatTable sends an explicit null when no guest count was given", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ partyId: "v1", tabId: "wo-1" }));

    await new TillApi("", fetchStub).seatTable("tbl-1", null);

    expect(fetchStub).toHaveBeenCalledWith("/api/tables/tbl-1/seat", post({ guestCount: null }));
  });

  it("finishTable POSTs the revision it read to the party's /finish route", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ state: "closed" }));

    await expect(new TillApi("", fetchStub).finishTable("v1", 4)).resolves.toEqual({
      state: "closed",
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/finish",
      post({ expectedPartyRevision: 4 }),
    );
  });

  it("finishTable surfaces the unpaid-bill refusal as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "party.bill_outstanding" } }, 409));

    await expect(new TillApi("", fetchStub).finishTable("v1", 4)).rejects.toMatchObject({
      code: "party.bill_outstanding",
      status: 409,
    });
  });

  it("recordUnpaidDeparture POSTs the revision, reason and override to the party's /unpaid-departure route", async () => {
    const request: UnpaidDepartureRequest = {
      expectedPartyRevision: 4,
      reason: "Left without paying",
      override: { personId: "sup-1", pin: "1234" },
    };
    const answer: UnpaidDepartureResult = {
      state: "closed",
      departures: [
        {
          id: "ud-1",
          workingOrderId: "wo-1",
          saleId: "s-1",
          invoiceNumber: "F-0007",
          amount: "30.00",
        },
      ],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));
    const signal = new AbortController().signal;

    await expect(
      new TillApi("", fetchStub).recordUnpaidDeparture("v1", request, { signal }),
    ).resolves.toEqual(answer);
    expect(fetchStub).toHaveBeenCalledWith("/api/parties/v1/unpaid-departure", post(request));
    expect(fetchStub.mock.calls[0]![1]).toMatchObject({ signal });
  });

  it("recordUnpaidDeparture surfaces a refusal as { code }", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "unpaid_departure.unfired_dishes",
            params: { workingOrderId: "wo-1" },
          },
        },
        409,
      ),
    );

    await expect(
      new TillApi("", fetchStub).recordUnpaidDeparture("v1", {
        expectedPartyRevision: 4,
        reason: "Gone",
      }),
    ).rejects.toMatchObject({ code: "unpaid_departure.unfired_dishes", status: 409 });
  });

  it("listUnpaidDepartureAuthorizers GETs who may approve an unpaid departure", async () => {
    const roster = [{ personId: "sup-1", displayName: "Responsable" }];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(roster));

    const r = await new TillApi("", fetchStub).listUnpaidDepartureAuthorizers();

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/unpaid-departure-authorizers",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(r).toEqual(roster);
  });

  it("lookUpInvoices encodes the query and returns filed invoice facts with the read signal", async () => {
    const body = {
      invoices: [
        {
          workingOrderId: "bill-1",
          invoiceNumber: "FF/12",
          issuedAt: "2026-10-05T12:00:00Z",
          customerName: "Cliente SL",
          total: "3.00",
        },
      ],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(body));
    const controller = new AbortController();
    const result = await new TillApi("", fetchStub).lookUpInvoices("FF/12 & O'Brien", {
      signal: controller.signal,
    });
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/invoices/lookup?q=FF%2F12%20%26%20O'Brien",
      expect.objectContaining({ method: "GET", credentials: "include", signal: controller.signal }),
    );
    expect(result).toEqual(body);
  });

  it("lookUpInvoices preserves a refused search", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "management.request_invalid", params: { field: "q" } } },
          400,
        ),
      );
    await expect(new TillApi("", fetchStub).lookUpInvoices(" ")).rejects.toMatchObject({
      code: "management.request_invalid",
      status: 400,
      field: "q",
    });
  });

  it("lookUpBills encodes the query in the till GET", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ bills: [] }));
    const result = await new TillApi("", fetchStub).lookUpBills("A/12 & Ruiz");
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/bills/lookup?q=A%2F12%20%26%20Ruiz",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(result).toEqual({ bills: [] });
  });

  it("markTableCleared POSTs to the table's /cleared route with no body (empty 204 body)", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(new TillApi("", fetchStub).markTableCleared("t4")).resolves.toBeUndefined();

    expect(fetchStub).toHaveBeenCalledWith("/api/tables/t4/cleared", {
      method: "POST",
      credentials: "include",
    });
  });

  it("markTableCleared surfaces a missing table as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "table.not_found" } }, 404));

    await expect(new TillApi("", fetchStub).markTableCleared("t4")).rejects.toMatchObject({
      code: "table.not_found",
      status: 404,
    });
  });

  it("getPartyBills GETs the party's bills", async () => {
    const bills = [
      {
        workingOrderId: "wo-1",
        partyId: "v1",
        label: null,
        status: "settled",
        total: "14.00",
        outstanding: "0.00",
        hasPayments: false,
        receiptAvailable: true,
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(bills));

    await expect(new TillApi("", fetchStub).getPartyBills("v1")).resolves.toEqual(bills);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/bills",
      expect.objectContaining({ method: "GET" }),
    );
  });

  const groups = [
    {
      id: "g1",
      position: 1,
      state: "fired",
      firedAt: "2026-09-27T10:00:00.000Z",
      remindAt: null,
      lineIds: ["l1"],
      summary: "2 × Caña",
    },
    {
      id: "g2",
      position: 2,
      state: "held",
      firedAt: null,
      remindAt: null,
      lineIds: ["l2", "l3"],
      summary: "1 × Tarta, 1 × Flan",
    },
  ];

  it("listGroups GETs the party's order groups and the revision they were read at", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 6, groups }));

    await expect(new TillApi("", fetchStub).listGroups("v1")).resolves.toEqual({
      revision: 6,
      groups,
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/groups",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("submitGroups POSTs the submission, the revision read and each group's lines and release, and returns the tab they landed on", async () => {
    const answer = { tabId: "wo-2", revision: 7, groups };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));
    const body = {
      submissionId: "sub-1",
      expectedPartyRevision: 6,
      groups: [
        { lines: [{ menuItemId: "mi-cana", quantity: "2" }], release: "fire" as const },
        {
          lines: [
            { menuItemId: "mi-tarta", quantity: "1" },
            { menuItemId: "mi-flan", quantity: "1", courseId: "c-postres" },
          ],
          release: "hold" as const,
        },
      ],
    };

    await expect(new TillApi("", fetchStub).submitGroups("v1", body)).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith("/api/parties/v1/groups", post(body));
  });

  it("submitGroups sends joinGroupId when adding to a held group", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ tabId: "wo-1", revision: 8, groups }));
    const body = {
      submissionId: "sub-2",
      expectedPartyRevision: 7,
      groups: [{ lines: [{ menuItemId: "mi-tarta", quantity: "1" }], release: "hold" as const }],
      joinGroupId: "g2",
    };

    await new TillApi("", fetchStub).submitGroups("v1", body);

    expect(fetchStub).toHaveBeenCalledWith("/api/parties/v1/groups", post(body));
  });

  it("submitGroups surfaces a stale revision as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "party.out_of_date" } }, 409));

    await expect(
      new TillApi("", fetchStub).submitGroups("v1", {
        submissionId: "sub-3",
        expectedPartyRevision: 1,
        groups: [{ lines: [{ menuItemId: "mi-tarta", quantity: "1" }], release: "fire" }],
      }),
    ).rejects.toMatchObject({ code: "party.out_of_date", status: 409 });
  });

  it.each([
    ["markServed", "served"],
    ["unmarkServed", "unserved"],
  ] as const)(
    "%s POSTs the submission, revision and items to the party's /%s route and returns its revision",
    async (method, path) => {
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 5 }));
      const items = [{ lineId: "line-2", quantity: "2" }];

      await expect(
        new TillApi("", fetchStub)[method]("v1", items, {
          submissionId: "sub-1",
          expectedPartyRevision: 4,
        }),
      ).resolves.toEqual({ revision: 5 });

      expect(fetchStub).toHaveBeenCalledWith(
        `/api/parties/v1/${path}`,
        post({ submissionId: "sub-1", expectedPartyRevision: 4, items }),
      );
    },
  );

  it("markGroupServed POSTs the submission and revision to the group's /served route", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 7 }));

    await expect(
      new TillApi("", fetchStub).markGroupServed("v1", "g2", {
        submissionId: "sub-2",
        expectedPartyRevision: 6,
      }),
    ).resolves.toEqual({ revision: 7 });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/groups/g2/served",
      post({ submissionId: "sub-2", expectedPartyRevision: 6 }),
    );
  });

  it("snoozeGroup POSTs the submission, revision and minutes to the group's /snooze route", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 8 }));

    await expect(
      new TillApi("", fetchStub).snoozeGroup("v1", "g3", 5, {
        submissionId: "sub-6",
        expectedPartyRevision: 7,
      }),
    ).resolves.toEqual({ revision: 8 });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/groups/g3/snooze",
      post({ submissionId: "sub-6", expectedPartyRevision: 7, minutes: 5 }),
    );
  });

  it("unsnoozeGroup POSTs the submission and revision to the group's /unsnooze route", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 9 }));

    await expect(
      new TillApi("", fetchStub).unsnoozeGroup("v1", "g3", {
        submissionId: "sub-7",
        expectedPartyRevision: 8,
      }),
    ).resolves.toEqual({ revision: 9 });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/groups/g3/unsnooze",
      post({ submissionId: "sub-7", expectedPartyRevision: 8 }),
    );
  });

  it("requestBill POSTs the submission, revision and whether the bill is asked for to the party's /bill-request route", async () => {
    const answer = { revision: 4, billRequestedAt: "2026-09-30T20:00:00.000Z" };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(
      new TillApi("", fetchStub).requestBill("v1", {
        submissionId: "sub-8",
        expectedPartyRevision: 3,
        requested: true,
      }),
    ).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/bill-request",
      post({ submissionId: "sub-8", expectedPartyRevision: 3, requested: true }),
    );
  });

  it("requestBill passes the caller's abort signal", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ revision: 4, billRequestedAt: null }));
    const signal = new AbortController().signal;
    const command = { submissionId: "sub-9", expectedPartyRevision: 4, requested: false };

    await new TillApi("", fetchStub).requestBill("v1", command, { signal });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/bill-request",
      expect.objectContaining({ method: "POST", body: JSON.stringify(command), signal }),
    );
  });

  it("readCurrentOrders GETs the party's Current orders", async () => {
    const answer = {
      revision: 6,
      reminder: { groupId: "g2", dueAt: "2026-09-28T20:15:00.000Z" },
      groups: [
        {
          id: "g1",
          position: 1,
          state: "fired",
          firedAt: "2026-09-28T19:50:00.000Z",
          remindAt: null,
          sentAt: "2026-09-28T19:50:00.000Z",
          sentBy: "Luis",
          rows: [
            {
              lineId: "l1",
              workingOrderId: "wo-1",
              lineNo: 1,
              name: "Croquetas",
              quantity: "4.000",
              unitPrecision: 0,
              servedQuantity: "2.000",
              servedAt: null,
              released: true,
              kitchen: { state: "queued", firedAt: "2026-09-28T19:50:00.000Z", awayAt: null },
              note: null,
              extras: [],
            },
          ],
        },
      ],
      ungrouped: [],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(new TillApi("", fetchStub).readCurrentOrders("v1")).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/current-orders",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("markServed surfaces more than is left to serve as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "tab.serve_quantity_invalid" } }, 400));

    await expect(
      new TillApi("", fetchStub).markServed("v1", [{ lineId: "line-2", quantity: "9" }], {
        submissionId: "sub-3",
        expectedPartyRevision: 4,
      }),
    ).rejects.toMatchObject({ code: "tab.serve_quantity_invalid", status: 400 });
  });

  it("fireGroup POSTs the submission and revision to the group's /fire route and returns the party's revision", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 9 }));

    await expect(
      new TillApi("", fetchStub).fireGroup("v1", "g2", {
        submissionId: "sub-4",
        expectedPartyRevision: 8,
      }),
    ).resolves.toEqual({ revision: 9 });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/groups/g2/fire",
      post({ submissionId: "sub-4", expectedPartyRevision: 8 }),
    );
  });

  it("fireGroup surfaces an already-fired group as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "group.not_held" } }, 409));

    await expect(
      new TillApi("", fetchStub).fireGroup("v1", "g1", {
        submissionId: "sub-5",
        expectedPartyRevision: 8,
      }),
    ).rejects.toMatchObject({ code: "group.not_held", status: 409 });
  });

  it.each([
    ["bumpGroupReady", "ready"],
    ["markGroupAway", "away"],
  ] as const)(
    "%s POSTs the submission and revision to the group's /%s route and returns the party's revision",
    async (method, step) => {
      const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 11 }));

      await expect(
        new TillApi("", fetchStub)[method]("v1", "g2", {
          submissionId: "sub-9",
          expectedPartyRevision: 10,
        }),
      ).resolves.toEqual({ revision: 11 });

      expect(fetchStub).toHaveBeenCalledWith(
        `/api/parties/v1/groups/g2/${step}`,
        post({ submissionId: "sub-9", expectedPartyRevision: 10 }),
      );
    },
  );

  it("markGroupAway surfaces a stale revision as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "party.out_of_date" } }, 409));

    await expect(
      new TillApi("", fetchStub).markGroupAway("v1", "g2", {
        submissionId: "sub-10",
        expectedPartyRevision: 3,
      }),
    ).rejects.toMatchObject({ code: "party.out_of_date", status: 409 });
  });

  it("listPrintProblems GETs the party's kitchen tickets that have not printed", async () => {
    const problems = [
      {
        workingOrderId: "wo-4",
        stationId: "st-1",
        stationName: "Cocina",
        since: "2026-09-27T12:00:00.000Z",
      },
    ];
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ problems }));

    await expect(new TillApi("", fetchStub).listPrintProblems("v1")).resolves.toEqual({
      problems,
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/print-problems",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("reorderGroups PUTs the held groups in their new order and returns the party's revision", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ revision: 10 }));

    await expect(
      new TillApi("", fetchStub).reorderGroups("v1", ["g3", "g2"], {
        submissionId: "sub-6",
        expectedPartyRevision: 9,
      }),
    ).resolves.toEqual({ revision: 10 });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/groups/order",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          submissionId: "sub-6",
          expectedPartyRevision: 9,
          heldGroupIds: ["g3", "g2"],
        }),
      }),
    );
  });

  it("moveLinesToGroup POSTs the moves and the target group, or a new one, and returns the party's revision", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ revision: 11 }))
      .mockResolvedValueOnce(jsonResponse({ revision: 12 }));
    const api = new TillApi("", fetchStub);
    const moves = [{ lineId: "l2", quantity: "1" }];

    await expect(
      api.moveLinesToGroup(
        "v1",
        moves,
        { groupId: "g3" },
        {
          submissionId: "sub-7",
          expectedPartyRevision: 10,
        },
      ),
    ).resolves.toEqual({ revision: 11 });
    await expect(
      api.moveLinesToGroup("v1", moves, "new", {
        submissionId: "sub-8",
        expectedPartyRevision: 11,
      }),
    ).resolves.toEqual({ revision: 12 });

    expect(fetchStub).toHaveBeenNthCalledWith(
      1,
      "/api/parties/v1/groups/move",
      post({ submissionId: "sub-7", expectedPartyRevision: 10, moves, target: { groupId: "g3" } }),
    );
    expect(fetchStub).toHaveBeenNthCalledWith(
      2,
      "/api/parties/v1/groups/move",
      post({ submissionId: "sub-8", expectedPartyRevision: 11, moves, target: "new" }),
    );
  });

  it.each([
    [
      "moveGuests",
      (api: TillApi) => api.moveGuests("v1", "tbl-9", "merge", { expectedPartyRevision: 3 }),
      "/api/parties/v1/move",
      { toTableId: "tbl-9", bills: "merge", expectedPartyRevision: 3 },
    ],
    [
      "joinTables",
      (api: TillApi) => api.joinTables("v1", "tbl-9", "merge", { expectedPartyRevision: 3 }),
      "/api/parties/v1/join",
      { tableId: "tbl-9", bills: "merge", expectedPartyRevision: 3 },
    ],
    [
      "mergeBills",
      (api: TillApi) =>
        api.mergeBills("wo-into", "wo-from", { expectedPartyRevision: 3, partyId: "v1" }),
      "/api/bills/wo-into/merge",
      { fromBillId: "wo-from", expectedPartyRevision: 3, partyId: "v1" },
    ],
    [
      "transferItems",
      (api: TillApi) =>
        api.transferItems("wo-src", "wo-dst", [{ lineNo: 1 }], {
          expectedPartyRevision: 3,
          partyId: "v1",
        }),
      "/api/bills/wo-src/transfer",
      { toBillId: "wo-dst", transfers: [{ lineNo: 1 }], expectedPartyRevision: 3, partyId: "v1" },
    ],
    [
      "splitBill",
      (api: TillApi) =>
        api.splitBill("wo-7", [{ lineNo: 1 }], { expectedPartyRevision: 3, partyId: "v1" }),
      "/api/bills/wo-7/split",
      { transfers: [{ lineNo: 1 }], expectedPartyRevision: 3, partyId: "v1" },
    ],
  ] as const)("%s sends the party revisions it was given", async (_name, call, path, body) => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ billId: "c1" }));

    await call(new TillApi("", fetchStub));

    expect(fetchStub).toHaveBeenCalledWith(path, post(body));
  });
});

describe("TillApi: a party's drafts", () => {
  const send = (method: string, body: unknown) =>
    expect.objectContaining({
      method,
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const beer = {
    menuItemId: "mi-beer",
    variantId: null,
    menuVersionId: "mv-7",
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: false,
  };
  const draft = {
    id: "d1",
    partyId: "v1",
    ownerId: "p-alex",
    ownerName: "Alex",
    revision: 1,
    lines: [{ ...beer, id: "dl-1", quantity: "1.000", unavailable: false }],
  };

  it("listDrafts and saveDraft hand a caller's abort signal to fetch", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ drafts: [] }))
      .mockResolvedValueOnce(jsonResponse(draft));
    const api = new TillApi("", fetchStub);
    const signal = new AbortController().signal;

    await api.listDrafts("v1", { signal });
    await api.saveDraft("v1", { draftId: null, revision: 0, lines: [beer] }, { signal });

    expect(fetchStub.mock.calls.map(([, init]) => init?.signal)).toEqual([signal, signal]);
  });

  it("listDrafts GETs every open draft on the party and answers the list", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ drafts: [draft] }));

    await expect(new TillApi("", fetchStub).listDrafts("v1")).resolves.toEqual([draft]);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/drafts",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("saveDraft PUTs a new draft as draftId null at revision 0, and answers the saved draft", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(draft));

    await expect(
      new TillApi("", fetchStub).saveDraft("v1", { draftId: null, revision: 0, lines: [beer] }),
    ).resolves.toEqual(draft);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/drafts",
      send("PUT", { draftId: null, revision: 0, lines: [beer] }),
    );
  });

  it("saveDraft PUTs an existing draft's id and the revision it was read at", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ ...draft, revision: 2 }));

    await new TillApi("", fetchStub).saveDraft("v1", { draftId: "d1", revision: 1, lines: [] });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/drafts",
      send("PUT", { draftId: "d1", revision: 1, lines: [] }),
    );
  });

  it("saveDraft surfaces a takeover with the new owner's id and name", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "draft.taken_over",
            params: { draftId: "d1", ownerId: "p-sam", ownerName: "Sam" },
          },
        },
        409,
      ),
    );

    await expect(
      new TillApi("", fetchStub).saveDraft("v1", { draftId: "d1", revision: 1, lines: [beer] }),
    ).rejects.toEqual({
      code: "draft.taken_over",
      status: 409,
      draftId: "d1",
      ownerId: "p-sam",
      ownerName: "Sam",
    });
  });

  it("saveDraft surfaces a stale revision with the draft's current one", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "draft.out_of_date", params: { draftId: "d1", revision: 3 } } },
          409,
        ),
      );

    await expect(
      new TillApi("", fetchStub).saveDraft("v1", { draftId: null, revision: 0, lines: [beer] }),
    ).rejects.toEqual({ code: "draft.out_of_date", status: 409, draftId: "d1", revision: 3 });
  });

  it("takeOverDraft POSTs the revision it read to the draft's /take-over route and answers the draft now held", async () => {
    const taken = { ...draft, ownerId: "p-sam", ownerName: "Sam", revision: 2 };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(taken));

    await expect(new TillApi("", fetchStub).takeOverDraft("v1", "d1", 1)).resolves.toEqual(taken);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/drafts/d1/take-over",
      send("POST", { revision: 1 }),
    );
  });

  it("takeOverDraft hands a caller's abort signal to fetch", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(draft));
    const signal = new AbortController().signal;

    await new TillApi("", fetchStub).takeOverDraft("v1", "d1", 1, { signal });

    expect(fetchStub.mock.calls[0]![1]?.signal).toBe(signal);
  });

  it("submitDraft POSTs the submission, both revisions and each group's line ids, and answers the groups and what is left", async () => {
    const answer = {
      tabId: "wo-1",
      revision: 5,
      groups: [
        {
          id: "g1",
          position: 1,
          state: "fired",
          firedAt: "2026-09-28T10:00:00.000Z",
          remindAt: null,
          lineIds: ["l1"],
          summary: "1 × Caña",
        },
      ],
      draft: null,
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));
    const body = {
      submissionId: "sub-1",
      expectedPartyRevision: 4,
      draftRevision: 2,
      groups: [
        { lineIds: ["dl-1"], release: "fire" as const },
        { lineIds: ["dl-2", "dl-3"], release: "hold" as const },
      ],
    };

    await expect(new TillApi("", fetchStub).submitDraft("v1", "d1", body)).resolves.toEqual(answer);

    expect(fetchStub).toHaveBeenCalledWith("/api/parties/v1/drafts/d1/submit", send("POST", body));
  });

  it("submitDraft sends joinGroupId when adding to a held group, and the caller's abort signal", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ tabId: "wo-1", revision: 6, groups: [], draft }));
    const body = {
      submissionId: "sub-2",
      expectedPartyRevision: 5,
      draftRevision: 3,
      groups: [{ lineIds: ["dl-1"], release: "hold" as const }],
      joinGroupId: "g2",
    };
    const signal = new AbortController().signal;

    await new TillApi("", fetchStub).submitDraft("v1", "d1", body, { signal });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/drafts/d1/submit",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body), signal }),
    );
  });

  it("submitDraft sends the bill the lines go on when the person chose one", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ tabId: "wo-2", revision: 6, groups: [], draft: null }));
    const body = {
      submissionId: "sub-3",
      expectedPartyRevision: 5,
      draftRevision: 3,
      groups: [{ lineIds: ["dl-1"], release: "fire" as const }],
      billId: "wo-2",
    };

    await new TillApi("", fetchStub).submitDraft("v1", "d1", body);

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/parties/v1/drafts/d1/submit",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
    );
  });

  it("submitDraft surfaces a stale party as { code }", async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "party.out_of_date" } }, 409));

    await expect(
      new TillApi("", fetchStub).submitDraft("v1", "d1", {
        submissionId: "sub-3",
        expectedPartyRevision: 1,
        draftRevision: 2,
        groups: [{ lineIds: ["dl-1"], release: "fire" }],
      }),
    ).rejects.toMatchObject({ code: "party.out_of_date", status: 409 });
  });
});

describe("isNetworkFailure", () => {
  it("is true for a fetch TypeError or an AbortError, false for a server {code}", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isNetworkFailure({ code: "sale.empty_basket" })).toBe(false);
    expect(isNetworkFailure(new Error("x"))).toBe(false);
  });
});

type LiveModifier = TillMenuOffer["offeredModifiers"][number];

describe("menuOfferToTillProduct", () => {
  it("carries the offer's ordered lists through, in the order they arrive", () => {
    // The order IS the product's own attachment order. Three different texts per name, so a reader of
    // the wrong one fails.
    const extras: LiveModifier = {
      kind: "extras",
      id: "list-extras",
      name: "Extras",
      customerName: { es: "Extras carta" },
      kitchenName: "Extras KDS",
      minPicks: 0,
      maxPicks: 2,
      items: [
        {
          portion: "1",
          unit: {
            name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
            hardwareUnit: null,
            id: "00000000-0000-0000-0000-000000000001",
            abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
            precision: 0,
          },
          productId: "p-bacon",
          name: "Bacon",
          customerName: { es: "Bacon carta" },
          kitchenName: "Bacon KDS",
          price: "1.50",
          vatClass: "general",
          maxQuantity: 1,
          preselected: false,
          addAllergens: null,
          suitableFor: [],
          image: null,
          available: true,
        },
      ],
    };
    const options: LiveModifier = {
      kind: "options",
      id: "list-cooked",
      name: "Punto",
      customerName: { es: "Punto carta" },
      kitchenName: "Punto KDS",
      defaultLabelId: null,
      publishedDefaultLabelId: null,
      labels: [],
    };
    const offer = {
      id: "offer-burger",
      menuId: "menu-1",
      productId: "burger",
      grossPrice: "8.00",
      unitPrice: "8.00",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Burger",
      customerName: { es: "Burger carta" },
      kitchenName: "Burger KDS",
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general" as const,
      category: "Platos",
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [extras, options],
      variants: [],
    };

    expect(menuOfferToTillProduct(offer).offeredModifiers).toEqual([extras, options]);
  });

  it("prices the product at the offer's RESOLVED price, never the stored menu price", () => {
    // A blank menu price is the product's own, which only the server resolves; a set one that the
    // server resolved differently is still the server's answer.
    const offer = {
      id: "offer-burger",
      menuId: "menu-1",
      productId: "burger",
      grossPrice: null,
      unitPrice: "7.25",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Burger",
      customerName: null,
      kitchenName: null,
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general" as const,
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [],
    };
    expect(menuOfferToTillProduct(offer).unitPrice).toBe("7.25");
    expect(menuOfferToTillProduct({ ...offer, grossPrice: "8.00" }).unitPrice).toBe("7.25");
  });

  it("gives each variant the difference between its resolved price and its parent's, null when equal", () => {
    const base = {
      id: "offer-wine",
      menuId: "menu-1",
      productId: "wine",
      grossPrice: null,
      unitPrice: "4.00",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Wine by the glass",
      customerName: null,
      kitchenName: null,
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "reduced" as const,
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
    };
    const variant = (id: string, unitPrice: string) => ({
      id,
      name: id,
      customerName: null,
      kitchenName: null,
      image: null,
      unitPrice,
      menuPrice: null,
      available: true,
      unit: base.unit,
      pricingUnit: "each" as const,
      vatClass: base.vatClass,
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
    });
    const product = menuOfferToTillProduct({
      ...base,
      variants: [variant("dearer", "5.50"), variant("cheaper", "3.50"), variant("same", "4.00")],
    });
    expect(product.variants!.map((v) => [v.id, v.unitPriceDifference])).toEqual([
      ["dearer", "1.50"],
      ["cheaper", "-0.50"],
      ["same", null],
    ]);
  });

  it("carries each variant's own effective selling values, never its parent's", () => {
    // Every value the variant sells under differs from the parent's, so a mapping that read the
    // parent's for any of them fails here.
    const parentUnit = {
      id: "unit-each",
      name: { es: "unidad" },
      abbreviation: { es: "ud" },
      precision: 0,
      hardwareUnit: null,
    };
    const litre = {
      id: "unit-litre",
      name: { es: "litro" },
      abbreviation: { es: "l" },
      precision: 3,
      hardwareUnit: null,
    };
    const product = menuOfferToTillProduct({
      id: "offer-wine",
      menuId: "menu-1",
      productId: "wine",
      grossPrice: null,
      unitPrice: "4.00",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Vino",
      customerName: null,
      kitchenName: null,
      unit: parentUnit,
      vatClass: "general",
      category: "Vinos",
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [
        {
          id: "wine-carafe",
          name: "Jarra",
          customerName: { es: "Jarra carta" },
          kitchenName: "Jarra KDS",
          image: "carafe.webp",
          unitPrice: "9.00",
          menuPrice: "9.00",
          available: true,
          unit: litre,
          pricingUnit: "weight",
          vatClass: "reduced",
          category: "Jarras",
          allergens: { sulphites: { presence: "contains" } },
          diet: { vegan: "yes", vegetarian: "yes", contains: [] },
          dietDerivation: { origins: ["plant"], pending: false },
          dietOverride: { vegan: "yes" },
          dietaryDeclarations: ["vegan"],
          courseId: "course-drinks",
        },
      ],
    });
    expect(product.variants).toEqual([
      {
        id: "wine-carafe",
        name: "Jarra",
        customerName: { es: "Jarra carta" },
        kitchenName: "Jarra KDS",
        image: "carafe.webp",
        unitPrice: "9.00",
        unitPriceDifference: "5.00",
        available: true,
        unit: litre,
        pricingUnit: "weight",
        vatClass: "reduced",
        category: "Jarras",
        allergens: { sulphites: { presence: "contains" } },
        diet: { vegan: "yes", vegetarian: "yes", contains: [] },
        dietDerivation: { origins: ["plant"], pending: false },
        dietOverride: { vegan: "yes" },
        dietaryDeclarations: ["vegan"],
        courseId: "course-drinks",
      },
    ]);
    expect(product).toMatchObject({
      unit: parentUnit,
      vatClass: "general",
      category: "Vinos",
      allergens: null,
      courseId: null,
    });
  });
  it("carries whether the offer can be sold now, and the menu version it came from", () => {
    const offer: TillMenuOffer = {
      id: "offer-burger",
      menuId: "menu-1",
      productId: "burger",
      grossPrice: null,
      unitPrice: "8.00",
      available: false,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Burger",
      customerName: null,
      kitchenName: null,
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [],
    };
    expect(menuOfferToTillProduct(offer, "version-2")).toMatchObject({
      available: false,
      menuVersionId: "version-2",
    });
    expect(menuOfferToTillProduct({ ...offer, available: true })).toMatchObject({
      available: true,
    });
    expect(menuOfferToTillProduct(offer)).not.toHaveProperty("menuVersionId");
  });

  // The menu browser hides a product by this value, so each of the three must arrive as sent.
  it("carries who may order the offer on its own, and nothing when the offer carries none", () => {
    const offer: TillMenuOffer = {
      id: "offer-bacon",
      menuId: "menu-1",
      productId: "bacon",
      grossPrice: null,
      unitPrice: "1.50",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Bacon",
      customerName: { es: "Beicon crujiente" },
      kitchenName: "BCN",
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [],
    };
    for (const ordering of ["public", "staff_only", "not_sold_separately"] as const)
      expect(menuOfferToTillProduct({ ...offer, ordering }).ordering).toBe(ordering);
    expect(menuOfferToTillProduct(offer)).not.toHaveProperty("ordering");
  });

  it("carries the offer's colour, null included, and nothing when the offer carries none", () => {
    const offer: TillMenuOffer = {
      id: "offer-beer",
      menuId: "menu-1",
      productId: "beer",
      grossPrice: null,
      unitPrice: "3.00",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Beer",
      customerName: null,
      kitchenName: null,
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [],
    };
    expect(menuOfferToTillProduct({ ...offer, color: "#256bb1" })).toHaveProperty(
      "color",
      "#256bb1",
    );
    expect(menuOfferToTillProduct({ ...offer, color: null })).toHaveProperty("color", null);
    expect(menuOfferToTillProduct(offer)).not.toHaveProperty("color");
  });

  it("carries the offer's photo, null included", () => {
    const offer: TillMenuOffer = {
      id: "offer-cafe",
      menuId: "menu-1",
      productId: "cafe",
      grossPrice: null,
      unitPrice: "1.50",
      available: true,
      image: "cafe.webp",
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Café",
      customerName: null,
      kitchenName: null,
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [],
    };
    expect(menuOfferToTillProduct(offer)).toHaveProperty("image", "cafe.webp");
    expect(menuOfferToTillProduct({ ...offer, image: null })).toHaveProperty("image", null);
  });

  it("offers the picker only the extras items and option labels that can be sold now", () => {
    const item = (productId: string, available: boolean) => ({
      portion: "1",
      unit: {
        name: { en: "Each", es: "Unidad", ca: "Unitat", eu: "Unitatea", gl: "Unidade" },
        hardwareUnit: null,
        id: "00000000-0000-0000-0000-000000000001",
        abbreviation: { en: "ea", es: "ud", ca: "u", eu: "u", gl: "u" },
        precision: 0,
      },
      productId,
      name: productId,
      customerName: null,
      kitchenName: null,
      price: "1.00",
      vatClass: "general" as const,
      maxQuantity: 1,
      preselected: false,
      addAllergens: null,
      suitableFor: [],
      image: null,
      available,
    });
    const label = (id: string, available: boolean) => ({
      id,
      name: id,
      customerName: null,
      kitchenName: null,
      available,
    });
    const product = menuOfferToTillProduct({
      id: "offer-burger",
      menuId: "menu-1",
      productId: "burger",
      grossPrice: null,
      unitPrice: "8.00",
      available: true,
      image: null,
      description: null,
      menuName: "Carta",
      placements: [[]],
      name: "Burger",
      customerName: null,
      kitchenName: null,
      unit: {
        id: "unit-each",
        name: { es: "unidad" },
        abbreviation: { es: "ud" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [
        {
          kind: "extras",
          id: "list-extras",
          name: "Extras",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: null,
          items: [item("bacon", false), item("cheese", true)],
        },
        {
          kind: "options",
          id: "list-cooked",
          name: "Punto",
          customerName: null,
          kitchenName: null,
          defaultLabelId: "label-medium",
          publishedDefaultLabelId: "label-medium",
          labels: [label("label-rare", false), label("label-medium", true)],
        },
      ],
      variants: [],
    });
    const [extras, options] = product.offeredModifiers!;
    expect(extras!.kind === "extras" && extras!.items.map((i) => i.productId)).toEqual(["cheese"]);
    expect(options!.kind === "options" && options!.labels.map((l) => l.id)).toEqual([
      "label-medium",
    ]);
  });
});

describe("TillApi: a bill's payments", () => {
  const post = (body: unknown) =>
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // A €30.00 bill with one €10.00 cash payment from a €20.00 note, as `GET …/payments` answers it.
  const cashPayment: BillPaymentView = {
    id: "pay-1",
    submissionId: "sub-1",
    kind: "contribution",
    shareOf: null,
    method: "cash",
    entry: null,
    applied: "10.00",
    tip: "0.00",
    tendered: "20.00",
    change: "10.00",
    state: "received",
    createdAt: "2026-09-30T20:00:00.000Z",
    receivedAt: "2026-09-30T20:00:00.000Z",
    lines: [],
    refunds: [],
  };
  const balance: BillBalance = {
    workingOrderId: "wo-1",
    status: "open",
    total: "30.00",
    received: "10.00",
    reserved: "0.00",
    outstanding: "20.00",
    tips: "0.00",
    payments: [cashPayment],
    paidLines: [{ lineId: "line-2", lineNo: 2, paidQuantity: "1.000" }],
  };

  it("getBillBalance GETs the bill's payments and answers its balance", async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(balance));
    const signal = new AbortController().signal;

    await expect(new TillApi("", fetchStub).getBillBalance("wo-1", { signal })).resolves.toEqual(
      balance,
    );
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/payments",
      expect.objectContaining({ method: "GET", credentials: "include", signal }),
    );
  });

  it("previewBillPayment POSTs the ask to the preview route and answers the choices the server offers", async () => {
    const ask: BillPaymentAsk = { kind: "items", lines: [{ lineNo: 1 }], method: "card" };
    const preview: AllocationPreview = {
      kind: "choose",
      options: [
        { choice: "full_with_tip", applied: "15.00", tip: "10.00" },
        { choice: "use_pool", applied: "15.00", tip: "0.00" },
      ],
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(preview));

    await expect(new TillApi("", fetchStub).previewBillPayment("wo-1", ask)).resolves.toEqual(
      preview,
    );
    expect(fetchStub).toHaveBeenCalledWith("/api/working-orders/wo-1/payments/preview", post(ask));
  });

  it("takeBillPayment POSTs the request under the caller's signal and answers the outcome, balance and invoice", async () => {
    const request: BillPaymentRequest = {
      kind: "share",
      shareOf: 2,
      method: "card",
      entry: "manual",
      externalRef: "OP-9",
      submissionId: "sub-2",
      applied: "10.00",
      tip: "0.00",
    };
    const answer: BillPaymentResult = {
      outcome: "received",
      payment: { ...cashPayment, id: "pay-2", method: "card", tendered: null, change: null },
      balance: { ...balance, received: "20.00", outstanding: "10.00" },
      invoice: {
        orderLabel: "Mesa 4",
        orderNumber: 7,
        invoiceNumber: "A/9",
        issuedAt: "2026-09-30T20:01:00.000Z",
        total: "30.00",
        vatBreakdown: [],
        lines: [],
        tender: { method: "cash", change: "10.00" },
        payments: [
          {
            method: "cash",
            amount: "10.00",
            tip: "0.00",
            tendered: "20.00",
            change: "10.00",
            refunds: [],
          },
          { method: "card", amount: "10.00", tip: "0.00", reference: "OP-9", refunds: [] },
        ],
        qr: "x",
      },
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));
    const signal = new AbortController().signal;

    await expect(
      new TillApi("", fetchStub).takeBillPayment("wo-1", request, { signal }),
    ).resolves.toEqual(answer);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/payments",
      expect.objectContaining({ method: "POST", body: JSON.stringify(request), signal }),
    );
  });

  it("takeBillPayment surfaces a stale allocation's fresh preview on the refusal", async () => {
    const fresh = {
      kind: "allocated",
      choice: null,
      applied: "25.00",
      tip: "0.00",
      change: "5.00",
      charged: null,
    };
    const fetchStub = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "bill.allocation_changed",
            params: { workingOrderId: "wo-1", preview: fresh },
          },
        },
        409,
      ),
    );

    await expect(
      new TillApi("", fetchStub).takeBillPayment("wo-1", {
        kind: "contribution",
        amount: "30.00",
        method: "cash",
        tendered: "30.00",
        submissionId: "sub-3",
        applied: "30.00",
        tip: "0.00",
      }),
    ).rejects.toEqual({
      code: "bill.allocation_changed",
      workingOrderId: "wo-1",
      preview: fresh,
      status: 409,
    });
  });

  it("refundBillPayment POSTs the refund to the payment's refunds route and answers the refund and balance", async () => {
    const refund: BillRefundRequest = {
      submissionId: "sub-4",
      appliedAmount: "10.00",
      tipAmount: "0.00",
      reason: "Wrong table",
      override: { personId: "m-1", pin: "7777" },
    };
    const answer: BillRefundResult = {
      refund: {
        id: "ref-1",
        paymentId: "pay-1",
        submissionId: "sub-4",
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Wrong table",
        state: "completed",
        createdAt: "2026-09-30T20:05:00.000Z",
        completedAt: "2026-09-30T20:05:00.000Z",
      },
      balance: { ...balance, received: "0.00", outstanding: "30.00" },
    };
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(answer));

    await expect(
      new TillApi("", fetchStub).refundBillPayment("wo-1", "pay-1", refund),
    ).resolves.toEqual(answer);
    expect(fetchStub).toHaveBeenCalledWith(
      "/api/working-orders/wo-1/payments/pay-1/refunds",
      post(refund),
    );
  });
});
