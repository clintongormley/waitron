import { describe, expect, it } from "vitest";
import { hashSessionToken } from "./session-token.js";

describe("hashSessionToken", () => {
  it("is the lowercase hex SHA-256 of the token", () => {
    // SHA-256("abc"), FIPS 180-2 appendix B.1 — a value computed by nobody in this repository.
    expect(hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gives different tokens different hashes", () => {
    expect(hashSessionToken("a")).not.toBe(hashSessionToken("b"));
  });
});
