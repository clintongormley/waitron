import { expect, it } from "vitest";
import { shortNodeId } from "./short-node-id.js";

it.each([
  ["3262bf78-1d78-4b10-bae6-61fda564d5e8", "3262 BF78"],
  ["abcdef0123456789", "ABCD EF01"],
  ["node-1", "NODE -1"],
  ["node", "NODE"],
  ["", ""],
])("formats %s for comparison without changing the identifier", (id, label) => {
  expect(shortNodeId(id)).toBe(label);
});
