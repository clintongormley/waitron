import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { refuseUnreleasedBuild } from "./release-check.js";

function codeOf(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return isAppError(error) ? error.code : "not an AppError";
  }
}

describe("refuseUnreleasedBuild", () => {
  it("refuses a production start of a bundle that is not a release", () => {
    expect(
      codeOf(() => refuseUnreleasedBuild("production", { bundled: true, version: null })),
    ).toBe("server.unreleased_build");
  });

  it("lets a production start of a release through", () => {
    expect(
      codeOf(() => refuseUnreleasedBuild("production", { bundled: true, version: "1.2.3" })),
    ).toBeNull();
  });

  it("lets a production start run from source through", () => {
    expect(codeOf(() => refuseUnreleasedBuild("production", { bundled: false }))).toBeNull();
  });

  it.each(["preproduction", "dev"])(
    "lets a %s start of a bundle that is not a release through",
    (setting) => {
      const environment = deploymentEnvironment({ WAITRON_ENV: setting });
      expect(
        codeOf(() => refuseUnreleasedBuild(environment, { bundled: true, version: null })),
      ).toBeNull();
    },
  );
});
