import { defineConfig } from "vitest/config";
import {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
  AWS_REHEARSAL_SETUP_MARGIN_MS,
  AWS_REHEARSAL_SETTLE_MS,
  AWS_REHEARSAL_STOP_WAIT_MS,
} from "./src/testing/aws-rehearsal-limits.js";

// A test holds its run's deadline (bucket setup and scenario), the settling grace and teardown; the
// hook after it holds an outside stop's wait for a run the test's time limit left going.
export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.aws-rehearsal.test.ts"],
    globalSetup: ["src/testing/aws-rehearsal-global-setup.ts"],
    setupFiles: ["src/testing/byte-equality-setup.ts"],
    maxWorkers: 1,
    testTimeout:
      AWS_REHEARSAL_SCENARIO_DEADLINE_MS +
      AWS_REHEARSAL_SETTLE_MS +
      AWS_REHEARSAL_LIMITS.teardownMs +
      AWS_REHEARSAL_SETUP_MARGIN_MS,
    hookTimeout: AWS_REHEARSAL_STOP_WAIT_MS + AWS_REHEARSAL_SETUP_MARGIN_MS,
  },
});
