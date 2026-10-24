import { describe, expect, it } from "vitest";
import {
  CHANGES_AFTER_SENDING,
  allowsChangeAfterSending,
  isChangesAfterSending,
} from "./changes-after-sending.js";

describe("changes after sending", () => {
  it("lists the three choices a station makes about changing a sent dish", () => {
    expect(CHANGES_AFTER_SENDING).toEqual(["never", "held", "held-or-waiting"]);
  });

  it("accepts each choice and nothing else", () => {
    for (const value of CHANGES_AFTER_SENDING) expect(isChangesAfterSending(value)).toBe(true);
    for (const value of ["Held", "", null, 1]) expect(isChangesAfterSending(value)).toBe(false);
  });

  it.each([
    ["never", false, false],
    ["never", true, false],
    ["held", false, true],
    ["held", true, false],
    ["held-or-waiting", false, true],
    ["held-or-waiting", true, true],
  ] as const)("%s with fired %s allows a change: %s", (value, fired, allowed) => {
    expect(allowsChangeAfterSending(value, fired)).toBe(allowed);
  });
});
