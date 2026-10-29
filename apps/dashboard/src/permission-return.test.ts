import { afterEach, expect, it } from "vitest";
import { consumePermissionReturn, preparePermissionReturn } from "./permission-continuation.js";

afterEach(() => sessionStorage.removeItem("waitron-permission-return"));

it("keeps only the current pathname across a Google return and consumes it once", () => {
  preparePermissionReturn("/manage/test-evidence");
  expect(sessionStorage.getItem("waitron-permission-return")).toBe(
    '{"path":"/manage/test-evidence"}',
  );
  expect(consumePermissionReturn(true)).toBe("/manage/test-evidence");
  expect(consumePermissionReturn(true)).toBeUndefined();
});
it.each([
  "https://other.example/manage/",
  "//other.example/manage/",
  "/setup/",
  "/manage/?secret=value",
  "/manage/#secret",
  "not-a-path",
])("does not restore an invalid or non-surface return path: %s", (path) => {
  sessionStorage.setItem("waitron-permission-return", JSON.stringify({ path }));
  expect(consumePermissionReturn(true)).toBeUndefined();
  expect(sessionStorage.getItem("waitron-permission-return")).toBeNull();
});
it.each(["null", "{}", "[]", "invalid json"])(
  "ignores a malformed return descriptor: %s",
  (value) => {
    sessionStorage.setItem("waitron-permission-return", value);
    expect(consumePermissionReturn(true)).toBeUndefined();
  },
);
it("drops the descriptor when the page is not a Google callback", () => {
  preparePermissionReturn("/manage/test-evidence");
  expect(consumePermissionReturn(false)).toBeUndefined();
  expect(sessionStorage.getItem("waitron-permission-return")).toBeNull();
});
