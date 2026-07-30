import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { assertIdentifier, generatePassword, quoteIdent } from "./identifiers.js";

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
      assertIdentifier("role", value);
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.invalid_identifier");
    // The VALUE is echoed here, unlike everywhere else in this package: a database or role name is
    // operator-typed configuration, never a secret, and an error that withheld it would be
    // unactionable. `kind` says which of the two was wrong.
    expect(thrown.params).toEqual({ kind: "role", value });
  });
});

describe("quoteIdent", () => {
  it("double-quotes", () => {
    expect(quoteIdent("waitron_app")).toBe('"waitron_app"');
  });

  it("doubles an inner quote", () => {
    // Unreachable through assertIdentifier, which refuses a quote outright. Kept because
    // quoteIdent is exported and a future caller may not validate first — defence in depth, not
    // dead code.
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
