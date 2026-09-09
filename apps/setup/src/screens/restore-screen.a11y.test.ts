import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./restore-screen.js";
import type { SetupRestoreScreen } from "./restore-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-restore-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the validation banner shown", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("has no violations with a server error shown", async () => {
    const { host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { errorMessage: "Couldn't stage the backup." },
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
