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

test("isValidEmail accepts and refuses these address shapes", () => {
  for (const address of [
    "owner@x.com",
    "a@b.c",
    "first.last+tag@sub.example.co.uk",
    "  padded@x.com \n",
    "ñandú@dominio.es",
    "!@!.!",
    "a@.b.c",
    "a@b..c",
    "a@b.c.",
  ])
    expect(isValidEmail(address), address).toBe(true);
  for (const address of [
    "",
    "   ",
    "nope",
    "a@b",
    "@b.c",
    "a@.c",
    "a@c.",
    "a@.",
    "a@b.c@d.e",
    "a@@b.c",
    "a b@c.d",
    "a@b.c d",
    "a\t@b.c",
    "a@b\u00a0.c",
    "a@b.c\u2028x",
  ])
    expect(isValidEmail(address), JSON.stringify(address)).toBe(false);
});

test("isValidEmail refuses a crafted 200,000-character address within one second", () => {
  const crafted = `!@!.${"!.".repeat(100_000)}@`;
  const started = performance.now();
  expect(isValidEmail(crafted)).toBe(false);
  expect(performance.now() - started).toBeLessThan(1000);
});
