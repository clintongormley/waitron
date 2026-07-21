import { expect, it } from "vitest";
import { captureError, pgErrorCode, pgErrorMessage } from "./errors.js";

/*
 * immutability.test.ts exercises these against real driver errors, but only
 * ever the shape both drivers actually produce (a DrizzleQueryError whose
 * `.cause` carries the SQLSTATE and message). That leaves the top-level and
 * neither-present branches unreached — the latter is a throw, not a return,
 * since neither real driver has ever been observed to omit both — and
 * captureError's "fn did not reject" branch unreached entirely. This file
 * exists to cover the branches an integration test cannot reach without a
 * driver that behaves differently from either target.
 */

it("pgErrorCode reads a top-level .code", () => {
  expect(pgErrorCode({ code: "42501" })).toBe("42501");
});

it("pgErrorCode falls back to .cause.code when .code is absent", () => {
  expect(pgErrorCode({ cause: { code: "WT001" } })).toBe("WT001");
});

it("pgErrorCode prefers a top-level .code over .cause.code", () => {
  expect(pgErrorCode({ code: "42501", cause: { code: "WT001" } })).toBe("42501");
});

it("pgErrorCode returns undefined when neither is a string", () => {
  expect(pgErrorCode({})).toBeUndefined();
  expect(pgErrorCode({ code: 42501 })).toBeUndefined();
  expect(pgErrorCode(null)).toBeUndefined();
  expect(pgErrorCode(undefined)).toBeUndefined();
});

it("pgErrorMessage reads .cause.message when present", () => {
  const error = { message: "Failed query: ...", cause: { message: "permission denied" } };
  expect(pgErrorMessage(error)).toBe("permission denied");
});

it("pgErrorMessage falls back to the top-level .message when .cause has none", () => {
  expect(pgErrorMessage({ message: "boom" })).toBe("boom");
});

it("pgErrorMessage throws when neither .cause.message nor .message is a string", () => {
  // No String(error) fallback: that would reproduce a DrizzleQueryError's
  // generic "Failed query: <sql>" text and let a pattern that happens to
  // match the SQL pass an assertion for the wrong reason (the exact trap
  // tenancy.test.ts's rejectsWithCauseMatching, Task 4, was written to
  // close).
  expect(() => pgErrorMessage(null)).toThrow(/neither \.cause\.message nor \.message/);
  expect(() => pgErrorMessage(undefined)).toThrow(/neither \.cause\.message nor \.message/);
  expect(() => pgErrorMessage("plain string rejection")).toThrow(
    /neither \.cause\.message nor \.message/,
  );
  expect(() => pgErrorMessage({})).toThrow(/neither \.cause\.message nor \.message/);
});

it("captureError returns the rejection when fn rejects", async () => {
  const error = await captureError(() => Promise.reject(new Error("boom")));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("boom");
});

it("captureError throws when fn resolves instead of rejecting", async () => {
  await expect(captureError(() => Promise.resolve("fine"))).rejects.toThrow(
    "expected the operation to be rejected, but it succeeded",
  );
});
