import { afterEach, describe, expect, it } from "vitest";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./about-sheet.js";
import type { SetupAboutSheet } from "./about-sheet.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("setup-about-sheet a11y (%s theme)", (theme) => {
  it("has no violations while open", async () => {
    const { el, host } = await mountWidget<SetupAboutSheet>(
      "setup-about-sheet",
      { open: true },
      theme,
    );
    const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await expectNoA11yViolations(host);
  });
});
