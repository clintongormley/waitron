import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  assertIdentifier,
  generatePassword,
  quoteIdent,
  quoteLiteral,
  withRole,
} from "./identifiers.js";

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
    // `applyInstance` and `InstanceAction` are exported (`index.ts`) and `password` is typed
    // `string`, so the old safety was a property of ONE caller rather than of the code — and this
    // package's own `instance-apply.pg.test.ts` already passes a hand-written password through
    // that path.
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

describe("withRole", () => {
  it("appends a libpq role option that pg parses back to the role", async () => {
    // The whole point of the parameter: it makes `migrate` and the post-migrate role work run AS
    // `waitron_migrator` over the ADMIN's credentials (a session `SET ROLE`), so every table is
    // migrator-owned. The receipt is `pg`'s own parse — the round-trip, not the string shape.
    const uri = withRole("postgres://a:p@h:5432/db", "waitron_migrator");
    const pg = await import("pg");
    // `connectionParameters` is on the runtime `Client` but not in `@types/pg`'s surface.
    const client = new pg.default.Client({ connectionString: uri }) as unknown as {
      connectionParameters: { options: string };
    };
    expect(client.connectionParameters.options).toBe("-c role=waitron_migrator");
  });

  it("refuses a role name outside the identifier grammar", () => {
    // Validate-and-throw, the §3 rule: this option is embedded in a connection string, never bound.
    let thrown: unknown;
    try {
      withRole("postgres://a:p@h:5432/db", "waitron migrator");
    } catch (error) {
      thrown = error;
    }
    expect(isAppError(thrown)).toBe(true);
    if (!isAppError(thrown)) return;
    expect(thrown.code).toBe("provisioning.invalid_identifier");
    expect(thrown.params).toEqual({ kind: "role", value: "waitron migrator" });
  });

  it("refuses a URI that already carries an options parameter, rather than merging", () => {
    // Merging two libpq option strings is not attempted — a URI this tool composes never carries
    // `options`, so a pre-existing one is a programmer error, not an operator input.
    expect(() =>
      withRole("postgres://a:p@h:5432/db?options=-c+statement_timeout=0", "waitron_migrator"),
    ).toThrow(/options/);
  });
});
