import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./fiscal-test-screen.js";
import type { SetupFiscalTestScreen } from "./fiscal-test-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-fiscal-test-screen a11y (%s theme)", (theme) => {
  it.each([undefined, "accepted", "rejected", "uncertain"] as const)(
    "has no violations for status %s",
    async (status) => {
      const { host } = await mountWidget<SetupFiscalTestScreen>(
        "setup-fiscal-test-screen",
        { status },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});
