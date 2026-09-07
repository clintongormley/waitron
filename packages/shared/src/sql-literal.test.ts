import { describe, expect, it } from "vitest";
import { quoteLiteral } from "./sql-literal.js";

describe("quoteLiteral", () => {
  it("keeps a value with no quote or backslash in the plain form", () => {
    expect(quoteLiteral("abc123")).toBe("'abc123'");
  });

  it("doubles a single quote so the value cannot close the literal early", () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(quoteLiteral("'; drop role waitron_app; --")).toBe("'''; drop role waitron_app; --'");
  });

  it("escapes a backslash and marks the literal E", () => {
    // Under a session where `standard_conforming_strings` is off, a lone backslash in a plain
    // literal is an escape character; `E'…'` with the backslash doubled is unambiguous either way.
    expect(quoteLiteral("a\\b")).toBe("E'a\\\\b'");
  });

  it("doubles both a quote and a backslash under the E form", () => {
    expect(quoteLiteral("a\\'b")).toBe("E'a\\\\''b'");
  });
});
