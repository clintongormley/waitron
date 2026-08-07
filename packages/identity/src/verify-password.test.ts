import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  assertPasswordLength,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "./verify-password.js";

describe("password", () => {
  it("round-trips a correct password", () => {
    expect(verifyPassword("correct horse", hashPassword("correct horse"))).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(verifyPassword("wrong", hashPassword("correct horse"))).toBe(false);
  });
  it("accepts a password at the minimum length", () => {
    expect(() => assertPasswordLength("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });
  it("throws password.too_short below the minimum", () => {
    try {
      assertPasswordLength("x".repeat(MIN_PASSWORD_LENGTH - 1));
      throw new Error("expected throw");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("password.too_short");
    }
  });
});
