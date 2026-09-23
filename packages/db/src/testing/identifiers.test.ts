import { describe, expect, it } from "vitest";
import { assertSafeIdentifier } from "./identifiers.js";

/**
 * Both cases were run against deliberately broken copies of the function on 2026-09-22, to check
 * each is held by something:
 *
 * - condition inverted (`if (SAFE_TOKEN.test(value))`) — both cases red;
 * - the `throw` replaced by `return value` — the refusal case red alone;
 * - the message replaced by the fixed string `"assertSafeIdentifier: unsafe identifier"` — the
 *   refusal case red alone, so the kind and the quoted value are asserted, not just the throw.
 */
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
