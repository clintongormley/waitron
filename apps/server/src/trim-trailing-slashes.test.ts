import { expect, it } from "vitest";
import { trimTrailingSlashes } from "./trim-trailing-slashes.js";

it.each([
  ["", ""],
  ["/", ""],
  ["///", ""],
  ["https://box/path///", "https://box/path"],
  ["https://box/path", "https://box/path"],
  ["https://box/\n", "https://box/\n"],
])("trims only the slash suffix of %j", (value, expected) => {
  expect(trimTrailingSlashes(value)).toBe(expected);
});
