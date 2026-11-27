import { parkPointerCommands } from "@waitron/ui/src/vitest-park-pointer.js";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  optimizeDeps: {
    include: ["@waitron/ui > @oddbird/popover-polyfill", "axe-core"],
  },
  test: {
    browser: {
      enabled: true,
      commands: { ...parkPointerCommands },
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
