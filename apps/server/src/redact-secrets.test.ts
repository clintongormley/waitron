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

  // The three shapes below were fed to the installed `pg` (8.22.0) and each marked value came back
  // as `connectionParameters.password` — they are passwords, not decoration:
  //   postgres://u@localhost/db?password=QUERY_SECRET       -> password "QUERY_SECRET"
  //   postgres://:EMPTY_USER_SECRET@localhost/db            -> password "EMPTY_USER_SECRET"
  //   postgres://u:p@localhost/db?password=OVERRIDE_SECRET  -> password "OVERRIDE_SECRET"
  // The first version of this function masked none of them.
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

  // Both positions in one string, and `pg` takes the QUERY one as the effective password: masking
  // only the user-info half would leave the password that was actually used in the log.
  it("masks both halves when a query password overrides a user-info one", () => {
    expect(redactSecrets("postgres://u:p@localhost/db?password=OVERRIDE_SECRET")).toBe(
      "postgres://u:***@localhost/db?password=***",
    );
  });

  // The blind spot the doc names, pinned so a future widening has to notice it: `"` terminates the
  // authority scan, so a password carrying one is left whole when the `@` sits after that quote.
  // The terminator is deliberate — a log line is JSON, where an unescaped `"` is structure and
  // never password text, and letting the scan cross it would mangle the line for `createLogReader`.
  it("does NOT mask a password whose double quote precedes the @ — a stated blind spot", () => {
    const text = 'pw with "quote": postgres://u:pa"ss@host/db';
    expect(redactSecrets(text)).toBe(text);
  });

  // Control for the query-parameter branch: `pg` reads `password` case-sensitively, and a
  // non-password parameter must survive untouched, or the branch above would also pass with a rule
  // that eats every query string. Measured on `postgres://u@localhost/db?PASSWORD=UPPER_SECRET`:
  // `pg-connection-string@2.14.0`'s `parse()` returns the EMPTY STRING for `password`, and a
  // `pg@8.22.0` `Client` then reports `null` because it falls back to its default when the parsed
  // value is empty. (An earlier version of this comment said "parses to a null password" — the
  // conclusion holds, the upper-case parameter is not a credential position, but null is what the
  // Client reports, not what the parser returns.)
  // Two shapes the first version of the character classes stopped at, both measured against the
  // installed parser (`pg-connection-string@2.14.0`, the one `pg@8.22.0` resolves):
  //   postgres://u:p@ss@localhost/db      -> password "p@ss"
  //   postgres://u:se cret@localhost/db   -> password "se cret"
  // An unencoded `@` is legal in the user-info because WHATWG `new URL` splits the authority on the
  // LAST `@`; a space survives because `parse` percent-encodes spaces before handing the string to
  // `new URL`. Masking up to the first `@` left `ss` on the page, and the spaced password was not
  // masked at all.
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

  // The same two shapes in the query position: `?password=se cret` also parses to "se cret".
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
