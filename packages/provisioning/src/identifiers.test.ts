import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertIdentifier, generatePassword, quoteIdent, quoteLiteral } from "./identifiers.js";

describe("assertIdentifier", () => {
  it("accepts an ordinary lower-case name", () => {
    expect(() => assertIdentifier("database", "waitron_production")).not.toThrow();
  });

  it.each([
    ["empty", ""],
    ["leading digit", "1waitron"],
    ["upper case", "Waitron"],
    ["a hyphen", "waitron-prod"],
    ["a quote", 'waitron"; drop table tenants; --'],
    ["a space", "waitron prod"],
    ["too long", `a${"b".repeat(63)}`],
  ])("refuses %s", (_label, value) => {
    let thrown: unknown;
    try {
      assertIdentifier("database", value);
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.invalid_identifier");
    expect(thrown.params).toEqual({ kind: "database", value });
  });
});

describe("quoteIdent", () => {
  it("double-quotes", () => {
    expect(quoteIdent("waitron_app")).toBe('"waitron_app"');
  });

  it("doubles an inner quote", () => {
    // Unreachable through assertIdentifier, which refuses a quote outright; quoteIdent is exported
    // and a future caller may not validate first.
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

  it("escapes a backslash and marks the literal E", () => {
    expect(quoteLiteral("a\\b")).toBe("E'a\\\\b'");
    expect(quoteLiteral("a\\'b")).toBe("E'a\\\\''b'");
  });
});
