import { describe, expect, it } from "vitest";
import { quoteIdent } from "./identifiers.js";

describe("quoteIdent", () => {
  it("double-quotes", () => {
    expect(quoteIdent("waitron_app")).toBe('"waitron_app"');
  });

  it("doubles an inner quote", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});
