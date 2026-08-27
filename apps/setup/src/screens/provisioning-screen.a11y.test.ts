import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./provisioning-screen.js";
import type { SetupProvisioningScreen } from "./provisioning-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-provisioning-screen a11y (%s theme)", (theme) => {
  it("has no violations in the in-flight state", async () => {
    const { host } = await mountWidget<SetupProvisioningScreen>(
      "setup-provisioning-screen",
      {},
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations in the retryable error state", async () => {
    const { host } = await mountWidget<SetupProvisioningScreen>(
      "setup-provisioning-screen",
      { message: "Provisioning failed. You can try again.", canRetry: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
