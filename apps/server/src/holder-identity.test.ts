import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  setVenueHolderKind: vi.fn(),
  setVenueCrashReportDirectory: vi.fn(),
  setVenueWatchdogLogFile: vi.fn(),
}));
vi.mock("@waitron/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/db")>()),
  ...settings,
}));

const { nameVenueHolder } = await import("./holder-identity.js");
const { applicationVersion } = await import("./app-version.js");
const { DEFAULT_STATE_ROOT } = await import("./boot.js");

beforeEach(() => {
  for (const setter of Object.values(settings)) setter.mockClear();
});

describe("nameVenueHolder", () => {
  it("names the kind, and puts the crash reports and the watchdog's line under WAITRON_LOG_DIR", () => {
    nameVenueHolder("restore", {
      WAITRON_LOG_DIR: "/var/lib/waitron/logs",
      WAITRON_BUILD_ID: "build-9",
    });
    expect(settings.setVenueHolderKind).toHaveBeenCalledWith("restore");
    expect(settings.setVenueCrashReportDirectory).toHaveBeenCalledWith(
      "/var/lib/waitron/logs/crash-reports",
      "build-9",
    );
    expect(settings.setVenueWatchdogLogFile).toHaveBeenCalledWith(
      "/var/lib/waitron/logs/waitron.log",
    );
  });

  it("falls back to the logs folder under the state directory, as the server's config does", () => {
    nameVenueHolder("server", { WAITRON_STATE_DIR: "relative/state", WAITRON_LOG_DIR: "" });
    expect(settings.setVenueWatchdogLogFile).toHaveBeenCalledWith(
      join(resolve("relative/state"), "logs", "waitron.log"),
    );
    nameVenueHolder("server", {});
    expect(settings.setVenueWatchdogLogFile).toHaveBeenLastCalledWith(
      join(DEFAULT_STATE_ROOT, "logs", "waitron.log"),
    );
  });
});

describe("applicationVersion", () => {
  it("is the image's build id, then the package version, then development", () => {
    expect(applicationVersion({ WAITRON_BUILD_ID: "b", npm_package_version: "1.2.3" })).toBe("b");
    expect(applicationVersion({ npm_package_version: "1.2.3" })).toBe("1.2.3");
    expect(applicationVersion({})).toBe("development");
  });
});
