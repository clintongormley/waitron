import { describe, expect, it } from "vitest";
import { fillTemplate } from "./fill-template.js";

describe("fillTemplate", () => {
  it("fills every slot it is given, wherever and however often it appears", () => {
    expect(fillTemplate("{a} and {b}, then {a}", { a: "one", b: "two" })).toBe(
      "one and two, then one",
    );
  });

  it("prints a value exactly as given when it spells another slot or a replacement pattern", () => {
    expect(fillTemplate("{a} with {b}", { a: "Tea {b} $& $1", b: "Pizza" })).toBe(
      "Tea {b} $& $1 with Pizza",
    );
  });

  it("leaves a slot it is not given as it is", () => {
    expect(fillTemplate("{a} and {missing}", { a: "one" })).toBe("one and {missing}");
  });

  it("leaves a slot named like an inherited property as it is", () => {
    expect(fillTemplate("{constructor} {toString} {__proto__}", {})).toBe(
      "{constructor} {toString} {__proto__}",
    );
  });
});
