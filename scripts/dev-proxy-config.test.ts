import { describe, expect, it } from "vitest";
import type { ProxyOptions, UserConfig, UserConfigExport } from "vite";

import dashboardConfig from "../apps/dashboard/vite.config.js";
import setupConfig from "../apps/setup/vite.config.js";
import tillConfig from "../apps/till/vite.config.js";

function staticConfig(config: UserConfigExport): UserConfig {
  expect(config).toBeTypeOf("object");
  return config as UserConfig;
}

describe.each([
  ["dashboard", dashboardConfig],
  ["setup", setupConfig],
  ["till", tillConfig],
])("%s development proxy", (_name, exportedConfig) => {
  it("reaches the box's self-signed HTTPS listener", () => {
    const proxy = staticConfig(exportedConfig).server?.proxy;
    expect(proxy).toBeDefined();

    for (const route of Object.values(proxy ?? {})) {
      expect(route).toMatchObject<ProxyOptions>({
        target: "https://127.0.0.1:8080",
        secure: false,
      });
    }
  });
});
