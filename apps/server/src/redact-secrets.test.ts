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

  // Control for the query-parameter branch: `pg` reads `password` case-sensitively (`?PASSWORD=`
  // parses to a null password, measured), and a non-password parameter must survive untouched, or
  // the branch above would also pass with a rule that eats every query string.
  it("leaves other query parameters, and a differently-cased one, alone", () => {
    const text = "postgres://u@localhost/db?sslmode=require&application_name=waitron";
    expect(redactSecrets(text)).toBe(text);
  });
});
