import { test, expect } from "vitest";
import { normalizeEmail } from "./email.js";

test("normalizeEmail trims and lowercases", () => {
  expect(normalizeEmail("  Owner@X.COM ")).toBe("owner@x.com");
});
