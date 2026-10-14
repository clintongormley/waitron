import { afterEach, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { SetupRecoveryAllocation } from "./recovery-allocation.js";
import { setLocale } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
it.each(["light", "dark"] as const)(
  "the recovery entry is accessible in %s before and after invalid submission",
  async (theme) => {
    const { el, host } = await mountWidget<SetupRecoveryAllocation>(
      "setup-recovery-allocation",
      {},
      theme,
    );
    await expectNoA11yViolations(host);
    el.shadowRoot!.querySelector("[data-test=record]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "broken" } }),
    );
    el.readCredentials();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  },
);
