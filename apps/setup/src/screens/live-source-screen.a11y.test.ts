import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./live-source-screen.js";
import type { SetupLiveSourceScreen } from "./live-source-screen.js";

afterEach(cleanupWidgets);

/** The message beside the primary action, which `wt-form-actions` draws in its own shadow root. */
async function bottomMessage(el: HTMLElement): Promise<string | undefined> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim();
}

describe.each(["light", "dark"] as const)("setup-live-source-screen a11y (%s theme)", (theme) => {
  it("has no violations on the choice form", async () => {
    const { host } = await mountWidget<SetupLiveSourceScreen>(
      "setup-live-source-screen",
      {},
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations with the fields marked and the message beside Import", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>(
      "setup-live-source-screen",
      {},
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=import]")!.click();
    await el.updateComplete;
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a refused import shown beside Import", async () => {
    const { el, host } = await mountWidget<SetupLiveSourceScreen>(
      "setup-live-source-screen",
      { errorMessage: "The configuration export could not be opened." },
      theme,
    );
    expect(await bottomMessage(el)).toBe("The configuration export could not be opened.");
    await expectNoA11yViolations(host);
  });
});
