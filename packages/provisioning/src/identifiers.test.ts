import { describe, expect, it } from "vitest";
import { generatePassword, quoteIdent, quoteLiteral } from "./identifiers.js";

describe("quoteIdent", () => {
  it("double-quotes", () => {
    expect(quoteIdent("waitron_app")).toBe('"waitron_app"');
  });

  it("doubles an inner quote", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});

describe("generatePassword", () => {
  it("is 32 URL- and SQL-literal-safe characters", () => {
    expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("does not repeat", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe("quoteLiteral", () => {
  it("leaves a generated password byte-identical to the naive form", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      expect(quoteLiteral(password)).toBe(`'${password}'`);
    }
  });

  it("doubles a single quote, so a password cannot end the literal early", () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(quoteLiteral("'; alter role waitron_app superuser; --")).toBe(
      "'''; alter role waitron_app superuser; --'",
    );
  });

  it("keeps a backslash as itself and doubles only the quote", () => {
    expect(quoteLiteral("a\\b")).toBe("'a\\b'");
    expect(quoteLiteral("a\\'b")).toBe("'a\\''b'");
  });
});
