import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./role-screen.js";
import type { SetupRoleScreen } from "./role-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-role-screen a11y (%s theme)", (theme) => {
  it("has no violations on the primary/mirror choice view", async () => {
    const { host } = await mountWidget<SetupRoleScreen>("setup-role-screen", {}, theme);
    await expectNoA11yViolations(host);
  });
});
