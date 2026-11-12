import { afterEach, describe, expect, it, vi } from "vitest";
import { builtRelease, isReleaseVersion } from "./built-release.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const LONGEST = `${"9".repeat(46)}.2.3`;
const TOO_LONG = `${"9".repeat(47)}.2.3`;

describe("isReleaseVersion", () => {
  it.each([["1.2.3"], ["0.0.0"], ["10.20.30"], [LONGEST]])("accepts %s", (value) => {
    expect(isReleaseVersion(value)).toBe(true);
  });

  it.each([
    [""],
    ["1.2"],
    ["1.2.3.4"],
    ["01.2.3"],
    ["1.02.3"],
    ["1.2.03"],
    ["v1.2.3"],
    ["1.2.3-rc1"],
    ["1.2.3\n"],
    [TOO_LONG],
  ])("refuses %j", (value) => {
    expect(isReleaseVersion(value)).toBe(false);
  });
});

describe("builtRelease", () => {
  it("is not bundled when the bundle stamp is absent", () => {
    expect(builtRelease()).toEqual({ bundled: false });
  });

  it("is a bundle with no release when stamped null", () => {
    vi.stubGlobal("__WAITRON_RELEASE_VERSION__", null);
    expect(builtRelease()).toEqual({ bundled: true, version: null });
  });

  it.each([["1.2.3"], [LONGEST]])("is that release when stamped with %s", (version) => {
    vi.stubGlobal("__WAITRON_RELEASE_VERSION__", { version });
    expect(builtRelease()).toEqual({ bundled: true, version });
  });

  it.each([
    [{ version: "1.2" }],
    ["1.2.3"],
    [{ version: "01.2.3" }],
    [{ version: 123 }],
    [{ version: TOO_LONG }],
  ])("is a bundle with no release when stamped %j", (stamp) => {
    vi.stubGlobal("__WAITRON_RELEASE_VERSION__", stamp);
    expect(builtRelease()).toEqual({ bundled: true, version: null });
  });
});
