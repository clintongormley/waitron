import { test, expect } from "vitest";
import { normalizeEmail, isValidEmail } from "./email.js";

test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  Owner@X.COM ")).toBe("owner@x.com");
});

test("isValidEmail accepts a plain address and rejects malformed", () => {
  expect(isValidEmail("owner@x.com")).toBe(true);
  expect(isValidEmail("nope")).toBe(false);
  expect(isValidEmail("a@b")).toBe(false);
  expect(isValidEmail("")).toBe(false);
});
