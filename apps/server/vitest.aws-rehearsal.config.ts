import { defineConfig } from "vitest/config";
import {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
  AWS_REHEARSAL_SETUP_MARGIN_MS,
} from "./src/testing/aws-rehearsal-limits.js";

// A test holds setup, its scenario deadline and teardown in its body; a hook holds teardown or setup.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.aws-rehearsal.test.ts"],
    globalSetup: ["src/testing/aws-rehearsal-global-setup.ts"],
    setupFiles: ["src/testing/byte-equality-setup.ts"],
    maxWorkers: 1,
    testTimeout:
      AWS_REHEARSAL_SCENARIO_DEADLINE_MS +
      AWS_REHEARSAL_LIMITS.teardownMs +
      AWS_REHEARSAL_SETUP_MARGIN_MS,
    hookTimeout: AWS_REHEARSAL_LIMITS.teardownMs + AWS_REHEARSAL_SETUP_MARGIN_MS,
  },
});
