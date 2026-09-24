import { describe, expect, it } from "vitest";
import { assertSafeIdentifier } from "./identifiers.js";

describe("assertSafeIdentifier", () => {
  it("returns a safe token unchanged", () => {
    expect(assertSafeIdentifier("table", "sales_lines")).toBe("sales_lines");
  });

  it("refuses an unsafe token, naming the kind and quoting the value it refused", () => {
    expect(() => assertSafeIdentifier("trigger", 'sales"; drop table sales --')).toThrowError(
      'assertSafeIdentifier: unsafe trigger "sales\\"; drop table sales --"',
    );
  });
});
