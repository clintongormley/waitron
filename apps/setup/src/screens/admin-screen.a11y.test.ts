import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./admin-screen.js";
import type { SetupAdminScreen } from "./admin-screen.js";

afterEach(cleanupWidgets);

async function bottomOf(el: SetupAdminScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-admin-screen a11y (%s theme)", (theme) => {
  it("has no violations on the empty form (every field labelled)", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {}, theme);
    expect(
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=email]")!.getAttribute("label"),
    ).toBe("Email");
    await expectNoA11yViolations(host);
  });

  it("has no violations with the message above Next and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupAdminScreen>("setup-admin-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });
});
