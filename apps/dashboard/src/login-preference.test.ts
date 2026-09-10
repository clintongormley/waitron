import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTabLoginPreference,
  disablePersistentLoginPreference,
  forgetLoginPreference,
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
  it("retains an authenticated email and method for this tab without persistent consent", () => {
    rememberSuccessfulLogin(" Owner@Example.com ", "password", false);
    expect(readLoginPreference()).toEqual({
      email: "owner@example.com",
      method: "password",
      persistent: false,
    });
    expect(localStorage.length).toBe(0);
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
    expect(() => forgetLoginPreference("owner@example.com")).not.toThrow();
    local.mockRestore();
  });

  it("clears a tab choice without deleting persistent consent for that account", () => {
    const saved = JSON.stringify({ email: "owner@example.com", method: "passkey" });
    sessionStorage.setItem("waitron-login-preference", saved);
    localStorage.setItem("waitron-login-preference", saved);
    clearTabLoginPreference();
    expect(sessionStorage.getItem("waitron-login-preference")).toBeNull();
    expect(localStorage.getItem("waitron-login-preference")).toBe(saved);
  });

  it("removes persistence only for the account being shown", () => {
    const tab = JSON.stringify({ email: "staff@example.com", method: "passkey" });
    const saved = JSON.stringify({ email: "owner@example.com", method: "password" });
    sessionStorage.setItem("waitron-login-preference", tab);
    localStorage.setItem("waitron-login-preference", saved);
    forgetLoginPreference("staff@example.com");
    expect(sessionStorage.getItem("waitron-login-preference")).toBeNull();
    expect(localStorage.getItem("waitron-login-preference")).toBe(saved);
    disablePersistentLoginPreference("owner@example.com");
    expect(localStorage.getItem("waitron-login-preference")).toBeNull();
  });
});
