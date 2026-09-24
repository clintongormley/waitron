import { expect, it } from "vitest";
import { captureError, driverErrorCode, engineErrorMessage } from "./errors.js";

/*
 * Hand-built error shapes, for the branches an integration test does not reach: the neither-present
 * throw, and captureError's "fn did not reject" branch.
 */

it("driverErrorCode reads a top-level .code", () => {
  expect(driverErrorCode({ code: "42501" })).toBe("42501");
});

it("driverErrorCode falls back to .cause.code when .code is absent", () => {
  expect(driverErrorCode({ cause: { code: "WT001" } })).toBe("WT001");
});

it("driverErrorCode prefers a top-level .code over .cause.code", () => {
  expect(driverErrorCode({ code: "42501", cause: { code: "WT001" } })).toBe("42501");
});

it("driverErrorCode returns undefined when neither is a string", () => {
  expect(driverErrorCode({})).toBeUndefined();
  expect(driverErrorCode({ code: 42501 })).toBeUndefined();
  expect(driverErrorCode(null)).toBeUndefined();
  expect(driverErrorCode(undefined)).toBeUndefined();
});

it("engineErrorMessage reads .cause.message when present", () => {
  const error = { message: "Failed query: ...", cause: { message: "permission denied" } };
  expect(engineErrorMessage(error)).toBe("permission denied");
});

it("engineErrorMessage falls back to the top-level .message when .cause has none", () => {
  expect(engineErrorMessage({ message: "boom" })).toBe("boom");
});

it("engineErrorMessage throws when neither .cause.message nor .message is a string", () => {
  // No String(error) fallback: on drizzle's wrapper that would reproduce the
  // failed SQL and let a pattern that happens to match the SQL pass an
  // assertion for the wrong reason.
  expect(() => engineErrorMessage(null)).toThrow(/neither \.cause\.message nor \.message/);
  expect(() => engineErrorMessage(undefined)).toThrow(/neither \.cause\.message nor \.message/);
  expect(() => engineErrorMessage("plain string rejection")).toThrow(
    /neither \.cause\.message nor \.message/,
  );
  expect(() => engineErrorMessage({})).toThrow(/neither \.cause\.message nor \.message/);
});

it("engineErrorMessage says what it received and why it will not guess", () => {
  // The whole message, once. The pattern above matches its first clause, which leaves the part a
  // reader actually needs — what arrived, and the reason a String(error) fallback is refused —
  // free to be deleted.
  expect(() => engineErrorMessage("plain string rejection")).toThrow(
    "engineErrorMessage: neither .cause.message nor .message is a string on this error " +
      "(received: plain string rejection) — refusing to fall back to String(error), which would " +
      'reproduce a DrizzleQueryError\'s generic "Failed query: <sql>" text and let an ' +
      "assertion on it pass for the wrong reason",
  );
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
