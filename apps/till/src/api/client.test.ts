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
  it("recordSale POSTs lines+tender with credentials and returns the ticket payload", async () => {
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

    const result = await api.recordSale([{ productId: "p", quantity: "2" }], {
      method: "cash",
      amount: "5.00",
    });

    expect(fetchStub).toHaveBeenCalledWith(
      "/api/sales",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [{ productId: "p", quantity: "2" }],
          tender: { method: "cash", amount: "5.00" },
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
    const info = { locale: "es-ES", venueName: "Deli", nif: "B12345678" };
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
      .mockResolvedValue(jsonResponse({ locale: "es-ES", venueName: "D", nif: "N" }));

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
});
