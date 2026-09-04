import { describe, expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
import type { ReceiptConfig } from "./client.js";

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
    const out = await api.login({ email: "owner@x.com", password: "correct horse" });
    expect(out).toEqual({ personId: "p1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@x.com", password: "correct horse" }),
    });
  });

  it("throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "password.invalid" } }, false, 401));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.login({ email: "owner@x.com", password: "x" })).rejects.toMatchObject({
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
        email: "ada@x.com",
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
    await api.login({ email: "owner@x.com", password: "correct horse", totp: "123456" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@x.com", password: "correct horse", totp: "123456" }),
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

  it("createPerson carries an optional email when supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "p2" }));
    const api = new DashboardApi("", fetchImpl);
    await api.createPerson({
      displayName: "Bea",
      role: "staff",
      pin: "4321",
      email: "bea@x.com",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Bea", role: "staff", pin: "4321", email: "bea@x.com" }),
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

  it("updatePerson carries an email in the PATCH body when supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updatePerson("p1", { email: "new@x.com" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@x.com" }),
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

  it("listLocationCatalogues GETs a location's menu membership with credentials", async () => {
    const rows = [
      { id: "c1", name: "Casa", active: true, version: 1, sellable: true, isDefault: true },
      { id: "c2", name: "Día", active: true, version: 1, sellable: false, isDefault: false },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listLocationCatalogues("loc1")).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations/loc1/catalogues", {
      method: "GET",
      credentials: "include",
    });
  });

  it("addLocationCatalogue POSTs a catalogueId to the location's accessible set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.addLocationCatalogue("loc1", "c2");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations/loc1/catalogues", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogueId: "c2" }),
    });
  });

  it("removeLocationCatalogue DELETEs a catalogue from the location's accessible set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.removeLocationCatalogue("loc1", "c2");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations/loc1/catalogues/c2", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("setLocationDefaultCatalogue PUTs the default catalogueId for the location", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.setLocationDefaultCatalogue("loc1", "c2");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations/loc1/default-catalogue", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogueId: "c2" }),
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

  it("getReceipt GETs the receipt trim with credentials", async () => {
    const payload = { receipt: { headerSubtitle: "C/ Mayor 1", footerMessage: "Gracias" } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getReceipt()).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/receipt", {
      method: "GET",
      credentials: "include",
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

  it("putReceipt throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "receipt.invalid" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.putReceipt({ footerMessage: "x" })).rejects.toMatchObject({
      code: "receipt.invalid",
    });
  });

  it("listStatuses GETs /management-api/service-statuses with credentials", async () => {
    const rows = [
      {
        id: "s1",
        label: "Bill requested",
        color: "#ef4444",
        displayOrder: 0,
        active: true,
        createdAt: "2026-08-17T00:00:00Z",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listStatuses()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/service-statuses", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createStatus POSTs the body and returns the id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "s1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const res = await api.createStatus({
      label: "Bill requested",
      color: "#ef4444",
      displayOrder: 0,
    });
    expect(res).toEqual({ id: "s1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/service-statuses", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Bill requested", color: "#ef4444", displayOrder: 0 }),
    });
  });

  it("updateStatus PATCHes the addressed status's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateStatus("s1", {
        label: "Bill please",
        color: "#22c55e",
        displayOrder: 2,
        active: false,
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/service-statuses/s1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Bill please",
        color: "#22c55e",
        displayOrder: 2,
        active: false,
      }),
    });
  });

  it("deactivateStatus DELETEs the status and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deactivateStatus("s1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/service-statuses/s1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("createStatus rejects with { code } on a non-2xx (label already taken)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "status.label_taken" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createStatus({ label: "x", color: "#000" })).rejects.toMatchObject({
      code: "status.label_taken",
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

describe("DashboardApi — planned vs actual", () => {
  it("getPlannedVsActual GETs the planned-vs-actual route with locationId/from/to", async () => {
    const rows = [
      {
        personId: "p1",
        workDate: "2026-03-02",
        plannedMinutes: 240,
        workedMinutes: 225,
        lateMinutes: 15,
        noShow: false,
        unplanned: false,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getPlannedVsActual("loc-1", "2026-03-02", "2026-03-09")).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/planned-vs-actual?locationId=loc-1&from=2026-03-02&to=2026-03-09",
      { method: "GET", credentials: "include" },
    );
  });
});

describe("DashboardApi — whoami + my schedule (staff self-service)", () => {
  it("getMe GETs the whoami route and returns { personId, role, locale, venueLocale }", async () => {
    // Per-user-language-preference (Task 5): the whoami now also carries the signed-in person's stored
    // UI `locale` (null when unset) and the geography-derived `venueLocale` fallback.
    const body = { personId: "p1", role: "staff", locale: "en-GB", venueLocale: "es-ES" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getMe()).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session/me", {
      method: "GET",
      credentials: "include",
    });
  });

  it("getMe surfaces a null stored locale for a person with no preference", async () => {
    const body = { personId: "p1", role: "manager", locale: null, venueLocale: "es-ES" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getMe()).toEqual(body);
  });

  it("listMyShifts GETs my shifts over the [from, to) window", async () => {
    const rows = [
      {
        id: "sh1",
        locationId: "loc-1",
        startsAt: "2026-05-04T09:00:00Z",
        startsOffsetMinutes: 0,
        endsAt: "2026-05-04T17:00:00Z",
        endsOffsetMinutes: 0,
        role: "bar",
        rosterVersionId: null,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listMyShifts("2026-05-04", "2026-05-11")).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/me/schedule/shifts?from=2026-05-04&to=2026-05-11",
      { method: "GET", credentials: "include" },
    );
  });

  it("listMySwaps GETs the swaps I'm party to", async () => {
    const rows = [
      {
        id: "sw1",
        requestedByPersonId: "p2",
        fromShiftId: "sh2",
        toPersonId: "p1",
        toShiftId: null,
        status: "requested",
        createdAt: "2026-05-05T00:00:00Z",
        direction: "offered_to_me",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listMySwaps()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/me/schedule/swaps", {
      method: "GET",
      credentials: "include",
    });
  });

  it("requestSwap POSTs a give-away and returns { swapId } — never carries a personId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ swapId: "sw9" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const req = { fromShiftId: "sh1", toPersonId: "p2", toShiftId: null };
    expect(await api.requestSwap(req)).toEqual({ swapId: "sw9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/me/schedule/swaps", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  });

  it("acceptSwap POSTs the accept route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.acceptSwap("sw1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/me/schedule/swaps/sw1/accept", {
      method: "POST",
      credentials: "include",
    });
  });

  it("listMyAbsences GETs my absences (any status)", async () => {
    const rows = [
      {
        id: "ab1",
        personId: "p1",
        kind: "holiday",
        startsOn: "2026-06-01",
        endsOn: "2026-06-03",
        status: "requested",
        note: null,
        createdAt: "2026-06-01T00:00:00Z",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listMyAbsences()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/me/schedule/absences", {
      method: "GET",
      credentials: "include",
    });
  });

  it("requestAbsence POSTs the request and returns { absenceId } — never carries a personId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ absenceId: "ab9" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const req = {
      kind: "holiday" as const,
      startsOn: "2026-07-01",
      endsOn: "2026-07-05",
      note: "Away",
    };
    expect(await api.requestAbsence(req)).toEqual({ absenceId: "ab9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/me/schedule/absences", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  });

  it("requestSwap throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "swap.not_permitted" } }, false, 403));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.requestSwap({ fromShiftId: "sh1", toPersonId: "p2", toShiftId: null }),
    ).rejects.toMatchObject({ code: "swap.not_permitted" });
  });
});

describe("DashboardApi — purchase invoices", () => {
  const invoice = {
    id: "pi-1",
    supplierTaxId: "B12345678",
    supplierName: "Distribuciones García SL",
    supplierInvoiceNumber: "F-2026/001",
    issuedOn: "2026-08-10",
    receivedOn: "2026-08-12",
    total: "121.00",
    regime: "general",
    deductibleProportion: "100.00",
    note: null,
    lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" }],
  };

  it("listPurchaseInvoices GETs the collection with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([invoice]));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPurchaseInvoices()).toEqual([invoice]);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/purchase-invoices", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createPurchaseInvoice POSTs the header + lines and returns the created invoice (201)", async () => {
    const input = {
      header: {
        supplierTaxId: "B12345678",
        supplierName: "Distribuciones García SL",
        supplierInvoiceNumber: "F-2026/001",
        issuedOn: "2026-08-10",
        receivedOn: "2026-08-12",
        total: "121.00",
        regime: "general" as const,
        deductibleProportion: "100.00",
        note: null,
      },
      lines: [{ rate: "21.00", base: "100.00", tax: "21.00", kind: "ordinary" as const }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(invoice, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createPurchaseInvoice(input)).toEqual(invoice);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/purchase-invoices", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updatePurchaseInvoice PATCHes the header + lines and resolves undefined on a 204", async () => {
    const patch = {
      header: { supplierName: "Nombre corregido", total: "242.00" },
      lines: [{ rate: "10.00", base: "100.00", tax: "10.00", kind: "capital" as const }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updatePurchaseInvoice("pi-1", patch)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/purchase-invoices/pi-1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  });

  it("deletePurchaseInvoice DELETEs the invoice and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deletePurchaseInvoice("pi-1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/purchase-invoices/pi-1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("rejects with the envelope code on a duplicate (409)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "purchase.duplicate" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.createPurchaseInvoice({
        header: {
          supplierTaxId: "B1",
          supplierName: "X",
          supplierInvoiceNumber: "DUP",
          issuedOn: "2026-08-10",
          receivedOn: "2026-08-12",
          total: "0.00",
        },
        lines: [{ rate: "0.00", base: "0.00", tax: "0.00" }],
      }),
    ).rejects.toMatchObject({ code: "purchase.duplicate" });
  });
});

describe("DashboardApi — bookings", () => {
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
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listBookings("2026-08-20")).toEqual([booking]);
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
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createBooking(input)).toEqual({ id: "bk-1" });
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
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateBooking("bk-1", patch)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  });

  it("seatBooking POSTs the optional table and returns { tabId }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tabId: "tab-9" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.seatBooking("bk-1", { tableId: "t-1" })).toEqual({ tabId: "tab-9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/seat", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableId: "t-1" }),
    });
  });

  it("seatBooking POSTs an empty body when no table is passed (reuse the booking's own table)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ tabId: "tab-9" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.seatBooking("bk-1")).toEqual({ tabId: "tab-9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/seat", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("cancelBooking POSTs .../cancel and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.cancelBooking("bk-1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/cancel", {
      method: "POST",
      credentials: "include",
    });
  });

  it("markNoShow POSTs .../no-show and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.markNoShow("bk-1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/no-show", {
      method: "POST",
      credentials: "include",
    });
  });

  it("completeBooking POSTs .../complete and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.completeBooking("bk-1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bookings/bk-1/complete", {
      method: "POST",
      credentials: "include",
    });
  });

  it("rejects with the envelope code when the table is busy (tab.already_open)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "tab.already_open" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.seatBooking("bk-1", { tableId: "t-1" })).rejects.toMatchObject({
      code: "tab.already_open",
    });
  });
});

describe("DashboardApi — ingredients + product recipe", () => {
  it("listIngredients GETs /management-api/ingredients with credentials", async () => {
    const rows = [
      { id: "i1", name: "alioli", allergens: { eggs: { presence: "contains" } }, active: true },
      { id: "i2", name: "pan", allergens: null, active: true },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listIngredients()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/ingredients", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createIngredient POSTs /management-api/ingredients and returns the created ingredient (201)", async () => {
    const created = { id: "i1", name: "alioli", allergens: null, active: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const out = await api.createIngredient({ name: "alioli" });
    expect(out).toEqual(created);
    expect(out.name).toBe("alioli");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/ingredients", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alioli" }),
    });
  });

  it("createIngredient carries an allergens map when supplied", async () => {
    const input = { name: "mahonesa", allergens: { eggs: { presence: "contains" as const } } };
    const created = { id: "i3", ...input, active: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createIngredient(input)).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/ingredients", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateIngredient PATCHes /management-api/ingredients/:id (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateIngredient("i1", { name: "alioli casero", allergens: null, active: false }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/ingredients/i1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alioli casero", allergens: null, active: false }),
    });
  });

  it("getProductRecipe GETs /management-api/products/:id/recipe with credentials", async () => {
    const lines = [
      { id: "i1", name: "alioli", allergens: { eggs: { presence: "contains" } }, active: true },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(lines));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getProductRecipe("p1")).toEqual(lines);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/recipe", {
      method: "GET",
      credentials: "include",
    });
  });

  it("setProductRecipe PUTs /management-api/products/:id/recipe with ingredientIds (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setProductRecipe("p1", ["i1", "i2"])).resolves.toBeUndefined();
    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe("/management-api/products/p1/recipe");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string)).toEqual({ ingredientIds: ["i1", "i2"] });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/recipe", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ingredientIds: ["i1", "i2"] }),
    });
  });

  it("createIngredient throws the envelope code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "allergen.invalid_code" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createIngredient({ name: "x" })).rejects.toMatchObject({
      code: "allergen.invalid_code",
    });
  });
});

describe("DashboardApi — floor plan (zones + tables)", () => {
  // The eight per-item verbs the floor-plan config screen drives (FP-1's /management-api/zones +
  // /management-api/tables routes, till.configure-gated). Mirrors the service-status method tests:
  // GET decodes a list, POST returns the minted id (201), PATCH/DELETE resolve undefined on an
  // empty 204. Paths/bodies asserted against apps/server/src/management-api.ts.

  it("listZones GETs /management-api/zones with credentials", async () => {
    const rows = [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listZones()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/zones", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createZone POSTs { name } and returns the id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "z1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createZone({ name: "Comedor" })).toEqual({ id: "z1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/zones", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Comedor" }),
    });
  });

  it("createZone can carry an optional displayOrder", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "z2" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createZone({ name: "Terraza", displayOrder: 3 })).toEqual({ id: "z2" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/zones", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Terraza", displayOrder: 3 }),
    });
  });

  it("updateZone PATCHes the addressed zone's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateZone("z1", { name: "Salón", displayOrder: 2 })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/zones/z1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Salón", displayOrder: 2 }),
    });
  });

  it("deactivateZone DELETEs the zone and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deactivateZone("z1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/zones/z1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("createZone rejects with { code } on a non-2xx (name already taken)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "zone.name_taken" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createZone({ name: "Comedor" })).rejects.toMatchObject({
      code: "zone.name_taken",
    });
  });

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
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listTables()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createTable POSTs { label } and returns the id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "t1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createTable({ label: "4" })).toEqual({ id: "t1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "4" }),
    });
  });

  it("createTable can carry optional capacity + zoneId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "t2" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createTable({ label: "5", capacity: 4, zoneId: "z1" })).toEqual({ id: "t2" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "5", capacity: 4, zoneId: "z1" }),
    });
  });

  it("updateTable PATCHes only the zoneId when assigning a table's zone (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateTable("t1", { zoneId: "z1" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables/t1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneId: "z1" }),
    });
  });

  it("updateTable PATCHes the label + capacity slice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateTable("t1", { label: "6", capacity: 4 })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables/t1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "6", capacity: 4 }),
    });
  });

  it("deactivateTable DELETEs the table and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deactivateTable("t1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables/t1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("createTable rejects with { code } on a non-2xx (label already taken)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "table.label_taken" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createTable({ label: "4" })).rejects.toMatchObject({
      code: "table.label_taken",
    });
  });

  // FP-2 spatial placement: the management placement routes (Task 3, authorizeManager-gated) the Plano
  // editor drives. PUT sends the four placement columns + the target zone; DELETE un-places. Both answer
  // an empty 204 → void. Paths/bodies asserted against apps/server/src/management-api.ts.

  it("setTablePlacement PUTs the placement body to the table's placement route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const placement = {
      posX: 200,
      posY: 300,
      shape: "rect" as const,
      rotation: 90,
      zoneId: "z1",
    };
    await expect(api.setTablePlacement("t1", placement)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables/t1/placement", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(placement),
    });
  });

  it("setTablePlacement carries a null zoneId for a still-zoneless table", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const placement = {
      posX: 500,
      posY: 500,
      shape: "round" as const,
      rotation: 0,
      zoneId: null,
    };
    await api.setTablePlacement("t1", placement);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables/t1/placement", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(placement),
    });
  });

  it("setTablePlacement rejects with { code } on a non-2xx (placement.invalid)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "placement.invalid" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.setTablePlacement("t1", {
        posX: 5000,
        posY: 0,
        shape: "round",
        rotation: 0,
        zoneId: "z1",
      }),
    ).rejects.toMatchObject({ code: "placement.invalid" });
  });

  it("clearPlacement DELETEs the table's placement route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.clearPlacement("t1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tables/t1/placement", {
      method: "DELETE",
      credentials: "include",
    });
  });
});

describe("DashboardApi — kitchen stations + routing (KDS-1)", () => {
  // The eight verbs the Cocina config screen + catalogue routing selects drive (KDS-1's
  // /management-api/stations, /management-api/categories/:id/station, /management-api/products/:id/station
  // and /management-api/bump-mode routes, till.configure-gated). GET decodes the station list, POST
  // returns the minted id (201), PATCH/DELETE/PUT resolve undefined on an empty 204. Paths/bodies
  // asserted against apps/server/src/management-api.ts.

  it("listStations GETs /management-api/stations with credentials", async () => {
    const rows = [{ id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listStations()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createStation POSTs { name } and returns the id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "s1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createStation({ name: "Plancha" })).toEqual({ id: "s1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Plancha" }),
    });
  });

  it("createStation can carry an optional displayOrder + isDefault", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "s2" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createStation({ name: "Barra", displayOrder: 2, isDefault: true })).toEqual({
      id: "s2",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Barra", displayOrder: 2, isDefault: true }),
    });
  });

  it("updateStation PATCHes the addressed station's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateStation("s1", { name: "Pase", displayOrder: 1 }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations/s1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pase", displayOrder: 1 }),
    });
  });

  it("deactivateStation DELETEs the station and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deactivateStation("s1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations/s1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("setDefaultStation POSTs the station's default route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setDefaultStation("s1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations/s1/default", {
      method: "POST",
      credentials: "include",
    });
  });

  it("setCategoryStation PUTs { stationId } to the category's station route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setCategoryStation("c1", "s1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/categories/c1/station", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stationId: "s1" }),
    });
  });

  it("setCategoryStation carries a null stationId to CLEAR the category route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.setCategoryStation("c1", null);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/categories/c1/station", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stationId: null }),
    });
  });

  it("setProductStation PUTs { stationId } to the product's station route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setProductStation("p1", "s1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/station", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stationId: "s1" }),
    });
  });

  it("setProductStation carries a null stationId to CLEAR the product override", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.setProductStation("p1", null);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/station", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stationId: null }),
    });
  });

  it("setBumpMode PUTs { mode } to /management-api/bump-mode (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setBumpMode("ticket")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/bump-mode", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ticket" }),
    });
  });

  it("createStation rejects with { code } on a non-2xx (name already taken)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "station.name_taken" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createStation({ name: "Cocina" })).rejects.toMatchObject({
      code: "station.name_taken",
    });
  });

  it("setDefaultStation rejects with { code } on a non-2xx (station not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "station.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setDefaultStation("nope")).rejects.toMatchObject({
      code: "station.not_found",
    });
  });

  // ── Kitchen courses + fire control (KDS-2) — the sibling of the station verbs above ────────────────

  it("listCourses GETs /management-api/courses with credentials", async () => {
    const rows = [{ id: "k1", name: "Entrantes", displayOrder: 0, active: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listCourses()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createCourse POSTs { name } and returns the id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "k1" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createCourse({ name: "Postres" })).toEqual({ id: "k1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Postres" }),
    });
  });

  it("createCourse can carry an optional displayOrder", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "k2" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createCourse({ name: "Principales", displayOrder: 1 })).toEqual({ id: "k2" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Principales", displayOrder: 1 }),
    });
  });

  it("updateCourse PATCHes the addressed course's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateCourse("k1", { name: "Café", displayOrder: 2 }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses/k1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Café", displayOrder: 2 }),
    });
  });

  it("deactivateCourse DELETEs the course and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deactivateCourse("k1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses/k1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("setProductCourse PUTs { courseId } to the product's course route (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setProductCourse("p1", "k1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/course", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId: "k1" }),
    });
  });

  it("setProductCourse carries a null courseId to CLEAR the product default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.setProductCourse("p1", null);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/course", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId: null }),
    });
  });

  it("getFireControl GETs /management-api/fire-control and returns { mode }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ mode: "kitchen" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getFireControl()).toEqual({ mode: "kitchen" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/fire-control", {
      method: "GET",
      credentials: "include",
    });
  });

  it("setFireControl PUTs { mode } to /management-api/fire-control (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setFireControl("kitchen")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/fire-control", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "kitchen" }),
    });
  });

  it("createCourse rejects with { code } on a non-2xx (name already taken)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "course.name_taken" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createCourse({ name: "Entrantes" })).rejects.toMatchObject({
      code: "course.name_taken",
    });
  });
});

describe("DashboardApi — devices (device-identity-1)", () => {
  // The three verbs the Devices screen drives (device-identity-1's /management-api/devices,
  // /management-api/device-codes and /management-api/devices/:id/revoke routes, device.manage-gated).
  // GET decodes the device list (newest-enrolled first, server-ordered), POST returns the one-time code
  // (201), the revoke POST resolves undefined on an empty 204. Paths/bodies asserted against
  // apps/server/src/device-api.ts.

  const rows = [
    {
      id: "d1",
      kind: "kds_station",
      stationId: "s1",
      label: "Pantalla Cocina",
      active: true,
      lastSeenAt: "2026-08-25T14:30:00.000Z",
      enrolledAt: "2026-08-20T09:00:00.000Z",
      canvasId: "p1",
    },
    {
      id: "d2",
      kind: "kds_station",
      stationId: null,
      label: "Pase",
      active: false,
      lastSeenAt: null,
      enrolledAt: "2026-08-19T09:00:00.000Z",
      canvasId: null,
    },
  ];

  it("listDevices GETs /management-api/devices with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listDevices()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/devices", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createDeviceCode POSTs { kind, stationId, label } and returns the one-time code (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "ABCD2345" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(
      await api.createDeviceCode({ kind: "kds_station", stationId: "s1", label: "Pantalla" }),
    ).toEqual({ code: "ABCD2345" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/device-codes", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "kds_station", stationId: "s1", label: "Pantalla" }),
    });
  });

  it("revokeDevice POSTs the device's revoke route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.revokeDevice("d1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/devices/d1/revoke", {
      method: "POST",
      credentials: "include",
    });
  });

  it("createDeviceCode rejects with { code } on a non-2xx (station not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "station.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.createDeviceCode({ kind: "kds_station", stationId: "nope", label: "X" }),
    ).rejects.toMatchObject({ code: "station.not_found" });
  });

  it("revokeDevice rejects with { code } on a non-2xx (device not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "device.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.revokeDevice("nope")).rejects.toMatchObject({ code: "device.not_found" });
  });

  it("reassignDevice POSTs { canvasId } to the device's assign-canvas route (204)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.reassignDevice("d1", "p1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/devices/d1/assign-canvas", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canvasId: "p1" }),
    });
  });

  it("reassignDevice sends { canvasId: null } to clear the assignment", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.reassignDevice("d1", null)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/devices/d1/assign-canvas", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canvasId: null }),
    });
  });

  it("reassignDevice rejects with { code } on a UUID-shaped unknown/foreign canvas (binding invalid)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "device.binding_invalid" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    // A UUID-shaped id that names no canvas of this tenant is what actually reaches the FK and yields
    // `device.binding_invalid` — a MALFORMED (non-UUID) id would be screened to `management.request_invalid`
    // before it, so use a well-formed uuid here to match the real route contract.
    await expect(
      api.reassignDevice("d1", "11111111-1111-4111-8111-111111111111"),
    ).rejects.toMatchObject({
      code: "device.binding_invalid",
    });
  });

  // ── Per-user language preference (Task 4's PUBLIC pre-login read) ──

  it("getLocales GETs the public /management-api/locales list and returns { locales, venueDefault }", async () => {
    const body = {
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getLocales()).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locales", {
      method: "GET",
      credentials: "include",
    });
  });

  it("putLocale PUTs the session locale route with a { locale } body and returns nothing", async () => {
    // The logged-in persist path (Task 10): the signed-in person's identity comes from the session
    // server-side, so the body carries only the chosen code. An empty 204 resolves to undefined.
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    expect(await api.putLocale("en-GB")).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session/me/locale", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: "en-GB" }),
    });
  });

  it("putLocale rejects with the server code when the locale is unsupported", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "locale.unsupported" } }, false, 422));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.putLocale("xx-XX")).rejects.toMatchObject({ code: "locale.unsupported" });
  });
});

describe("DashboardApi — canvas editor CRUD (SP-B3.2)", () => {
  // Uses the file's `jsonResponse`/`emptyResponse` stubs rather than `new Response(...)`: a real
  // `new Response("", { status: 204 })` throws "Response with null body status cannot have body" in
  // this browser-mode (chromium) suite, and the brief's Step 1 directs us to the existing harness.
  it("getCanvas GETs the canvas by id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "c1",
        name: "Till",
        definition: { formFactor: "till", tabs: [], capabilities: [] },
      }),
    );
    const api = new DashboardApi("", fetchImpl);
    const c = await api.getCanvas("c1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/canvases/c1",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
    expect(c.id).toBe("c1");
  });
  it("createCanvas POSTs name+definition and returns the id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "c9" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const def = { formFactor: "till", tabs: [], capabilities: [] };
    const r = await api.createCanvas("New", def);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/canvases",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "New", definition: def }),
      }),
    );
    expect(r.id).toBe("c9");
  });
  it("updateCanvas PUTs and resolves void on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateCanvas("c1", "N", { formFactor: "till", tabs: [], capabilities: [] }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/canvases/c1",
      expect.objectContaining({ method: "PUT" }),
    );
  });
  it("deleteCanvas DELETEs and resolves void on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deleteCanvas("c1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/canvases/c1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("rejects with the server code on a non-2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "canvas.name_taken" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createCanvas("Dup", {})).rejects.toEqual({ code: "canvas.name_taken" });
  });
});

describe("DashboardApi — printing (agents + printers + jobs)", () => {
  // The nine verbs the Impresoras screen drives (the print-api.ts management routes, printer.manage-
  // gated). Agents: list, mint a one-time code (201), revoke (204). Printers: list, create (201),
  // patch (204), deactivate (204). Recent jobs: list. Test-print: enqueue a known payload (202).
  // Paths/bodies asserted against apps/server/src/print-api.ts.

  const agents = [
    {
      id: "a1",
      name: "Cocina agent",
      active: true,
      lastSeenAt: "2026-08-25T14:30:00.000Z",
      enrolledAt: "2026-08-20T09:00:00.000Z",
    },
    {
      id: "a2",
      name: "Old agent",
      active: false,
      lastSeenAt: null,
      enrolledAt: "2026-08-19T09:00:00.000Z",
    },
  ];
  const printers = [
    {
      id: "p1",
      name: "Cocina",
      transport: "network_tcp",
      agentId: "a1",
      host: "10.0.0.9",
      port: 9100,
      usbPath: null,
      pollId: null,
      ticketScope: "station",
      active: true,
    },
  ];
  const jobs = [
    {
      id: "j1",
      printerId: "p1",
      status: "done",
      attempts: 1,
      lastError: null,
      createdAt: "2026-08-25T14:00:00.000Z",
      deliveredAt: "2026-08-25T14:00:05.000Z",
    },
  ];

  it("listAgents GETs /management-api/print-agents with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(agents));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listAgents()).toEqual(agents);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createAgentCode POSTs { label } and returns the one-time code (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "ABCD2345" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createAgentCode("Cocina")).toEqual({ code: "ABCD2345" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents/codes", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Cocina" }),
    });
  });

  it("revokeAgent POSTs the agent's revoke route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.revokeAgent("a1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents/a1/revoke", {
      method: "POST",
      credentials: "include",
    });
  });

  it("listPrinters GETs /management-api/printers with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(printers));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPrinters()).toEqual(printers);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createPrinter POSTs the input and returns the created id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "p9" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const input = {
      name: "USB",
      transport: "usb" as const,
      agentId: "a1",
      usbPath: "/dev/usb/lp0",
    };
    expect(await api.createPrinter(input)).toEqual({ id: "p9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("createPrinter rejects with { code } on a missing transport field (printer.invalid_config, 422)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "printer.invalid_config" } }, false, 422));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.createPrinter({ name: "Bad", transport: "usb", agentId: "a1" }),
    ).rejects.toMatchObject({ code: "printer.invalid_config" });
  });

  it("updatePrinter PATCHes the printer's route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const patch = {
      name: "Cocina 2",
      host: "10.0.0.20",
      ticketScope: "order" as const,
      active: true,
    };
    await expect(api.updatePrinter("p1", patch)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  });

  it("deactivatePrinter POSTs the printer's deactivate route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.deactivatePrinter("p1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/deactivate", {
      method: "POST",
      credentials: "include",
    });
  });

  it("listRecentJobs GETs /management-api/print-jobs with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(jobs));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listRecentJobs()).toEqual(jobs);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-jobs", {
      method: "GET",
      credentials: "include",
    });
  });

  it("testPrint POSTs the printer's test-print route and returns { jobId } (202)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "j9" }, true, 202));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.testPrint("p1")).toEqual({ jobId: "j9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/test-print", {
      method: "POST",
      credentials: "include",
    });
  });

  it("testPrint rejects with { code } on a non-2xx (printer not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "printer.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.testPrint("nope")).rejects.toMatchObject({ code: "printer.not_found" });
  });

  // ── Station↔printer mapping (KDS-4) ────────────────────────────────────────────────────────────
  // The three verbs the printer editor's station-mapping section drives (the print-api.ts routes at
  // /management-api/printers/:pid/stations + /management-api/stations/:sid/printers/:pid). The GET
  // decodes the { stationId, printerId } pairs; attach/detach resolve undefined on an empty 204. The
  // path ORDER is load-bearing — the mutation route is /stations/:sid/printers/:pid, so the method's
  // (stationId, printerId) arguments must land in that order.

  it("listPrinterStations GETs the printer's stations route and decodes the pairs", async () => {
    const rows = [{ stationId: "s1", printerId: "p1" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPrinterStations("p1")).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/stations", {
      method: "GET",
      credentials: "include",
    });
  });

  it("attachPrinterToStation POSTs /stations/:sid/printers/:pid and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.attachPrinterToStation("s1", "p1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations/s1/printers/p1", {
      method: "POST",
      credentials: "include",
    });
  });

  it("attachPrinterToStation rejects with { code } when an end is not live (station.not_found, 404)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "station.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.attachPrinterToStation("nope", "p1")).rejects.toMatchObject({
      code: "station.not_found",
    });
  });

  it("detachPrinterFromStation DELETEs /stations/:sid/printers/:pid and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.detachPrinterFromStation("s1", "p1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations/s1/printers/p1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  // ── Receipt printer + print mode (counter receipt/drawer §5) ────────────────────────────────────
  it("listTills GETs /management-api/tills and decodes the rows", async () => {
    const tills = [
      { id: "t1", label: "Caja 1", locationId: "loc-1", receiptPrinterId: "p1" },
      { id: "t2", label: "Caja 2", locationId: "loc-1", receiptPrinterId: null },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(tills));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listTills()).toEqual(tills);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/tills", {
      method: "GET",
      credentials: "include",
    });
  });

  it("setTillReceiptPrinter PATCHes the till's receipt-printer route with { printerId } (set + clear)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    // Set a printer.
    await expect(api.setTillReceiptPrinter("t1", "p1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenLastCalledWith("/management-api/tills/t1/receipt-printer", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ printerId: "p1" }),
    });
    // Clear it — an explicit null in the body (a till with no printer just doesn't print).
    await expect(api.setTillReceiptPrinter("t1", null)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenLastCalledWith("/management-api/tills/t1/receipt-printer", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ printerId: null }),
    });
  });

  it("setTillReceiptPrinter rejects with { code } on a non-2xx (printer not in the till's location)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "printer.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setTillReceiptPrinter("t1", "p-foreign")).rejects.toMatchObject({
      code: "printer.not_found",
    });
  });

  it("setReceiptPrintMode PATCHes the location's print-mode route with { mode }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setReceiptPrintMode("loc-1", "on_request")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations/loc-1/receipt-print-mode", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "on_request" }),
    });
  });

  it("setDrawerOpenPolicy PATCHes the location's drawer-open-policy route with { policy }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setDrawerOpenPolicy("loc-1", "open")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locations/loc-1/drawer-open-policy", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: "open" }),
    });
  });
});

describe("DashboardApi — reporting (sales & takings)", () => {
  it("getSalesOverview GETs the overview route and returns the parsed shape", async () => {
    // Canned JSON mirroring `apps/server/src/report-api.ts`'s overview handler: money as decimal
    // strings, counts, the open-tables tile and top sellers (frozen `descriptions` snapshot).
    const overview = {
      businessDay: "2026-08-29",
      takings: { tenderTotal: "1234.50", tipTotal: "42.00", grossTotal: "1234.50" },
      counts: { sales: 37, corrections: 1, voids: 2 },
      openTables: { open: 3, total: 12 },
      topSellers: [
        { descriptions: { es: "Café", en: "Coffee" }, quantity: "18.000", total: "36.00" },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(overview));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getSalesOverview()).toEqual(overview);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/reports/overview", {
      method: "GET",
      credentials: "include",
    });
  });

  it("getDailyClose GETs the daily-close route with the businessDay query and returns the parsed shape", async () => {
    // Canned JSON mirroring the daily-close handler: `{ businessDay, vat, cash, counts, topSellers }`,
    // with per-till cash-up (`byMethod: {method, amount, tip}`, `cashTakings`) and VAT `{rate,base,tax}`.
    const close = {
      businessDay: "2026-08-28",
      vat: {
        byRate: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
        baseTotal: "100.00",
        taxTotal: "21.00",
        grossTotal: "121.00",
      },
      cash: {
        byTill: [
          {
            tillId: "till-1",
            byMethod: [
              { method: "cash", amount: "80.00", tip: "5.00" },
              { method: "card", amount: "41.00", tip: "0.00" },
            ],
            cashTakings: "80.00",
          },
        ],
        tenderTotal: "121.00",
        tipTotal: "5.00",
      },
      counts: { sales: 12, corrections: 0, voids: 1 },
      topSellers: [{ descriptions: { es: "Tapa" }, quantity: "9.000", total: "45.00" }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(close));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getDailyClose("2026-08-28")).toEqual(close);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/reports/daily-close?businessDay=2026-08-28",
      { method: "GET", credentials: "include" },
    );
  });

  it("getSalesPeriod GETs the period route with from/to and returns the parsed shape", async () => {
    // Canned JSON mirroring the period handler: `{ from, to, vat, topSellers }`.
    const period = {
      from: "2026-08-01",
      to: "2026-08-28",
      vat: {
        byRate: [{ rate: "10.00", base: "500.00", tax: "50.00" }],
        baseTotal: "500.00",
        taxTotal: "50.00",
        grossTotal: "550.00",
      },
      topSellers: [{ descriptions: { es: "Menú" }, quantity: "120.000", total: "1440.00" }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(period));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getSalesPeriod("2026-08-01", "2026-08-28")).toEqual(period);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/reports/period?from=2026-08-01&to=2026-08-28",
      { method: "GET", credentials: "include" },
    );
  });

  it("getOverdueOrders GETs the overdue-orders route and returns the parsed shape", async () => {
    // Canned JSON mirroring `apps/server/src/report-api.ts`'s overdue-orders handler (Task 6):
    // `{ orders: OverdueOrder[] }`, worst-first — a bare walk-up's `tableLabel` is null.
    const body = {
      orders: [
        {
          orderId: "order-1",
          orderNumber: 101,
          tableLabel: "T4",
          stationName: "Grill",
          ageMinutes: 22,
          band: "forgotten",
        },
        {
          orderId: "order-2",
          orderNumber: 102,
          tableLabel: null,
          stationName: "Bar",
          ageMinutes: 11,
          band: "overdue",
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getOverdueOrders()).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/reports/overdue-orders", {
      method: "GET",
      credentials: "include",
    });
  });
});

describe("DashboardApi — option groups + product attach (Task 11/12)", () => {
  // The seven verbs the option-group manager + the product form's attach section drive (the
  // catalogue-api.ts option-group routes, person.manage-gated like the rest of catalogue management).
  // GET decodes the list, POST returns the created row (201), PATCH resolves undefined on an empty 204.
  // Paths/bodies asserted against apps/server/src/catalogue-api.ts.

  it("listOptionGroups GETs /management-api/option-groups with credentials", async () => {
    const rows = [
      {
        id: "og1",
        name: { es: "Tamaño" },
        minSelect: 1,
        maxSelect: 1,
        required: true,
        sort: 0,
        active: true,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listOptionGroups()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/option-groups", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createOptionGroup POSTs the input body and returns the created group (201)", async () => {
    const input = { name: { es: "Tamaño" }, minSelect: 1, maxSelect: 1, required: true };
    const created = { id: "og1", ...input, sort: 0, active: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createOptionGroup(input)).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/option-groups", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateOptionGroup PATCHes the addressed group's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateOptionGroup("og1", { minSelect: 0, required: false }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/option-groups/og1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minSelect: 0, required: false }),
    });
  });

  it("listOptionGroupItems GETs the addressed group's items with credentials", async () => {
    const rows = [
      {
        id: "oi1",
        groupId: "og1",
        name: { es: "Pequeño" },
        priceDelta: "0.00",
        vatClass: null,
        sort: 0,
        active: true,
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listOptionGroupItems("og1")).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/option-groups/og1/items", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createOptionGroupItem POSTs the input body to the group's items route and returns the created item (201)", async () => {
    const input = { name: { es: "Grande" }, priceDelta: "1.50", vatClass: "reduced" as const };
    const created = { id: "oi2", groupId: "og1", ...input, sort: 0, active: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createOptionGroupItem("og1", input)).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/option-groups/og1/items", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateOptionGroupItem PATCHes the addressed item's mutable slice (empty 204 body)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateOptionGroupItem("og1", "oi1", { priceDelta: "2.00", vatClass: null }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/option-groups/og1/items/oi1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priceDelta: "2.00", vatClass: null }),
    });
  });

  it("listProductOptionGroupIds GETs the product's attach read-back with credentials", async () => {
    const ids = ["og2", "og1"];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(ids));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listProductOptionGroupIds("p1")).toEqual(ids);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1/option-groups", {
      method: "GET",
      credentials: "include",
    });
  });

  it("createOptionGroup rejects with { code } on a non-2xx (inconsistent select bounds)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "options.group_invalid" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.createOptionGroup({ name: {}, minSelect: 2, maxSelect: 1 })).rejects.toEqual({
      code: "options.group_invalid",
    });
  });

  it("createProduct carries an optionGroupIds attach list straight through in the body", async () => {
    const input = {
      catalogueId: "c1",
      categoryId: null,
      descriptions: { es: "Bocadillo" },
      pricingUnit: "each" as const,
      unitPrice: "4.00",
      vatClass: "general" as const,
      active: true,
      optionGroupIds: ["og2", "og1"],
    };
    const created = { id: "p9", ...input };
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

  it("updateProduct carries an optionGroupIds attach list straight through in the patch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateProduct("p1", { optionGroupIds: ["og1"] })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/products/p1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionGroupIds: ["og1"] }),
    });
  });

  it("getRecentLogs GETs the recent endpoint with the given limit", async () => {
    const lines = [{ at: "2026-08-31T10:00:00Z", level: "info", event: "boot" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ lines }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getRecentLogs(50)).toEqual({ lines });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/recent?limit=50", {
      method: "GET",
      credentials: "include",
    });
  });

  it("getRecentLogs defaults the limit to 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ lines: [] }));
    const api = new DashboardApi("", fetchImpl);
    await api.getRecentLogs();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/recent?limit=200", {
      method: "GET",
      credentials: "include",
    });
  });

  it("getVerbosity GETs the verbosity endpoint", async () => {
    const verbosity = { level: "info", revertsAt: null };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(verbosity));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getVerbosity()).toEqual(verbosity);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/verbosity", {
      method: "GET",
      credentials: "include",
    });
  });

  it("setVerbosity POSTs the level + ttl", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.setVerbosity("debug", 5)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/verbosity", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "debug", ttlMinutes: 5 }),
    });
  });
});
