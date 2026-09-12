import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./connection-screen.js";
import type { SetupConnectionScreen } from "./connection-screen.js";

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("connection screen (%s)", (theme) => {
  it.each([undefined, "We could not reach the box."])(
    "offers accessible help and retry (%s)",
    async (errorMessage) => {
      const { host } = await mountWidget<SetupConnectionScreen>(
        "setup-connection-screen",
        { errorMessage },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});
