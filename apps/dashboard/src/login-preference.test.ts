import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetLoginPreference,
  prepareGoogleLoginPreference,
  consumeGoogleLoginPreference,
  readLoginPreference,
  rememberSuccessfulLogin,
} from "./login-preference.js";

function clearStorage(): void {
  sessionStorage.clear();
  localStorage.clear();
}

beforeEach(clearStorage);
afterEach(clearStorage);

describe("login preference", () => {
  it("stores neither email nor method without explicit consent", () => {
    rememberSuccessfulLogin(" Owner@Example.com ", "password", false);
    expect(readLoginPreference()).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("persists only the email and method when consent is given", () => {
    rememberSuccessfulLogin("owner@example.com", "passkey", true);
    expect(readLoginPreference()).toEqual({
      email: "owner@example.com",
      method: "passkey",
      persistent: true,
    });
    expect(JSON.parse(localStorage.getItem("waitron-login-preference")!)).toEqual({
      email: "owner@example.com",
      method: "passkey",
    });
  });

  it("ignores malformed storage and forgets both lifetimes", () => {
    sessionStorage.setItem("waitron-login-preference", '{"email":"not-email","method":"password"}');
    localStorage.setItem("waitron-login-preference", "broken");
    expect(readLoginPreference()).toBeNull();
    forgetLoginPreference();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("falls back when browser storage access is denied", () => {
    const local = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(readLoginPreference()).toBeNull();
    expect(() => forgetLoginPreference()).not.toThrow();
    local.mockRestore();
  });

  it("forgets every stored identity when switching accounts", () => {
    sessionStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "staff@example.com", method: "passkey" }),
    );
    localStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "owner@example.com", method: "password" }),
    );
    forgetLoginPreference();
    expect(readLoginPreference()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("clears an old saved account when the next login does not opt in", () => {
    rememberSuccessfulLogin("owner@example.com", "passkey", true);
    rememberSuccessfulLogin("staff@example.com", "password", false);
    expect(readLoginPreference()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("does not restore an unchecked tab shortcut on a later visit", () => {
    sessionStorage.setItem(
      "waitron-login-preference",
      JSON.stringify({ email: "owner@example.com", method: "passkey" }),
    );
    expect(readLoginPreference()).toBeNull();
  });

  it("updates the opted-in account's last successful method", () => {
    rememberSuccessfulLogin("owner@example.com", "password", true);
    rememberSuccessfulLogin("owner@example.com", "passkey", true);
    expect(readLoginPreference()).toEqual({
      email: "owner@example.com",
      method: "passkey",
      persistent: true,
    });
  });
  it("carries only opted-in consent across Google navigation and consumes it once", () => {
    prepareGoogleLoginPreference(true, "saved@example.com");
    expect(localStorage.length).toBe(0);
    expect(readLoginPreference()).toBeNull();
    expect(consumeGoogleLoginPreference(true)).toEqual({
      method: "google",
      persistent: true,
      rememberedEmail: "saved@example.com",
    });
    expect(consumeGoogleLoginPreference(true)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it("does not put an unchecked Google attempt in storage", () => {
    prepareGoogleLoginPreference(true);
    prepareGoogleLoginPreference(false);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("clears redirect consent when the account is forgotten", () => {
    prepareGoogleLoginPreference(true);
    forgetLoginPreference();
    expect(consumeGoogleLoginPreference(true)).toBeUndefined();
  });

  it.each([
    "broken",
    "null",
    JSON.stringify({ expiresAt: Date.now() - 1 }),
    JSON.stringify({ expiresAt: Date.now() + 60000, rememberedEmail: 123 }),
    JSON.stringify({ expiresAt: "tomorrow" }),
  ])("ignores malformed or expired redirect consent %s", (value) => {
    sessionStorage.setItem("waitron-google-login-preference", value);
    expect(consumeGoogleLoginPreference(true)).toBeUndefined();
    expect(sessionStorage.length).toBe(0);
  });

  it("allows remembered consent only for the same authenticated email", () => {
    rememberSuccessfulLogin("SAVED@example.com", "google", true, " saved@example.com ");
    expect(readLoginPreference()?.method).toBe("google");
    rememberSuccessfulLogin("other@example.com", "google", true, "saved@example.com");
    expect(readLoginPreference()).toBeNull();
  });

  it("tolerates denied Google intent storage", () => {
    const storage = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(() => prepareGoogleLoginPreference(true)).not.toThrow();
    expect(consumeGoogleLoginPreference(true)).toBeUndefined();
    storage.mockRestore();
  });
});
