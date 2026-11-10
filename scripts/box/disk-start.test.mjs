import { describe, expect, it } from "vitest";
import { diskStartupAction } from "./disk-start.mjs";

describe("the installed disk's startup decision", () => {
  it.each([
    [{ keySlots: 1, tpmSlots: 0, emptyPassword: true, openedBy: "bootstrap" }, "enroll"],
    [{ keySlots: 3, tpmSlots: 1, emptyPassword: true, openedBy: "chip" }, "remove-empty"],
    [{ keySlots: 2, tpmSlots: 1, emptyPassword: false, openedBy: "chip" }, "ready"],
  ])("continues an accepted disk state %j", (state, action) => {
    expect(diskStartupAction(state)).toBe(action);
  });

  it.each([
    { keySlots: 2, tpmSlots: 0, emptyPassword: true, openedBy: "bootstrap" },
    { keySlots: 3, tpmSlots: 1, emptyPassword: true, openedBy: "bootstrap" },
    { keySlots: 2, tpmSlots: 1, emptyPassword: false, openedBy: null },
  ])("refuses an interrupted enrollment or a missing chip opening %j", (state) => {
    expect(() => diskStartupAction(state)).toThrowError(
      expect.objectContaining({ code: "disk_start.refused" }),
    );
  });
});
