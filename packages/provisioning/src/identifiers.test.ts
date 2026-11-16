import { quoteLiteral } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { generatePassword, quoteIdent } from "./identifiers.js";

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

  it("passes through quoteLiteral unchanged", () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      expect(quoteLiteral(password)).toBe(`'${password}'`);
    }
  });
});
