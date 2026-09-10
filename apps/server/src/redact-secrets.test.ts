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
});
