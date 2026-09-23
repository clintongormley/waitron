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
    // The VALUE is echoed here, unlike everywhere else in this package: a database or role name is
    // operator-typed configuration, never a secret, and an error that withheld it would be
    // unactionable. `kind` says which of the two was wrong.
    expect(thrown.params).toEqual({ kind: "database", value });
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

describe("quoteLiteral", () => {
  it("leaves a generated password byte-identical to the naive form", () => {
    // What makes this change behaviour-preserving for every path a real run takes: base64url is
    // `[A-Za-z0-9_-]`, so nothing is escaped and the emitted SQL is exactly what it was before.
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      expect(quoteLiteral(password)).toBe(`'${password}'`);
    }
  });

  it("doubles a single quote, so a password cannot end the literal early", () => {
    // The caller this used to argue about is gone: nothing in the tree declares `applyInstance` or
    // `InstanceAction` any more (grepped over every `.ts` and `.md` in the worktree — only
    // historical plans under `docs/superpowers/plans/` still name them), and this package emits no
    // `CREATE ROLE … PASSWORD` literal at all. What the case pins is unchanged and is about the FUNCTION, not a caller:
    // `quoteLiteral` takes a plain `string` (`packages/shared/src/sql-literal.ts`, re-exported by
    // `./identifiers.ts`), so a value carrying a quote must not be able to close the literal early
    // whoever passes it. Its one live caller in the tree today is the change feed, which quotes the
    // `CREATE TRIGGER` arguments it builds (`packages/db/src/change-feed.ts`); this package only
    // re-exports it, and this suite is the only file here that calls it.
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(quoteLiteral("'; alter role waitron_app superuser; --")).toBe(
      "'''; alter role waitron_app superuser; --'",
    );
  });

  it("escapes a backslash and marks the literal E", () => {
    // For a session where `standard_conforming_strings` is off, where a lone backslash in a plain
    // literal is an escape character rather than itself. `E'…'` makes the doubling explicit either
    // way — the same thing `PQescapeLiteral` does.
    expect(quoteLiteral("a\\b")).toBe("E'a\\\\b'");
    expect(quoteLiteral("a\\'b")).toBe("E'a\\\\''b'");
  });
});
