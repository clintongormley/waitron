import { afterEach, beforeEach, describe, it } from "vitest";
import { setHelpMode } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { currentLocale, setLocale } from "@waitron/dashboard-kit";
import type { SumUpConnectForm } from "./sumup-connect-form.js";
import "./sumup-connect-form.js";

let locale: string;
beforeEach(() => {
  locale = currentLocale();
});
afterEach(() => {
  setHelpMode(false);
  cleanup();
  setLocale(locale);
});

describe.each(["light", "dark"] as const)("SumUp connect form accessibility (%s)", (theme) => {
  it.each([false, true])("keeps the form accessible (help on=%s)", async (helpOn) => {
    setLocale("en");
    setHelpMode(helpOn);
    const el = (await mountThemed(
      "<sumup-connect-form></sumup-connect-form>",
      theme,
    )) as SumUpConnectForm;
    await el.updateComplete;
    const help = el.shadowRoot!.querySelector("[data-test=affiliate-help]") as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await help.updateComplete;
    await expectNoA11yViolations(host, { enable: ["target-size"] });
  });
});
