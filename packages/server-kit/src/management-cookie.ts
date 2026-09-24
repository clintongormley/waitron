// This package does not import `@waitron/identity`, so `management_session.required` reaches this
// file only through this line.
import "./errors.js";
import { AppError, isUuid } from "@waitron/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const MANAGEMENT_COOKIE = "waitron_management_session";

/** `secure` is caller-supplied: false where there is no TLS to attach it to, as on loopback dev. */
export function setManagementCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, MANAGEMENT_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
  });
}

/** `path` must match `setManagementCookie`'s, or the browser keeps the original cookie. */
export function clearManagementCookie(c: Context): void {
  deleteCookie(c, MANAGEMENT_COOKIE, { path: "/" });
}

export function readManagementSessionToken(c: Context): string | null {
  return getCookie(c, MANAGEMENT_COOKIE) ?? null;
}

/** Screens the cookie's SHAPE only; the live-session lookup is `@waitron/identity`'s. */
export function requireManagementSession(c: Context): string {
  const token = readManagementSessionToken(c);
  if (token === null || !isUuid(token)) throw new AppError("management_session.required", {});
  return token;
}
