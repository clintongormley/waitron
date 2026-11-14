import { describe, expect, it } from "vitest";
import { isSqlIdentifier } from "./index.js";

describe("isSqlIdentifier", () => {
  it.each(["table", "_private", "A_12"])("accepts %s", (value) => {
    expect(isSqlIdentifier(value)).toBe(true);
  });
  it.each(["", "1table", "two words", "a.b", "a;drop", 'a"b', "non_ascii_\u00e9", "a\n", "a\nb"])(
    "declines %j",
    (value) => {
      expect(isSqlIdentifier(value)).toBe(false);
    },
  );
});
