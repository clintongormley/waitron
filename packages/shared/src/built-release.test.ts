import { afterEach, describe, expect, it, vi } from "vitest";
import { builtRelease } from "./built-release.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("builtRelease", () => {
  it("is not bundled when the bundle stamp is absent", () => {
    expect(builtRelease()).toEqual({ bundled: false });
  });

  it("is a bundle with no release when stamped null", () => {
    vi.stubGlobal("__WAITRON_RELEASE__", null);
    expect(builtRelease()).toEqual({ bundled: true, version: null });
  });

  it("is that release when stamped with a version", () => {
    vi.stubGlobal("__WAITRON_RELEASE__", { version: "1.2.3" });
    expect(builtRelease()).toEqual({ bundled: true, version: "1.2.3" });
  });

  it.each([[{ version: "1.2" }], ["1.2.3"], [{ version: "01.2.3" }], [{ version: 123 }]])(
    "is a bundle with no release when stamped %j",
    (stamp) => {
      vi.stubGlobal("__WAITRON_RELEASE__", stamp);
      expect(builtRelease()).toEqual({ bundled: true, version: null });
    },
  );
});
