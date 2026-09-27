import { describe, expect, it } from "vitest";
import { quoteLiteral } from "./sql-literal.js";

describe("quoteLiteral", () => {
  it("wraps a value with no quote in single quotes, unchanged", () => {
    expect(quoteLiteral("abc123")).toBe("'abc123'");
  });

  it("doubles a single quote so the value cannot close the literal early", () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(quoteLiteral("'; drop role waitron_app; --")).toBe("'''; drop role waitron_app; --'");
  });

  it("keeps a backslash as itself, since SQLite gives it no escaping meaning", () => {
    expect(quoteLiteral("a\\b")).toBe("'a\\b'");
  });

  it("doubles a quote beside a backslash and leaves the backslash alone", () => {
    expect(quoteLiteral("a\\'b")).toBe("'a\\''b'");
  });

  it("quotes an empty value as an empty literal", () => {
    expect(quoteLiteral("")).toBe("''");
  });
});
