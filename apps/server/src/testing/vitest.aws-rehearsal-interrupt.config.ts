import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// As `vitest.aws-rehearsal.config.ts`, for the one case `src/aws-rehearsal-interrupt.e2e.test.ts` runs.
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  test: {
    include: ["src/testing/aws-rehearsal-interrupt.vitest-case.ts"],
    globalSetup: ["src/testing/aws-rehearsal-global-setup.ts"],
    setupFiles: ["src/testing/aws-rehearsal-strict-setup.ts"],
    maxWorkers: 1,
  },
});
