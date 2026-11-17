import { describe, expect, it } from "vitest";
import { isDashboardAssetPath, isDashboardPath } from "./index.js";

describe("dashboard page paths", () => {
  it.each([
    ["/", true],
    ["/account?token=recorded%2Ftoken", true],
    ["/floor/view/zone#today", true],
    ["/apiary", true],
    ["/till-other", true],
    ["", false],
    ["?view=all", false],
    ["#today", false],
    ["https://elsewhere.example/account", false],
    ["//elsewhere.example/account", false],
    ["/\\elsewhere.example/account", false],
    ["/account/%2f..%2fapi", false],
    ["/account/%5cother", false],
    ["/account/%00", false],
    ["/account/../api/private", false],
    ["/favicon.svg", false],
    ["/sw-probe.js", false],
    ...[
      "api",
      "management-api",
      "setup-api",
      "setup-assets",
      "recovery-api",
      "print-api",
      "webhooks",
      "health",
      "help",
      "legal",
      "media",
      "public",
      "handover",
      "carry-on",
      "restore-clock",
      "setup",
      "till",
      "assets",
    ].flatMap((prefix): [string, boolean][] => [
      [`/${prefix}`, false],
      [`/${prefix}/page`, false],
    ]),
  ] as const)("classifies %s as dashboard=%s", (path, expected) => {
    expect(isDashboardPath(path)).toBe(expected);
  });
});

describe("dashboard asset paths", () => {
  it.each([
    ["/assets/app-hash.js", true],
    ["/favicon.ico", true],
    ["/favicon.svg", true],
    ["/apple-touch-icon.png", true],
    ["/icon-192.png", true],
    ["/icon-512.png", true],
    ["/assets-other/app.js", false],
    ["/favicon.svg/other", false],
    ["/till/assets/app.js", false],
    ["/sw-probe.js", false],
    ["/devices", false],
  ] as const)("classifies %s as dashboard asset=%s", (path, expected) => {
    expect(isDashboardAssetPath(path)).toBe(expected);
  });
});
