import { afterEach, describe, expect, it } from "vitest";
import {
  forgetLoginPreference,
  readLoginPreference,
  rememberSuccessfulLogin,
} from "./login-preference.js";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

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
});
