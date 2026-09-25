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

  it("has no violations while asking about a live old server", async () => {
    const { host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { liveSince: "2026-09-23T11:58:00.000Z" },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the old-server question left unanswered", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { liveUnknown: true },
      theme,
    );
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
