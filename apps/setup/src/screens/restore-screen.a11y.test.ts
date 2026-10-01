import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./restore-screen.js";
import type { SetupRestoreScreen } from "./restore-screen.js";

afterEach(cleanupWidgets);

/** The form's one message, which `wt-form-actions` draws in its own shadow root. */
async function bottomOf(el: HTMLElement): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-restore-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the fields marked and the message above Restore", async () => {
    const { el, host } = await mountWidget<SetupRestoreScreen>("setup-restore-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=restore]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
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
    const { el, host } = await mountWidget<SetupRestoreScreen>(
      "setup-restore-screen",
      { errorMessage: "Couldn't stage the backup." },
      theme,
    );
    expect(await bottomOf(el)).toBe("Couldn't stage the backup.");
    await expectNoA11yViolations(host);
  });
});
