import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  assertPasswordLength,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "./verify-password.js";

describe("password", () => {
  it("round-trips a correct password", async () => {
    expect(await verifyPassword("correct horse", hashPassword("correct horse"))).toBe(true);
  });
  it("rejects a wrong password", async () => {
    expect(await verifyPassword("wrong", hashPassword("correct horse"))).toBe(false);
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

  it("lets the event loop turn while it derives the key", async () => {
    const stored = hashPassword("correct horse");
    const order: string[] = [];
    const verified = verifyPassword("correct horse", stored).then(() => order.push("verified"));
    setImmediate(() => order.push("turned"));
    await verified;
    expect(order).toEqual(["turned", "verified"]);
  });
});
