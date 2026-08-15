import { describe, expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
import type { LayoutDef, ReceiptConfig } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/**
 * An empty 204 — `text()` → "" — the shape the void-returning management routes answer with
 * (`logout`, `updatePerson`, `resetPin`, `setPassword`; `c.body(null, 204)` in
 * `apps/server/src/management-api.ts`). Exercises `#request`'s empty-body branch, which resolves
 * `undefined` instead of `JSON.parse`-ing nothing. `#request` keys off the empty body (`res.ok` +
 * `text() === ""`), not the exact status, so 204 stands in for the real routes.
 */
function emptyResponse(): Response {
  return { ok: true, status: 204, json: async () => undefined, text: async () => "" } as Response;
}

describe("DashboardApi", () => {
  it("posts login credentials with cookies included", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ personId: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    const out = await api.login({ personId: "p1", password: "correct horse" });
    expect(out).toEqual({ personId: "p1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: "p1", password: "correct horse" }),
    });
  });

  it("throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "password.invalid" } }, false, 401));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.login({ personId: "p1", password: "x" })).rejects.toMatchObject({
      code: "password.invalid",
    });
  });

  it("lists staff with credentials", async () => {
    const roster = [
      {
        personId: "p1",
        displayName: "Ada",
        role: "manager",
        status: "active",
        hasPassword: true,
        hasTotp: false,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(roster));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listStaff()).toEqual(roster);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff", {
      method: "GET",
      credentials: "include",
    });
  });

  it("getStaffRoster GETs the pre-login roster with credentials", async () => {
    const roster = [{ personId: "p1", displayName: "Ada" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(roster));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getStaffRoster()).toEqual(roster);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff-roster", {
      method: "GET",
      credentials: "include",
    });
  });

  it("login carries an optional totp when supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ personId: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    await api.login({ personId: "p1", password: "correct horse", totp: "123456" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personId: "p1", password: "correct horse", totp: "123456" }),
    });
  });

  it("logout DELETEs the session and resolves undefined on an empty 204 body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.logout()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("createPerson POSTs the new person and returns its id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "p2" }));
    const api = new DashboardApi("", fetchImpl);
    const out = await api.createPerson({ displayName: "Bea", role: "staff", pin: "4321" });
    expect(out).toEqual({ id: "p2" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Bea", role: "staff", pin: "4321" }),
    });
  });

  it("updatePerson PATCHes the addressed person (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updatePerson("p1", { role: "supervisor", status: "suspended" }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "supervisor", status: "suspended" }),
    });
  });

  it("resetPin POSTs the new pin to the addressed person's reset-pin route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.resetPin("p1", "9999")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1/reset-pin", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "9999" }),
    });
  });

  it("setPassword POSTs the new password to the addressed person's password route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setPassword("p1", "hunter2 correct horse")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1/password", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "hunter2 correct horse" }),
    });
  });

  it("passkeyRegisterOptions POSTs the register/options route with credentials and no body", async () => {
    const payload = {
      challengeHandle: "ch-1",
      options: { challenge: "abc", rp: { id: "localhost" } },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.passkeyRegisterOptions()).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/passkey/register/options", {
      method: "POST",
      credentials: "include",
    });
  });

  it("passkeyRegisterVerify POSTs the handle + signed response to the register/verify route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ credentialId: "cred-1" }));
    const api = new DashboardApi("", fetchImpl);
    const body = { challengeHandle: "ch-1", response: { id: "cred-1", rawId: "raw" } };
    expect(await api.passkeyRegisterVerify(body)).toEqual({ credentialId: "cred-1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/passkey/register/verify", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("passkeyAuthOptions POSTs the auth/options route with credentials and no body", async () => {
    const payload = { challengeHandle: "ch-2", options: { challenge: "def" } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.passkeyAuthOptions()).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/passkey/auth/options", {
      method: "POST",
      credentials: "include",
    });
  });

  it("passkeyAuthVerify POSTs the handle + signed assertion to auth/verify and returns the person id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ personId: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    const body = { challengeHandle: "ch-2", response: { id: "cred-1", rawId: "raw" } };
    expect(await api.passkeyAuthVerify(body)).toEqual({ personId: "p1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/passkey/auth/verify", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("listCatalogues GETs the catalogues with credentials", async () => {
    const catalogues = [{ id: "c1", name: "Almuerzo", active: true, version: 1 }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(catalogues));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listCatalogues()).toEqual(catalogues);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/catalogues", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createCatalogue POSTs the name and returns the created catalogue", async () => {
    const created = { id: "c2", name: "Cena", active: true, version: 1 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createCatalogue("Cena")).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/catalogues", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cena" }),
    });
  });

  it("listCategories GETs the categories with credentials", async () => {
    const categories = [{ id: "cat1", name: "Entrantes" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(categories));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listCategories()).toEqual(categories);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/categories", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createCategory POSTs the name and returns the created category", async () => {
    const created = { id: "cat2", name: "Principales" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createCategory("Principales")).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/categories", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Principales" }),
    });
  });

  it("listProducts GETs the addressed catalogue's products with credentials", async () => {
    const products = [
      {
        id: "p1",
        catalogueId: "c1",
        categoryId: null,
        descriptions: { es: "Café solo" },
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
        active: true,
        allergens: null,
        image: null,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(products));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listProducts("c1")).toEqual(products);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/catalogues/c1/products", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createProduct POSTs the input body and returns the created product", async () => {
    const input = {
      catalogueId: "c1",
      categoryId: "cat1",
      descriptions: { es: "Tarta de queso" },
      pricingUnit: "each" as const,
      unitPrice: "4.00",
      vatClass: "reduced" as const,
      allergens: { gluten: { presence: "contains" as const, source: "trigo" } },
      image: "deadbeef.png",
    };
    const created = { id: "p9", ...input, active: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createProduct(input)).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateProduct PATCHes the addressed product's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateProduct("p1", { unitPrice: "2.00", active: false, image: null }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitPrice: "2.00", active: false, image: null }),
    });
  });

  it("uploadImage POSTs a multipart FormData file part with no JSON content-type and returns { image }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ image: "deadbeef.png" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", {
      type: "image/png",
    });
    expect(await api.uploadImage(file)).toEqual({ image: "deadbeef.png" });
    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("/management-api/product-images");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    // The body is the multipart FormData carrying the file part…
    expect(init.body).toBeInstanceOf(FormData);
    const part = (init.body as FormData).get("file");
    expect(part).toBeInstanceOf(File);
    expect((part as File).name).toBe("photo.png");
    // …and NO JSON content-type is set: the browser derives `multipart/form-data` and appends the
    // boundary itself; a manual content-type would drop the boundary and corrupt the upload.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
  });

  it("uploadImage throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "media.unsupported_type" } }, false, 415));
    const api = new DashboardApi("", fetchImpl);
    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    await expect(api.uploadImage(file)).rejects.toMatchObject({ code: "media.unsupported_type" });
  });

  it("getLayout GETs the layout + receipt with credentials", async () => {
    const payload = {
      definition: [
        { type: "product-grid", region: "main", config: {} },
        { type: "basket", region: "aside", config: {} },
      ],
      receipt: { headerSubtitle: "C/ Mayor 1", footerMessage: "Gracias" },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getLayout()).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/layout", {
      method: "GET",
      credentials: "include",
    });
  });

  it("putLayout PUTs the definition body and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const definition: LayoutDef = [
      { type: "product-grid", region: "main", config: { columns: 4 } },
      { type: "basket", region: "aside", config: {} },
      { type: "total", region: "aside", config: {} },
      { type: "tender-pay", region: "aside", config: {} },
    ];
    await expect(api.putLayout(definition)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/layout", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ definition }),
    });
  });

  it("putReceipt PUTs the receipt body and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const receipt: ReceiptConfig = {
      headerSubtitle: "C/ Mayor 1",
      footerMessage: "Gracias por su visita",
    };
    await expect(api.putReceipt(receipt)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/receipt", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receipt }),
    });
  });

  it("putLayout throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "layout.invalid" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.putLayout([])).rejects.toMatchObject({ code: "layout.invalid" });
  });

  it("putReceipt throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "receipt.invalid" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.putReceipt({ footerMessage: "x" })).rejects.toMatchObject({
      code: "receipt.invalid",
    });
  });

  it("falls back to server.internal when the error body carries no code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.listStaff()).rejects.toMatchObject({ code: "server.internal" });
  });

  it("prefixes every path with the configured baseUrl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = new DashboardApi("https://dash.example", fetchImpl);
    await api.listStaff();
    expect(fetchImpl).toHaveBeenCalledWith("https://dash.example/management-api/staff", {
      method: "GET",
      credentials: "include",
    });
  });

  it("defaults baseUrl to '' and fetchImpl to the global fetch", () => {
    // Exercises the constructor's default parameter initializers with no network call.
    expect(() => new DashboardApi()).not.toThrow();
  });
});

describe("DashboardApi — roster", () => {
  it("getRoster GETs the snapshot with the location + period query", async () => {
    const snapshot = { version: null, shifts: [] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getRoster("loc-1", "2026-03-02")).toEqual(snapshot);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/roster?locationId=loc-1&period=2026-03-02",
      {
        method: "GET",
        credentials: "include",
      },
    );
  });

  it("createRosterVersion POSTs { locationId, period }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ versionId: "v1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createRosterVersion("loc-1", "2026-03-02")).toEqual({ versionId: "v1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationId: "loc-1", period: "2026-03-02" }),
    });
  });

  it("addShift POSTs the shift under the version and returns { shiftId }", async () => {
    const input = {
      personId: "p1",
      locationId: "loc-1",
      startsAt: "2026-03-02T09:00:00Z",
      startsOffsetMinutes: 0,
      endsAt: "2026-03-02T13:00:00Z",
      endsOffsetMinutes: 0,
      role: null,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ shiftId: "s1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.addShift("v1", input)).toEqual({ shiftId: "s1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster/v1/shifts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateShift PATCHes and removeShift DELETEs (both 204 → void)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.updateShift("s1", { role: "bar" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster/shifts/s1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "bar" }),
    });
    await api.removeShift("s1");
    expect(fetchImpl).toHaveBeenLastCalledWith("/management-api/roster/shifts/s1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("publishRoster POSTs and returns { breaches }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        breaches: [{ kind: "night_work", personId: "p1", shiftId: "s1", nightMinutes: 120 }],
      }),
    );
    const api = new DashboardApi("", fetchImpl);
    const out = await api.publishRoster("v1");
    expect(out.breaches[0]!.kind).toBe("night_work");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/roster/v1/publish", {
      method: "POST",
      credentials: "include",
    });
  });

  it("getLocations GETs the location list", async () => {
    const locs = [{ id: "loc-1", name: "Main" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(locs));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getLocations()).toEqual(locs);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations", {
      method: "GET",
      credentials: "include",
    });
  });
});

describe("DashboardApi — approvals", () => {
  it("listPendingSwaps GETs /management-api/swaps with credentials", async () => {
    const rows = [
      {
        id: "sw1",
        requestedByPersonId: "p1",
        fromShiftId: "s1",
        toPersonId: "p2",
        toShiftId: null,
        status: "accepted",
        createdAt: "2026-03-02T00:00:00Z",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPendingSwaps()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/swaps", {
      method: "GET",
      credentials: "include",
    });
  });

  it("decideSwap POSTs the decision and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.decideSwap("sw1", "approved")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/swaps/sw1/decide", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
  });

  it("listPendingAbsences GETs /management-api/absences with credentials", async () => {
    const rows = [
      {
        id: "ab1",
        personId: "p1",
        kind: "holiday",
        startsOn: "2026-03-02",
        endsOn: "2026-03-04",
        status: "requested",
        note: null,
        createdAt: "2026-03-02T00:00:00Z",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPendingAbsences()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/absences", {
      method: "GET",
      credentials: "include",
    });
  });

  it("decideAbsence POSTs the decision to the absences decide route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.decideAbsence("ab1", "rejected")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/absences/ab1/decide", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "rejected" }),
    });
  });
});
