import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact-secrets.js";

describe("redactSecrets", () => {
  it("masks the password in a postgres URL", () => {
    expect(redactSecrets("connect failed: postgres://waitron:hunter2@db:5432/waitron")).toBe(
      "connect failed: postgres://waitron:***@db:5432/waitron",
    );
  });

  // Control: a URL with no credentials must come back byte-identical, or the "masks a password"
  // case above would also pass with a function that mangles every URL.
  it("leaves a URL with no credentials alone", () => {
    const text = "GET https://waitron.example/health returned 503";
    expect(redactSecrets(text)).toBe(text);
  });

  // Control: an ordinary message must be untouched.
  it("leaves an ordinary message alone", () => {
    const text = "TypeError: Cannot read properties of undefined (reading 'query')";
    expect(redactSecrets(text)).toBe(text);
  });

  it("masks every occurrence across a multi-line stack", () => {
    const stack = [
      "Error: connect ECONNREFUSED postgres://a:one@h/d",
      "    at Client (postgres://b:two@h2/d2)",
      "    at runEntry (/app/node-entry.js:1:1)",
    ].join("\n");
    expect(redactSecrets(stack)).toBe(
      [
        "Error: connect ECONNREFUSED postgres://a:***@h/d",
        "    at Client (postgres://b:***@h2/d2)",
        "    at runEntry (/app/node-entry.js:1:1)",
      ].join("\n"),
    );
  });

  it("masks an empty password, which is still a credential position", () => {
    expect(redactSecrets("postgres://user:@host/db")).toBe("postgres://user:***@host/db");
  });

  it("masks a password carried as a URL query parameter", () => {
    expect(redactSecrets("connect failed: postgres://u@localhost/db?password=QUERY_SECRET")).toBe(
      "connect failed: postgres://u@localhost/db?password=***",
    );
  });

  it("masks a password whose user half is empty", () => {
    expect(redactSecrets("connect failed: postgres://:EMPTY_USER_SECRET@localhost/db")).toBe(
      "connect failed: postgres://:***@localhost/db",
    );
  });

  // `pg` takes the QUERY one as the effective password when both are present, so masking only the
  // user-info half would leave the password that was actually used in the log.
  it("masks both halves when a query password overrides a user-info one", () => {
    expect(redactSecrets("postgres://u:p@localhost/db?password=OVERRIDE_SECRET")).toBe(
      "postgres://u:***@localhost/db?password=***",
    );
  });

  // The blind spot the doc names, pinned so a future widening has to notice it. The `"` terminator
  // is deliberate: letting the scan cross it would mangle the JSON line for `createLogReader`.
  it("does NOT mask a password whose double quote precedes the @ — a stated blind spot", () => {
    const text = 'pw with "quote": postgres://u:pa"ss@host/db';
    expect(redactSecrets(text)).toBe(text);
  });

  // An unencoded `@` is legal in the user-info because WHATWG `new URL` splits the authority on the
  // LAST `@`.
  it("masks a password containing an unencoded @", () => {
    expect(redactSecrets("connect failed: postgres://u:p@ss@localhost/db")).toBe(
      "connect failed: postgres://u:***@localhost/db",
    );
  });

  it("masks a password containing a space", () => {
    expect(redactSecrets("connect failed: postgres://u:se cret@localhost/db")).toBe(
      "connect failed: postgres://u:***@localhost/db",
    );
  });

  // The query position: a space does not end the password there either.
  it("masks a query password containing a space", () => {
    expect(redactSecrets("postgres://u@localhost/db?password=se cret")).toBe(
      "postgres://u@localhost/db?password=***",
    );
  });

  it("leaves other query parameters, and a differently-cased one, alone", () => {
    const text = "postgres://u@localhost/db?sslmode=require&application_name=waitron";
    expect(redactSecrets(text)).toBe(text);
  });
});
