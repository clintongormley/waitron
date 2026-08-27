import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./admin-screen.js";
import type { SetupAdminScreen } from "./admin-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-admin-screen a11y (%s theme)", (theme) => {
  it("has no violations on the empty form (every field labelled)", async () => {
    const { host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the validation banner and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
