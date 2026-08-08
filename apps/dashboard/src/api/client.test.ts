import { describe, expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/**
 * An empty 200 — `text()` → "" — the shape the void-returning management routes answer with
 * (`logout`, `updatePerson`, `resetPin`, `setPassword`). Exercises `#request`'s empty-body branch,
 * which resolves `undefined` instead of `JSON.parse`-ing nothing.
 */
function emptyResponse(): Response {
  return { ok: true, status: 200, json: async () => undefined, text: async () => "" } as Response;
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

  it("logout DELETEs the session and resolves undefined on an empty 200 body", async () => {
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

  it("updatePerson PATCHes the addressed person (empty 200 body)", async () => {
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

  it("resetPin POSTs the new pin to the addressed person's reset-pin route (empty 200 body)", async () => {
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

  it("setPassword POSTs the new password to the addressed person's password route (empty 200 body)", async () => {
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
