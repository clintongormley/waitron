import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./live-source-screen.js";
import type { SetupLiveSourceScreen } from "./live-source-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-live-source-screen a11y (%s theme)", (theme) => {
  it("has no violations on the choice form", async () => {
    const { host } = await mountWidget<SetupLiveSourceScreen>(
      "setup-live-source-screen",
      {},
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
