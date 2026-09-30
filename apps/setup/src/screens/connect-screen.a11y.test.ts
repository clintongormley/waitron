import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./connect-screen.js";
import type { SetupConnectScreen } from "./connect-screen.js";

afterEach(cleanupWidgets);

async function bottomOf(el: SetupConnectScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-connect-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form", async () => {
    const { host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the message above Connect and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>("setup-connect-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back server error shown above Connect", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>(
      "setup-connect-screen",
      { errorMessage: "Couldn't reach the primary server." },
      theme,
    );
    expect(await bottomOf(el)).toBe("Couldn't reach the primary server.");
    await expectNoA11yViolations(host);
  });

  it("has no violations when a server error and a client error coincide (one alert)", async () => {
    const { el, host } = await mountWidget<SetupConnectScreen>(
      "setup-connect-screen",
      { errorMessage: "Couldn't reach the primary server." },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=connect]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
