import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  setVenueHolderKind: vi.fn(),
  setVenueCrashReportDirectory: vi.fn(),
  setVenueWatchdogLogFile: vi.fn(),
}));
vi.mock("@waitron/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/store")>()),
  ...settings,
}));

const { applicationVersion, LOG_FILE_NAME, resolveLogDir, setVenueHolderIdentity } =
  await import("./venue-holder-identity.js");

beforeEach(() => {
  for (const setter of Object.values(settings)) setter.mockClear();
});

describe("resolveLogDir", () => {
  it("is WAITRON_LOG_DIR as given, whatever the state directory", () => {
    expect(resolveLogDir({ WAITRON_LOG_DIR: "relative/logs" }, "/state")).toBe("relative/logs");
    expect(resolveLogDir({ WAITRON_LOG_DIR: "/var/lib/waitron/logs" }, undefined)).toBe(
      "/var/lib/waitron/logs",
    );
  });

  it("falls back to logs under the state directory when WAITRON_LOG_DIR is unset or empty", () => {
    expect(resolveLogDir({}, "/state")).toBe(join("/state", "logs"));
    expect(resolveLogDir({ WAITRON_LOG_DIR: "" }, "/state")).toBe(join("/state", "logs"));
  });

  it("is undefined with neither a setting nor a state directory, never the working directory", () => {
    expect(resolveLogDir({}, undefined)).toBeUndefined();
    expect(resolveLogDir({ WAITRON_LOG_DIR: "" }, undefined)).toBeUndefined();
  });
});

describe("applicationVersion", () => {
  it("is the image's build id, then the package version, then development", () => {
    expect(applicationVersion({ WAITRON_BUILD_ID: "b", npm_package_version: "1.2.3" })).toBe("b");
    expect(applicationVersion({ npm_package_version: "1.2.3" })).toBe("1.2.3");
    expect(applicationVersion({})).toBe("development");
  });
});

describe("setVenueHolderIdentity", () => {
  it("names the kind, and puts the report files and the watchdog's line under the log directory", () => {
    setVenueHolderIdentity(
      "provisioning",
      { WAITRON_LOG_DIR: "/var/lib/waitron/logs", WAITRON_BUILD_ID: "build-9" },
      "/var/lib/waitron/state",
    );
    expect(settings.setVenueHolderKind).toHaveBeenCalledWith("provisioning");
    expect(settings.setVenueCrashReportDirectory).toHaveBeenCalledWith(
      "/var/lib/waitron/logs/crash-reports",
      "build-9",
    );
    expect(settings.setVenueWatchdogLogFile).toHaveBeenCalledWith(
      "/var/lib/waitron/logs/waitron.log",
    );
    expect(LOG_FILE_NAME).toBe("waitron.log");
  });

  it("uses logs under the state directory when WAITRON_LOG_DIR is empty", () => {
    setVenueHolderIdentity("restore", { WAITRON_LOG_DIR: "" }, "/state");
    expect(settings.setVenueCrashReportDirectory).toHaveBeenCalledWith(
      join("/state", "logs", "crash-reports"),
      "development",
    );
    expect(settings.setVenueWatchdogLogFile).toHaveBeenCalledWith(
      join("/state", "logs", "waitron.log"),
    );
  });

  it("still names the kind with no log directory, and sets no report file or log file", () => {
    setVenueHolderIdentity("provisioning", {}, undefined);
    expect(settings.setVenueHolderKind).toHaveBeenCalledWith("provisioning");
    expect(settings.setVenueCrashReportDirectory).toHaveBeenCalledWith(null, "development");
    expect(settings.setVenueWatchdogLogFile).toHaveBeenCalledWith(null);
  });
});
