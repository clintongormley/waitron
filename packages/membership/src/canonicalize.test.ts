import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.js";

describe("canonicalize", () => {
  it("is independent of object key insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
  it("sorts keys recursively but preserves array order", () => {
    expect(canonicalize({ z: [{ y: 1, x: 2 }], a: 3 })).toBe('{"a":3,"z":[{"x":2,"y":1}]}');
  });
  it("emits no incidental whitespace", () => {
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
  });
  it("handles primitives and null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("x")).toBe('"x"');
    expect(canonicalize(7)).toBe("7");
  });
});
