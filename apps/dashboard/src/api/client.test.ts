import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@waitron/dashboard-kit";
import { DashboardApi } from "./client.js";
import type { ReceiptConfig } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/** Without `as: "blob"`, the request helper resolves an empty body to `undefined`, whatever the success status. */
function emptyResponse(): Response {
  return { ok: true, status: 204, json: async () => undefined, text: async () => "" } as Response;
}

describe("DashboardApi", () => {
  it("moves a mixed folder selection through its dedicated route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.moveCatalogueItems({ productIds: ["p"], categoryIds: ["f"] }, null);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/folders/move",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ productIds: ["p"], categoryIds: ["f"], to: null }),
      }),
    );
  });
  it("sends the selected folder contents choice on deletion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const shown = [
      { id: "f", folders: 0, products: 0, activeProducts: 0, routes: 0, ownRoutes: 0 },
    ];
    await api.deleteCatalogueItems({ productIds: [], categoryIds: ["f"] }, "move_up", shown);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/folders/delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ productIds: [], categoryIds: ["f"], contents: "move_up", shown }),
      }),
    );
  });
  it("sends the counts the client read before deleting with a category deletion", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const shown = [
      { id: "f", folders: 1, products: 3, activeProducts: 2, routes: 3, ownRoutes: 3 },
    ];
    await api.deleteCatalogueItems({ productIds: [], categoryIds: ["f"] }, "delete", shown);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/folders/delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ productIds: [], categoryIds: ["f"], contents: "delete", shown }),
      }),
    );
  });
  it("reads ordered folder summaries using encoded repeated query parameters", async () => {
    const summaries = [
      { id: "a&b", folders: 2, products: 3, activeProducts: 3, routes: 1, ownRoutes: 1 },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(summaries));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.summariseFolders(["a&b", "c d"])).toEqual(summaries);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/folders/summary?id=a%26b&id=c%20d",
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("reads the products' made-at descriptions", async () => {
    const makers = {
      lager: {
        stationId: "bar",
        stationName: "Bar",
        noPreparation: false,
        noReplacement: false,
        variesByZone: false,
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(makers));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listMadeAt()).toEqual(makers);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/products/made-at",
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("reads the current folder routing claims", async () => {
    const routing = {
      claims: [],
      exceptions: [],
      unassigned: { folders: [], products: [] },
      defaultStationId: null,
      stations: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(routing));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getFolderRouting()).toEqual(routing);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/venue-service/routing", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });
  it("uses the discovery, adoption and separate reader-management routes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const input = { providerId: "acme", providerRef: "v-1", name: "Garden" };
    await api.availableReaders("acme");
    await api.adoptReader(input);
    await api.renameReader("r-1", "Garden");
    await api.disableReader("r-1");
    await api.enableReader("r-1");
    await api.unpairReader("r-1");
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/management-api/payments/providers/acme/available-readers", "GET", undefined],
      ["/management-api/payments/readers/adopt", "POST", JSON.stringify(input)],
      ["/management-api/payments/readers/r-1", "PATCH", JSON.stringify({ name: "Garden" })],
      ...["disable", "enable", "unpair"].map((action) => [
        `/management-api/payments/readers/r-1/${action}`,
        "POST",
        undefined,
      ]),
    ]);
  });

  it("downloads an encrypted configuration export as binary", async () => {
    const artifact = new Blob(["encrypted"], { type: "application/octet-stream" });
    const response = new Response(artifact, { status: 200 });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const api = new DashboardApi("https://box.test", fetchImpl);
    expect(await (await api.exportConfiguration("a strong passphrase")).text()).toBe("encrypted");
    expect(fetchImpl).toHaveBeenCalledWith("https://box.test/management-api/configuration-export", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: "a strong passphrase" }),
    });
  });

  it("reads the server's answer to a configuration export made with the browser's own fetch", async () => {
    // exportConfiguration reads a body only from the Response fetch returned, so a read means the
    // server answered.
    const readers = [vi.spyOn(Response.prototype, "json"), vi.spyOn(Response.prototype, "blob")];
    try {
      await new DashboardApi("", fetch)
        .exportConfiguration("a strong passphrase")
        .catch(() => undefined);
      expect(readers.flatMap((reader) => reader.mock.calls)).not.toHaveLength(0);
    } finally {
      for (const reader of readers) reader.mockRestore();
    }
  });

  it("rejects a failed configuration export with the envelope's code and the HTTP status", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: "backup.managed_by_environment" } }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
    const api = new DashboardApi("", vi.fn().mockResolvedValue(response));
    await expect(api.exportConfiguration("a strong passphrase")).rejects.toMatchObject({
      code: "backup.managed_by_environment",
      status: 409,
    });
  });

  it("tells the shell when a configuration export finds the session expired", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: "management_session.expired" } }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const api = new DashboardApi("", vi.fn().mockResolvedValue(response), onError, onSuccess);
    await expect(api.exportConfiguration("a strong passphrase")).rejects.toEqual({
      code: "management_session.expired",
      status: 401,
    });
    expect(onError.mock.calls).toEqual([["management_session.expired"]]);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("counts a successful configuration export as session activity", async () => {
    const response = new Response(new Blob(["encrypted"]), { status: 200 });
    const onSuccess = vi.fn();
    const api = new DashboardApi("", vi.fn().mockResolvedValue(response), undefined, onSuccess);
    await api.exportConfiguration("a strong passphrase");
    expect(onSuccess.mock.calls).toEqual([["/management-api/configuration-export"]]);
  });

  it("keeps a refused configuration export's params", async () => {
    const response = new Response(
      JSON.stringify({
        error: { code: "management.request_invalid", params: { field: "passphrase" } },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
    const api = new DashboardApi("", vi.fn().mockResolvedValue(response));
    await expect(api.exportConfiguration("short")).rejects.toEqual({
      code: "management.request_invalid",
      params: { field: "passphrase" },
      status: 400,
    });
  });

  it("falls back to server.internal (with the status) when the export error body is not JSON", async () => {
    const response = new Response("Bad Gateway", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
    const api = new DashboardApi("", vi.fn().mockResolvedValue(response));
    await expect(api.exportConfiguration("a strong passphrase")).rejects.toMatchObject({
      code: "server.internal",
      status: 502,
    });
  });

  it("uses session-scoped profile endpoints without a person id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.getProfile();
    const details = {
      displayName: "Alex",
      firstNames: "Alex",
      lastNames: "Rivera",
      telephone: null,
      email: "alex@example.com",
      locale: "en-GB",
    };
    await api.saveProfile(details);
    await api.changePassword({ currentPassword: "current", password: "replacement" });
    await api.changePin({ currentPassword: "current", pin: "4321" });
    await api.removePasskey("credential-id", { currentPassword: "current" });
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/management-api/session/me/profile", "GET", undefined],
      ["/management-api/session/me/profile", "PUT", JSON.stringify(details)],
      [
        "/management-api/session/me/password",
        "PUT",
        JSON.stringify({ currentPassword: "current", password: "replacement" }),
      ],
      [
        "/management-api/session/me/pin",
        "PUT",
        JSON.stringify({ currentPassword: "current", pin: "4321" }),
      ],
      [
        "/management-api/session/me/passkeys/credential-id",
        "DELETE",
        JSON.stringify({ currentPassword: "current" }),
      ],
    ]);
  });

  it("starts public Google login and session-scoped Google linking", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ configured: true }))
      .mockResolvedValueOnce(
        jsonResponse({ authorizationUrl: "https://accounts.google.test/login" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ authorizationUrl: "https://accounts.google.test/link" }),
      );
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getGoogleConfig()).resolves.toEqual({ configured: true });
    await expect(api.beginGoogleLogin()).resolves.toEqual({
      authorizationUrl: "https://accounts.google.test/login",
    });
    await expect(api.beginGoogleLink({ currentPassword: "correct horse" })).resolves.toEqual({
      authorizationUrl: "https://accounts.google.test/link",
    });
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/management-api/google/config", "GET"],
      ["/management-api/google/login", "POST"],
      ["/management-api/session/me/google", "POST"],
    ]);
  });
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
    });
  });

  it("login sends the email and password", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ personId: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    await api.login({ email: "owner@x.com", password: "correct horse" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@x.com", password: "correct horse" }),
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
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "p2", invitationSent: true }));
    const api = new DashboardApi("", fetchImpl);
    const out = await api.createPerson({
      displayName: "Bea",
      firstNames: "Beatrice",
      lastNames: "Jones",
      telephone: null,
      role: "staff",
      email: "bea@x.com",
    });
    expect(out).toEqual({ id: "p2", invitationSent: true });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Bea",
        firstNames: "Beatrice",
        lastNames: "Jones",
        telephone: null,
        role: "staff",
        email: "bea@x.com",
      }),
    });
  });

  it("requests and completes password recovery", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ personId: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    await api.requestPasswordReset("bea@x.com");
    await api.completeAccountAction("token-1", "password_reset", "a replacement password");
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/management-api/password-reset", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bea@x.com" }),
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/management-api/account-actions/complete", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "token-1",
        purpose: "password_reset",
        password: "a replacement password",
      }),
    });
  });

  it("inspects account actions by token", async () => {
    const inspected = { email: "bea@x.com", purpose: "invitation" as const };
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(inspected));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.inspectAccountAction("token-1", "invitation")).resolves.toEqual(inspected);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/management-api/account-actions/inspect", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "token-1", purpose: "invitation" }),
    });
  });

  it("loads the email delivery status and reads a captured message", async () => {
    const inbox = { mode: "local_capture", count: 1, messages: [{ id: "mail-1" }] };
    const message = { id: "mail-1", subject: "Set up your account", text: "Open the link" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(inbox))
      .mockResolvedValueOnce(jsonResponse(message));
    const api = new DashboardApi("", fetchImpl);

    await expect(api.getEmailInbox()).resolves.toEqual(inbox);
    await expect(api.getTestEmail("mail/1")).resolves.toEqual(message);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/management-api/email", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "/management-api/email/message/mail%2F1", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });
  it("savePerson PUTs the complete administrative edit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const details = {
      displayName: "Ada",
      firstNames: "Ada Augusta",
      lastNames: "Lovelace",
      telephone: "+44 20",
      email: "ada@example.com",
      role: "admin" as const,
      status: "active" as const,
    };
    await api.savePerson("p1", details);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(details),
    });
  });

  it("resetPin POSTs without exposing a replacement PIN to the administrator", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.resetPin("p1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1/reset-pin", {
      method: "POST",
      credentials: "include",
    });
  });

  it("resetLogin removes credentials and returns invitation delivery status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ invitationSent: true }));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.resetLogin("p1")).resolves.toEqual({ invitationSent: true });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/staff/p1/reset-login", {
      method: "POST",
      credentials: "include",
    });
  });

  it("passkeyRegisterOptions POSTs the register/options route with current credentials", async () => {
    const payload = {
      challengeHandle: "ch-1",
      options: { challenge: "abc", rp: { id: "localhost" } },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.passkeyRegisterOptions({ currentPassword: "correct horse" })).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/passkey/register/options", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "correct horse" }),
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

  it("passkeySignals GETs what the password manager is told about the signed-in person", async () => {
    const payload = {
      rpId: "waitron.local",
      userId: "dXNlcg",
      credentialIds: ["cred-1"],
      name: "ana@example.com",
      displayName: "Ana",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.passkeySignals()).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/passkey/signals", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
    const categories = [{ id: "cat1", name: "Entrantes", parentId: null }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(categories));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listCategories()).toEqual(categories);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/categories", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("createCategory POSTs the category and returns the created category", async () => {
    const input = { name: "Principales", parentId: "cat1" };
    const created = { id: "cat2", ...input };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.createCategory(input)).toEqual(created);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/categories", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("reads and updates a category and lists the library products", async () => {
    const category = { id: "cat1", name: "Entrantes", parentId: null };
    const product = {
      id: "p1",
      catalogueId: "menu1",
      categoryId: "cat1",
      primaryCategoryId: "cat1",
      name: "Croquetas",
      customerName: { es: "Croquetas caseras" },
      pricingUnit: "each",
      unitPrice: "8.00",
      vatClass: "reduced",
      active: true,
      allergens: null,
      manualAllergens: null,
      dietOverride: null,
      image: null,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(category))
      .mockResolvedValueOnce(jsonResponse({ ...category, name: "Comida" }))
      .mockResolvedValueOnce(jsonResponse([product]));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getCategory("cat1")).toEqual(category);
    expect(await api.updateCategory("cat1", { name: "Comida" })).toEqual({
      ...category,
      name: "Comida",
    });
    expect(await api.listLibraryProducts()).toEqual([product]);
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method, init.body])).toEqual([
      ["/management-api/categories/cat1", "GET", undefined],
      ["/management-api/categories/cat1", "PATCH", JSON.stringify({ name: "Comida" })],
      ["/management-api/products", "GET", undefined],
    ]);
  });

  it("uses the canonical unit collection and item routes", async () => {
    const unit = { id: "u1", name: { en: "portion" }, abbreviation: { en: "pt" }, precision: 2 };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([unit]))
      .mockResolvedValueOnce(jsonResponse(unit, true, 201))
      .mockResolvedValueOnce(jsonResponse({ ...unit, precision: 1 }))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.listUnits()).resolves.toEqual([unit]);
    await expect(
      api.createUnit({ name: { en: "portion" }, abbreviation: { en: "pt" }, precision: 2 }),
    ).resolves.toEqual(unit);
    await expect(api.updateUnit("u1", { precision: 1 })).resolves.toEqual({
      ...unit,
      precision: 1,
    });
    await expect(api.deleteUnit("u1")).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["/management-api/units", "GET", undefined],
      [
        "/management-api/units",
        "POST",
        JSON.stringify({ name: { en: "portion" }, abbreviation: { en: "pt" }, precision: 2 }),
      ],
      ["/management-api/units/u1", "PATCH", JSON.stringify({ precision: 1 })],
      ["/management-api/units/u1", "DELETE", undefined],
    ]);
  });

  it("listProducts GETs the addressed catalogue's products with credentials", async () => {
    const products = [
      {
        id: "p1",
        catalogueId: "c1",
        categoryId: null,
        primaryCategoryId: null,
        name: "Café solo",
        customerName: { es: "Café solo de la casa" },
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
      signal: expect.any(AbortSignal),
    });
  });

  it("imageLibraryRequest preserves multipart bodies and credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ image: "deadbeef.png" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "photo.png", {
      type: "image/png",
    });
    const form = new FormData();
    form.set("file", file);
    expect(await api.imageLibraryRequest("/management-api/images", "POST", form)).toEqual({
      image: "deadbeef.png",
    });
    const call = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("/management-api/images");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeInstanceOf(FormData);
    const part = (init.body as FormData).get("file");
    expect(part).toBeInstanceOf(File);
    expect((part as File).name).toBe("photo.png");
    // No content-type is set: the browser derives `multipart/form-data` and appends the boundary
    // itself; a manual content-type would drop the boundary and corrupt the upload.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
  });

  it("imageLibraryRequest preserves an image error envelope", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "media.unsupported_type" } }, false, 415));
    const api = new DashboardApi("", fetchImpl);
    const file = new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" });
    const form = new FormData();
    form.set("file", file);
    await expect(
      api.imageLibraryRequest("/management-api/images", "POST", form),
    ).rejects.toMatchObject({ code: "media.unsupported_type" });
  });

  it("getReceipt GETs the receipt trim with credentials", async () => {
    const payload = { receipt: { headerSubtitle: "C/ Mayor 1", footerMessage: "Gracias" } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getReceipt()).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/receipt", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
    });
  });

  it("defaults baseUrl to '' and fetchImpl to the global fetch", () => {
    // Exercises the constructor's default parameter initializers with no network call.
    expect(() => new DashboardApi()).not.toThrow();
  });

  it("reads open and handled alerts and marks an incident handled", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ visible: true, alerts: [] }))
      .mockResolvedValueOnce(jsonResponse({ visible: true, alerts: [] }))
      .mockResolvedValueOnce(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listAlerts()).toEqual({ visible: true, alerts: [] });
    await api.listHandledAlerts();
    await api.markIncidentHandled("a b");
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/management-api/alerts", "GET"],
      ["/management-api/alerts/handled", "GET"],
      ["/management-api/alerts/incidents/a%20b/handled", "POST"],
    ]);
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
        signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
  });
});

describe("DashboardApi — whoami + my schedule (staff self-service)", () => {
  it("getMe GETs the whoami route and returns the session and venue identity", async () => {
    const body = {
      personId: "p1",
      role: "staff",
      locale: "en-GB",
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getMe()).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/session/me", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("getMe surfaces a null stored locale for a person with no preference", async () => {
    const body = {
      personId: "p1",
      role: "manager",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
    };
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
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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
  it("listZones GETs /management-api/zones with credentials", async () => {
    const rows = [{ id: "z1", name: "Comedor", displayOrder: 0, active: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listZones()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/zones", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
    });
  });

  it("listTables with includeDisabled GETs the disabled tables too", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = new DashboardApi("", fetchImpl);
    await api.listTables({ includeDisabled: true });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      "/management-api/tables?includeDisabled=true",
      {
        method: "GET",
        credentials: "include",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("updateTable PATCHes active: true to enable a disabled table", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateTable("t1", { active: true })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/management-api/tables/t1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
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
  it("listStations GETs /management-api/stations with credentials", async () => {
    const rows = [{ id: "s1", name: "Cocina", displayOrder: 0, isDefault: true, active: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listStations()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/stations", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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

  // ── Kitchen courses + fire control ─────────────────────────────────────────────────────────────

  it("listCourses GETs /management-api/courses with credentials", async () => {
    const rows = [{ id: "k1", name: "Entrantes", displayOrder: 0, active: true }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listCourses()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("listCoursesWithDisabled GETs the courses with the disabled ones too", async () => {
    const rows = [
      { id: "k1", name: "Entrantes", displayOrder: 0, active: true, inUse: true },
      { id: "k2", name: "Brunch", displayOrder: 1, active: false, inUse: false },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listCoursesWithDisabled()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      "/management-api/courses?includeDisabled=true",
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
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

  it("removeCourse DELETEs the course and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.removeCourse("k1", { disable: false })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/management-api/courses/k1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("removeCourse asks the server only to disable the course when the screen offered Disable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.removeCourse("k1", { disable: true })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/management-api/courses/k1?disable=true", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("enableCourse PATCHes { active: true } to the course and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.enableCourse("k1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/management-api/courses/k1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
  });

  it("moveCourse PUTs { to } to the course's position and returns the renumbered list", async () => {
    const rows = [
      { id: "k2", name: "Principales", displayOrder: 0, active: true },
      { id: "k1", name: "Entrantes", displayOrder: 1, active: true },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.moveCourse("k1", 1)).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/courses/k1/position", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: 1 }),
    });
  });

  it("getFireControl GETs /management-api/fire-control and returns { mode }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ mode: "kitchen" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getFireControl()).toEqual({ mode: "kitchen" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/fire-control", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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

describe("DashboardApi — devices, pairing mode and join requests", () => {
  const rows = [
    {
      id: "d1",
      kind: "kds_station",
      stationId: "s1",
      label: "Pantalla Cocina",
      active: true,
      lastSeenAt: "2026-08-25T14:30:00.000Z",
      enrolledAt: "2026-08-20T09:00:00.000Z",
      deviceProfileId: "dp1",
    },
    {
      id: "d2",
      kind: "kds_station",
      stationId: null,
      label: "Pase",
      active: false,
      lastSeenAt: null,
      enrolledAt: "2026-08-19T09:00:00.000Z",
      deviceProfileId: null,
    },
  ];

  it("listDevices GETs /management-api/devices with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listDevices()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/devices", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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

  // ── Pairing mode + join requests ───────────────────────────────────────────────────────────────

  it("pairingMode GETs the window's state and the address devices use", async () => {
    const state = {
      open: true,
      openUntil: "2026-09-08T10:15:00.000Z",
      deviceAddress: "https://waitron.local",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(state));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.pairingMode()).toEqual(state);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/pairing-mode", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("takePairingHold POSTs with NO body and returns the hold's id and lapse", async () => {
    const hold = { holdId: "h1", openUntil: "2026-09-08T10:15:00.000Z" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(hold));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.takePairingHold()).toEqual(hold);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/pairing-mode/holds", {
      method: "POST",
      credentials: "include",
    });
  });

  it("renewPairingHold POSTs the hold's renew route with NO body and returns the new lapse", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ openUntil: "2026-09-08T10:16:00.000Z" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.renewPairingHold("h1")).toEqual({ openUntil: "2026-09-08T10:16:00.000Z" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/pairing-mode/holds/h1/renew", {
      method: "POST",
      credentials: "include",
    });
  });

  it("renewPairingHold rejects with device.pairing_hold_lapsed when the server forgot the hold", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "device.pairing_hold_lapsed" } }, false, 409),
      );
    const api = new DashboardApi("", fetchImpl);
    await expect(api.renewPairingHold("h1")).rejects.toMatchObject({
      code: "device.pairing_hold_lapsed",
    });
  });

  it("releasePairingHold DELETEs the hold and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.releasePairingHold("h1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/pairing-mode/holds/h1", {
      method: "DELETE",
      credentials: "include",
    });
  });

  it("joinRequests GETs the asked-for kind's queue, and the rows carry no number", async () => {
    const rows = [
      {
        id: "j1",
        kind: "device",
        label: "Pantalla pase",
        createdAt: "2026-09-08T10:00:00.000Z",
        pairingBy: { name: "Ana", mine: false },
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    const got = await api.joinRequests("device");
    expect(got).toEqual(rows);
    // The row's OWN shape is the guarantee (design §1.2 rule 1) — not a search of rendered markup.
    expect(Object.keys(got[0]!)).toEqual(["id", "kind", "label", "createdAt", "pairingBy"]);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/join-requests?kind=device", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("joinRequests asks for the print_agent queue by kind", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = new DashboardApi("", fetchImpl);
    await api.joinRequests("print_agent");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/join-requests?kind=print_agent", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("joinChallenge GETs the row's three shuffled numbers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ choices: ["12", "47", "83"] }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.joinChallenge("j1")).toEqual({ choices: ["12", "47", "83"] });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/join-requests/j1/challenge", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("denyJoinRequest POSTs the deny route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.denyJoinRequest("j1")).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/join-requests/j1/deny", {
      method: "POST",
      credentials: "include",
    });
  });

  it("denyJoinRequest sends the ask's createdAt when given one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.denyJoinRequest("j1", { createdAt: "2026-09-08T10:02:00.000Z" }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/join-requests/j1/deny", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createdAt: "2026-09-08T10:02:00.000Z" }),
    });
  });

  it("checkDeviceJoinNumber POSTs the tapped number, the hold and the ask, and resolves undefined on a 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.checkDeviceJoinNumber("j1", {
        choice: "47",
        holdId: "h1",
        createdAt: "2026-09-08T10:02:00.000Z",
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/device-join-requests/j1/check", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: "47", holdId: "h1", createdAt: "2026-09-08T10:02:00.000Z" }),
    });
  });

  it("checkDeviceJoinNumber rejects with device.join_mismatch when the number was wrong", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "device.join_mismatch" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.checkDeviceJoinNumber("j1", {
        choice: "12",
        holdId: "h1",
        createdAt: "2026-09-08T10:02:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "device.join_mismatch" });
  });

  it("acceptDeviceJoinRequest POSTs the typed name with the profile and binding", async () => {
    const accepted = { deviceId: "j1", name: "Pantalla pase", formFactor: "kds" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(accepted));
    const api = new DashboardApi("", fetchImpl);
    expect(
      await api.acceptDeviceJoinRequest("j1", {
        name: "Pantalla pase",
        profileId: "dp1",
        stationId: "s1",
      }),
    ).toEqual(accepted);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/device-join-requests/j1/accept", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pantalla pase", profileId: "dp1", stationId: "s1" }),
    });
  });

  it("acceptDeviceJoinRequest sends a watcher binding without a station binding", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ deviceId: "j1", name: "Pass", formFactor: "kds" }));
    const api = new DashboardApi("", fetchImpl);
    await api.acceptDeviceJoinRequest("j1", { name: "Pass", profileId: "dp3", watcherId: "w1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/device-join-requests/j1/accept", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pass", profileId: "dp3", watcherId: "w1" }),
    });
  });

  it("acceptDeviceJoinRequest rejects with join_request.unclaimed when this login holds no claim", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "join_request.unclaimed" } }, false, 409));
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.acceptDeviceJoinRequest("j1", { name: "Pass", profileId: "dp1", stationId: "s1" }),
    ).rejects.toMatchObject({ code: "join_request.unclaimed" });
  });

  it("revokeDevice rejects with { code } on a non-2xx (device not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "device.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.revokeDevice("nope")).rejects.toMatchObject({ code: "device.not_found" });
  });

  it("createDeviceProfile POSTs the profile body including its form factor + inactivity timeout (201)", async () => {
    const stored = {
      id: "p9",
      name: "Counter",
      canvasId: "c1",
      capabilities: ["open-cash-drawer"],
      formFactor: "till",
      inactivityTimeoutSeconds: 300,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(stored, true, 201));
    const api = new DashboardApi("", fetchImpl);
    expect(
      await api.createDeviceProfile("Counter", "c1", ["open-cash-drawer"], "till", 300, {
        receiptPrinterIds: ["pr2", "pr1"],
        paymentSlipPrinterIds: ["pr3"],
      }),
    ).toEqual(stored);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/device-profiles", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Counter",
        canvasId: "c1",
        capabilities: ["open-cash-drawer"],
        formFactor: "till",
        inactivityTimeoutSeconds: 300,
        receiptPrinterIds: ["pr2", "pr1"],
        paymentSlipPrinterIds: ["pr3"],
      }),
    });
  });

  it("updateDeviceProfile PUTs the profile body including its form factor + inactivity timeout (200)", async () => {
    const stored = {
      id: "p1",
      name: "Kitchen",
      canvasId: null,
      capabilities: ["act-as-kds"],
      formFactor: "kds",
      inactivityTimeoutSeconds: null,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(stored));
    const api = new DashboardApi("", fetchImpl);
    expect(
      await api.updateDeviceProfile("p1", "Kitchen", null, ["act-as-kds"], "kds", null, {
        receiptPrinterIds: [],
        paymentSlipPrinterIds: ["pr1"],
      }),
    ).toEqual(stored);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/device-profiles/p1", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Kitchen",
        canvasId: null,
        capabilities: ["act-as-kds"],
        formFactor: "kds",
        inactivityTimeoutSeconds: null,
        receiptPrinterIds: [],
        paymentSlipPrinterIds: ["pr1"],
      }),
    });
  });

  it("sends a profile's scope, sign-in rule and starting screen beside its lists, only as given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "p1" }));
    const api = new DashboardApi("", fetchImpl);
    const printers = { receiptPrinterIds: [], paymentSlipPrinterIds: [] };
    await api.createDeviceProfile(
      "Terrace",
      null,
      ["take-orders"],
      "phone-portrait",
      null,
      printers,
      {
        departmentId: "d1",
        allowedZoneIds: ["z2"],
        startingZoneId: "z2",
        admittedRoles: ["staff"],
        personExceptions: [{ personId: "pe1", admitted: false }],
        startingScreen: "show-schedule",
      },
    );
    await api.updateDeviceProfile("p1", "Terrace", null, [], "phone-portrait", null, printers, {
      startingScreen: null,
    });
    const bodies = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).map(([, init]) =>
      JSON.parse(init.body as string),
    );
    expect(bodies).toEqual([
      {
        name: "Terrace",
        canvasId: null,
        capabilities: ["take-orders"],
        formFactor: "phone-portrait",
        inactivityTimeoutSeconds: null,
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [],
        departmentId: "d1",
        allowedZoneIds: ["z2"],
        startingZoneId: "z2",
        admittedRoles: ["staff"],
        personExceptions: [{ personId: "pe1", admitted: false }],
        startingScreen: "show-schedule",
      },
      {
        name: "Terrace",
        canvasId: null,
        capabilities: [],
        formFactor: "phone-portrait",
        inactivityTimeoutSeconds: null,
        receiptPrinterIds: [],
        paymentSlipPrinterIds: [],
        startingScreen: null,
      },
    ]);
  });

  it("reads the departments and zones a profile can serve from the venue service", async () => {
    const departments = [{ id: "d1", name: "Restaurant", active: true }];
    const zones = [{ id: "z1", name: "Terrace", departmentId: "d1", active: false }];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ departments, zones, readiness: [], salePolicies: [] }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getProfileScopeChoices()).toEqual({ departments, zones });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/management-api/venue-service");
  });

  it("updateDevice PATCHes the whole edit to the device's route (204)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const input = {
      name: "Barra 2",
      profileId: "dp3",
      stationId: "s1",
      receiptPrinterId: "pr1",
      paymentSlipPrinterId: null,
      madeHereStationIds: ["s2"],
    };
    await expect(api.updateDevice("d1", input)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("/management-api/devices/d1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("updateDevice rejects with the refusal's code and params", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "device.binding_invalid", params: { field: "receiptPrinterId" } } },
          false,
          400,
        ),
      );
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.updateDevice("d1", {
        name: "Barra",
        profileId: "dp1",
        receiptPrinterId: "pr9",
        paymentSlipPrinterId: null,
        madeHereStationIds: [],
      }),
    ).rejects.toMatchObject({
      code: "device.binding_invalid",
      params: { field: "receiptPrinterId" },
    });
  });

  // ── Per-user language preference ───────────────────────────────────────────────────────────────

  it("getLocales GETs the public locale catalogue and venue identity", async () => {
    const body = {
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
      venueName: "Deli Test SL",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getLocales()).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/locales", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("putLocale PUTs the session locale route with a { locale } body and returns nothing", async () => {
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
  it("getCanvas GETs the canvas by id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "c1",
        name: "Till",
        definition: { formFactor: "till", tabs: [] },
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
    const def = { formFactor: "till", tabs: [] };
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
      api.updateCanvas("c1", "N", { formFactor: "till", tabs: [] }),
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
    await expect(api.createCanvas("Dup", {})).rejects.toEqual({
      code: "canvas.name_taken",
      status: 409,
    });
  });
});

describe("DashboardApi — printing (agents + printers + jobs)", () => {
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
      host: "10.0.0.9",
      port: 9100,
      localKey: null,
      pollId: null,
      watcherId: null,
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

  it("updateAgent PATCHes the display name with management credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.updateAgent("a1", { name: "Kitchen" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents/a1", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kitchen" }),
    });
  });

  it("listAgents GETs /management-api/print-agents with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(agents));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listAgents()).toEqual(agents);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agents", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("acceptPrintAgentJoinRequest POSTs the tapped number and resolves on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await expect(api.acceptPrintAgentJoinRequest("j1", { choice: "47" })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-agent-join-requests/j1/accept", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice: "47" }),
    });
  });

  it("acceptPrintAgentJoinRequest rejects with device.join_mismatch when the number was wrong", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "device.join_mismatch" } }, false, 400));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.acceptPrintAgentJoinRequest("j1", { choice: "12" })).rejects.toMatchObject({
      code: "device.join_mismatch",
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
      signal: expect.any(AbortSignal),
    });
  });

  it("listPrinterProfiles GETs /management-api/printer-profiles with credentials", async () => {
    const offers = [{ printerId: "p1", profileId: "dp1", profileName: "Mostrador" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(offers));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPrinterProfiles()).toEqual(offers);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printer-profiles", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("createPrinter POSTs the input and returns the created id (201)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "p9" }, true, 201));
    const api = new DashboardApi("", fetchImpl);
    const input = {
      name: "USB",
      transport: "usb" as const,
      localKey: "SN-1",
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
    await expect(api.createPrinter({ name: "Bad", transport: "usb" })).rejects.toMatchObject({
      code: "printer.invalid_config",
    });
  });

  it("createPrinter rejects with { code } when a device is already registered (409)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "printer.already_registered" } }, false, 409),
      );
    const api = new DashboardApi("", fetchImpl);
    await expect(
      api.createPrinter({ name: "Dup", transport: "usb", localKey: "SN-1" }),
    ).rejects.toMatchObject({ code: "printer.already_registered" });
  });

  it("requests an address check and preserves the server's timing", async () => {
    const target = { host: "192.168.20.247", port: 9100, requestedAt: 1000, expiresAt: 31000 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(target));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.probePrinterAddress({ host: target.host, port: target.port })).toEqual(target);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printer-discovery/probe", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: target.host, port: target.port }),
    });
  });

  it("startPrinterDiscovery POSTs the discovery-start route and returns the window end", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ discoveryUntil: 1234 }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.startPrinterDiscovery()).toEqual({ discoveryUntil: 1234 });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printer-discovery/start", {
      method: "POST",
      credentials: "include",
    });
  });

  it("renews the printer discovery window without reporting dashboard session activity", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ discoveryUntil: 5678 }));
    const activity = vi.fn();
    const api = new DashboardApi("", fetchImpl, undefined, activity);
    expect(await api.background.renewPrinterDiscovery()).toEqual({ discoveryUntil: 5678 });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printer-discovery/renew", {
      method: "POST",
      credentials: "include",
    });
    expect(activity).not.toHaveBeenCalled();
  });

  it("listDiscoveredPrinters GETs the discovered-printers route and decodes the rows", async () => {
    const rows = [
      {
        agentId: "a1",
        agentName: "Cocina agent",
        transport: "usb",
        localKey: "SN-1",
        make: "Epson",
        model: "TM-T20",
        name: "EPSON TM-T20",
        alreadyRegistered: false,
        printerId: null,
        lastSeenAt: "2023-11-14T22:13:20.000Z",
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listDiscoveredPrinters()).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/discovered-printers", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("asks a named print agent to pair with a Bluetooth address using the PIN, and to forget one", async () => {
    const pending = {
      id: "c1",
      kind: "pair",
      address: "00:11:22:33:44:55",
      state: "pending",
      expiresInMs: 120_000,
    } as const;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ command: pending }, true, 202))
      .mockResolvedValueOnce(
        jsonResponse({ command: { ...pending, id: "c2", kind: "forget" } }, true, 202),
      );
    const api = new DashboardApi("", fetchImpl);
    expect(await api.pairBluetooth("a1", "00:11:22:33:44:55", "0000")).toEqual({
      command: pending,
    });
    expect(await api.forgetBluetoothPairing("a1", "00:11:22:33:44:55")).toEqual({
      command: { ...pending, id: "c2", kind: "forget" },
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "/management-api/print-agents/a1/bluetooth/pair", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "00:11:22:33:44:55", pin: "0000" }),
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/management-api/print-agents/a1/bluetooth/forget",
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: "00:11:22:33:44:55" }),
      },
    );
  });

  it("updatePrinter PATCHes the printer's route and resolves undefined on an empty 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    const patch = {
      name: "Cocina 2",
      host: "10.0.0.20",
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

  it("sets a printer's watcher through its management route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new DashboardApi("", fetchImpl);
    await api.setPrinterWatcher("p1", "w1");
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/watcher", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watcherId: "w1" }),
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

  it("resendPrintJob POSTs the selected job with management credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "new-job" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.resendPrintJob("j1")).toEqual({ jobId: "new-job" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/print-jobs/j1/resend",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("getPrintJobPreview GETs the selected job preview", async () => {
    const preview = {
      text: "Receipt",
      qrData: [],
      blocks: [{ kind: "text", text: "Receipt" }],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(preview));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getPrintJobPreview("j1")).toEqual(preview);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-jobs/j1/preview", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("listRecentJobs GETs /management-api/print-jobs with credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(jobs));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listRecentJobs()).toEqual(jobs);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/print-jobs", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("testPrint POSTs the printer's measurement-sheet route and returns its job", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "j9" }, true, 202));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.testPrint("p1")).toEqual({ jobId: "j9" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/test-print", {
      method: "POST",
      credentials: "include",
    });
  });

  it("printTestPage POSTs the printer's test-page route and returns its job", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "j11" }, true, 202));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.printTestPage("p1")).toEqual({ jobId: "j11" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/print-test-page", {
      method: "POST",
      credentials: "include",
    });
  });

  it("sampleReceipt POSTs the draft paper width and resolution", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "j10" }, true, 202));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.sampleReceipt("p1", { paperWidth: "58mm", resolution: "203dpi" })).toEqual({
      jobId: "j10",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/sample-receipt", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: '{"paperWidth":"58mm","resolution":"203dpi"}',
    });
  });

  it("testPrinterDrawer POSTs a separate drawer test and returns its job", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "drawer-1" }, true, 202));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.testPrinterDrawer("p1")).toEqual({ jobId: "drawer-1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/test-drawer", {
      method: "POST",
      credentials: "include",
    });
  });

  it("testPrinterDrawer propagates permission refusals", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "auth.forbidden" } }, false, 403));
    await expect(new DashboardApi("", fetchImpl).testPrinterDrawer("p1")).rejects.toMatchObject({
      code: "auth.forbidden",
    });
  });

  it("testPrint rejects with { code } on a non-2xx (printer not found)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "printer.not_found" } }, false, 404));
    const api = new DashboardApi("", fetchImpl);
    await expect(api.testPrint("nope")).rejects.toMatchObject({ code: "printer.not_found" });
  });

  // ── Station↔printer mapping ────────────────────────────────────────────────────────────────────
  // The mutation route is `/stations/:sid/printers/:pid`, so the method's (stationId, printerId)
  // arguments must land in that order.

  it("listPrinterStations GETs the printer's stations route and decodes the pairs", async () => {
    const rows = [{ stationId: "s1", printerId: "p1" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.listPrinterStations("p1")).toEqual(rows);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/printers/p1/stations", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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
});

describe("DashboardApi — reporting (sales & takings)", () => {
  it("getSalesOverview GETs the overview route and returns the parsed shape", async () => {
    const overview = {
      businessDay: "2026-08-29",
      takings: { tenderTotal: "1234.50", tipTotal: "42.00", grossTotal: "1234.50" },
      counts: { sales: 37, corrections: 1, voids: 2 },
      openTables: { open: 3, total: 12 },
      topSellers: [{ name: "Café", quantity: "18.000", total: "36.00", variants: [] }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(overview));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getSalesOverview()).toEqual(overview);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/reports/overview", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("getDailyClose GETs the daily-close route with the businessDay query and returns the parsed shape", async () => {
    const close = {
      businessDay: "2026-08-28",
      vat: {
        byRate: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
        baseTotal: "100.00",
        taxTotal: "21.00",
        grossTotal: "121.00",
      },
      cash: {
        byOrigin: [
          {
            source: "device",
            deviceId: "device-1",
            deviceName: "Barra 1",
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
      topSellers: [
        {
          name: "Tapa",
          quantity: "9.000",
          total: "45.00",
          variants: [{ name: "Tapa grande", quantity: "9.000", total: "45.00" }],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(close));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getDailyClose("2026-08-28")).toEqual(close);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/reports/daily-close?businessDay=2026-08-28",
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
  });

  it("getSalesPeriod GETs the period route with from/to and returns the parsed shape", async () => {
    const period = {
      from: "2026-08-01",
      to: "2026-08-28",
      vat: {
        byRate: [{ rate: "10.00", base: "500.00", tax: "50.00" }],
        baseTotal: "500.00",
        taxTotal: "50.00",
        grossTotal: "550.00",
      },
      topSellers: [{ name: "Menú", quantity: "120.000", total: "1440.00", variants: [] }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(period));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getSalesPeriod("2026-08-01", "2026-08-28")).toEqual(period);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/reports/period?from=2026-08-01&to=2026-08-28",
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
  });

  it("getCategorySales GETs the categories route with the range, mode and extras flag", async () => {
    const report = {
      mode: "current",
      tree: [
        {
          kind: "category",
          id: "c1",
          name: "Bebidas del día",
          depth: 0,
          gross: "12.10",
          net: "10.00",
          direct: { gross: "12.10", net: "10.00", lines: 2 },
          children: [],
        },
      ],
      gross: "12.10",
      net: "10.00",
      grossComplete: false,
      linesWithoutGross: 3,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(report));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getCategorySales("2026-08-01", "2026-08-28", "current", true)).toEqual(report);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/reports/categories?from=2026-08-01&to=2026-08-28&mode=current&extrasIntoDish=true",
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
    await api.getCategorySales("2026-08-02", "2026-08-02", "at_time_of_sale", false);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/management-api/reports/categories?from=2026-08-02&to=2026-08-02&mode=at_time_of_sale&extrasIntoDish=false",
      { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
    );
  });

  it("getReportPrinters GETs the report printers route", async () => {
    const printers = [{ id: "p1", name: "Barra" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(printers));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getReportPrinters()).toEqual(printers);
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/reports/printers", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("printCategorySales POSTs the range, mode, extras flag and printer, and returns the job id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: "job-1" }, true, 202));
    const api = new DashboardApi("", fetchImpl);
    const input = {
      from: "2026-08-01",
      to: "2026-08-28",
      mode: "at_time_of_sale" as const,
      extrasIntoDish: false,
      printerId: "p1",
    };
    expect(await api.printCategorySales(input)).toEqual({ jobId: "job-1" });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/reports/categories/print", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("getOverdueOrders GETs the overdue-orders route and returns the parsed shape", async () => {
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
      signal: expect.any(AbortSignal),
    });
  });
});

describe("DashboardApi — recent logs and log verbosity", () => {
  it("getRecentLogs GETs the recent endpoint with the given limit", async () => {
    const lines = [{ at: "2026-08-31T10:00:00Z", level: "info", event: "boot" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ lines }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getRecentLogs(50)).toEqual({ lines });
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/recent?limit=50", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("getRecentLogs defaults the limit to 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ lines: [] }));
    const api = new DashboardApi("", fetchImpl);
    await api.getRecentLogs();
    expect(fetchImpl).toHaveBeenCalledWith("/management-api/diagnostics/recent?limit=200", {
      method: "GET",
      credentials: "include",
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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

it("renews a pairing hold without reporting dashboard session activity", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ openUntil: "2026-09-12T12:15:00Z" }));
  const activity = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, activity);
  expect(await api.background.renewPairingHold("h1")).toEqual({
    openUntil: "2026-09-12T12:15:00Z",
  });
  expect(fetchImpl).toHaveBeenCalledWith("/management-api/pairing-mode/holds/h1/renew", {
    method: "POST",
    credentials: "include",
  });
  expect(activity).not.toHaveBeenCalled();
});

describe("the card readers' outside-provider reads", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A fetch that answers `body` after `ms`, and rejects as a real fetch does if it is aborted first. */
  function answersAfter(ms: number, body: unknown): FetchLike {
    return vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(jsonResponse(body)), ms);
          init.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
  }

  /** Settles `promise` into an inspectable record without letting a rejection go unhandled. */
  function track<T>(promise: Promise<T>): { settled?: { value?: T; error?: unknown } } {
    const record: { settled?: { value?: T; error?: unknown } } = {};
    promise.then(
      (value) => (record.settled = { value }),
      (error: unknown) => (record.settled = { error }),
    );
    return record;
  }

  it.each([
    ["a reader's status", (api: DashboardApi): Promise<unknown> => api.readerStatus("r-1")],
    [
      "the provider's available readers",
      (api: DashboardApi): Promise<unknown> => api.availableReaders("acme"),
    ],
  ])("waits for %s past a minute, up to four minutes", async (_what, read) => {
    const fetchImpl = answersAfter(240_000, { ok: 1 });
    const out = track(read(new DashboardApi("", fetchImpl)));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(out.settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(out.settled).toEqual({ value: { ok: 1 } });
  });

  it("still gives up on another read at 30 seconds", async () => {
    const out = track(new DashboardApi("", answersAfter(240_000, [])).listReaders());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(out.settled).toEqual({ error: { code: "connection.timed_out" } });
  });

  it("allows the alerts response to arrive after the default read limit", async () => {
    const response = { visible: true, alerts: [] };
    const out = track(new DashboardApi("", answersAfter(50_000, response)).listAlerts());

    await vi.advanceTimersByTimeAsync(40_000);
    expect(out.settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(out.settled).toEqual({ value: response });
  });

  it("still bounds an alerts read that never answers", async () => {
    const out = track(new DashboardApi("", answersAfter(240_000, [])).listAlerts());

    await vi.advanceTimersByTimeAsync(54_000);
    expect(out.settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(out.settled).toEqual({ error: { code: "connection.timed_out" } });
  });
});

it("reads and replaces venue kitchen timing defaults with passive background reads", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    jsonResponse({
      warmAfterMinutes: 3,
      overdueAfterMinutes: 7,
      forgottenAfterMinutes: 12,
    }),
  );
  const api = new DashboardApi("", fetchImpl);
  expect(await api.getKitchenTimingDefaults()).toEqual({
    warmAfterMinutes: 3,
    overdueAfterMinutes: 7,
    forgottenAfterMinutes: 12,
  });
  expect(fetchImpl).toHaveBeenNthCalledWith(
    1,
    "/management-api/kitchen-timing-defaults",
    expect.objectContaining({ method: "GET" }),
  );
  await api.background.getKitchenTimingDefaults();
  expect(fetchImpl.mock.calls[1]![0]).toBe("/management-api/kitchen-timing-defaults");
  expect(fetchImpl.mock.calls[1]![1]!.method).toBe("GET");
  expect(new Headers(fetchImpl.mock.calls[1]![1]!.headers).get("x-waitron-live")).toBe("1");
  await api.setKitchenTimingDefaults({
    warmAfterMinutes: 4,
    overdueAfterMinutes: 8,
    forgottenAfterMinutes: 16,
  });
  expect(fetchImpl).toHaveBeenNthCalledWith(
    3,
    "/management-api/kitchen-timing-defaults",
    expect.objectContaining({
      method: "PUT",
      body: '{"warmAfterMinutes":4,"overdueAfterMinutes":8,"forgottenAfterMinutes":16}',
    }),
  );
});
