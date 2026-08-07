import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  MANAGEMENT_COOKIE,
  clearManagementCookie,
  requireManagementSession,
  setManagementCookie,
} from "./management-session.js";

const VALID = "11111111-1111-4111-8111-111111111111";

describe("management-session cookie", () => {
  it("sets an httpOnly, SameSite=Strict cookie", async () => {
    const app = new Hono();
    app.get("/set", (c) => {
      setManagementCookie(c, VALID, true);
      return c.body(null, 204);
    });
    const res = await app.request("/set");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${MANAGEMENT_COOKIE}=${VALID}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
  });
  it("requireManagementSession returns the id from a valid cookie", async () => {
    const app = new Hono();
    app.get("/read", (c) => c.json({ id: requireManagementSession(c) }));
    const res = await app.request("/read", {
      headers: { cookie: `${MANAGEMENT_COOKIE}=${VALID}` },
    });
    expect(await res.json()).toEqual({ id: VALID });
  });
  it("requireManagementSession throws when the cookie is missing", async () => {
    const app = new Hono();
    app.get("/read", (c) => c.json({ id: requireManagementSession(c) }));
    let thrown: unknown;
    app.onError((err, c) => {
      thrown = err;
      return c.body(null, 500);
    });
    await app.request("/read");
    expect(isAppError(thrown) && thrown.code).toBe("management_session.required");
  });
  it("requireManagementSession throws when the cookie is present but not a UUID", async () => {
    const app = new Hono();
    app.get("/read", (c) => c.json({ id: requireManagementSession(c) }));
    let thrown: unknown;
    app.onError((err, c) => {
      thrown = err;
      return c.body(null, 500);
    });
    await app.request("/read", {
      headers: { cookie: `${MANAGEMENT_COOKIE}=not-a-uuid` },
    });
    expect(isAppError(thrown) && thrown.code).toBe("management_session.required");
  });
  it("clearManagementCookie expires the cookie", async () => {
    const app = new Hono();
    app.get("/clear", (c) => {
      clearManagementCookie(c);
      return c.body(null, 204);
    });
    const res = await app.request("/clear");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${MANAGEMENT_COOKIE}=`);
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).toMatch(/Path=\//i);
  });
});
