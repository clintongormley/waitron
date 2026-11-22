import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./reset-screen.js";
import type { SetupResetScreen } from "./reset-screen.js";

afterEach(cleanupWidgets);

async function bottomOf(el: SetupResetScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-reset-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupResetScreen>("setup-reset-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the link to the primary's Servers page", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { serversUrl: "https://waitron.local/servers" },
      theme,
    );
    expect(el.shadowRoot!.querySelector("[data-test=servers-link]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back message shown", async () => {
    const { el, host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { errorMessage: "The box could not be reset. Check the connection and try again." },
      theme,
    );
    expect(await bottomOf(el)).toBe(
      "The box could not be reset. Check the connection and try again.",
    );
    await expectNoA11yViolations(host);
  });

  it("has no violations while the reset is in flight", async () => {
    const { host } = await mountWidget<SetupResetScreen>(
      "setup-reset-screen",
      { busy: true },
      theme,
    );
    await expectNoA11yViolations(host);
  });

  it.each(["resetting", "refused"] as const)(
    "has no violations on the %s outcome",
    async (kind) => {
      const { host } = await mountWidget<SetupResetScreen>(
        "setup-reset-screen",
        { outcome: { kind, message: "The box is resetting and will restart." } },
        theme,
      );
      await expectNoA11yViolations(host);
    },
  );
});
