import { DatabaseSync } from "node:sqlite";
import { quoteLiteral } from "@waitron/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Here rather than beside `quoteLiteral`: `@waitron/shared` is browser-safe and `node:sqlite` is
// not, and this package holds the function's one product caller, the change feed's trigger builder.
describe("quoteLiteral against this engine", () => {
  let raw: DatabaseSync;
  beforeAll(() => {
    raw = new DatabaseSync(":memory:");
  });
  afterAll(() => {
    raw?.close();
  });

  const roundTrip = (value: string) =>
    (raw.prepare(`select ${quoteLiteral(value)} as v`).get() as { v: string }).v;

  it.each([
    ["a backslash", "a\\b"],
    ["a trailing backslash", "a\\"],
    ["a quote", "a'b"],
    ["a backslash before a quote", "a\\'b"],
    ["an empty value", ""],
  ])("reads %s back unchanged", (_label, value) => {
    expect(roundTrip(value)).toBe(value);
  });
});
