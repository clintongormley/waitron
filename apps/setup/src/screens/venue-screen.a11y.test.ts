import { afterEach, describe, expect, it } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./venue-screen.js";
import type { SetupVenueScreen } from "./venue-screen.js";

afterEach(cleanupWidgets);

/** The message above Next, so each invalid-state case proves axe saw it. */
async function bottomOf(el: SetupVenueScreen): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await actions.updateComplete;
  return actions.shadowRoot!.querySelector("[data-error]")?.textContent?.trim() ?? "";
}

describe.each(["light", "dark"] as const)("setup-venue-screen a11y (%s theme)", (theme) => {
  it("has no violations on the pristine form (every field, both selects, the locale group labelled)", async () => {
    const { host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {}, theme);
    await expectNoA11yViolations(host);
  });

  it("has no violations with the message above Next and invalid fields shown", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {}, theme);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a routed-back server error shown above Next", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>(
      "setup-venue-screen",
      { errorMessage: "The country must match the fiscal territory." },
      theme,
    );
    expect(await bottomOf(el)).toBe("The country must match the fiscal territory.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with a server-refused field marked and explained", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>(
      "setup-venue-screen",
      { invalidField: "seriesCode" },
      theme,
    );
    expect(await bottomOf(el)).toBe("Correct the highlighted fields to continue.");
    await expectNoA11yViolations(host);
  });

  it("has no violations with Barcelona's receipt language fixed, its reason shown and the choice disabled", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>("setup-venue-screen", {}, theme);
    await chooseOption(el.shadowRoot!.querySelector("[data-test=province]")!, "08");
    await el.updateComplete;
    const reason = el.shadowRoot!.querySelector("#invoice-locales-fixed")!;
    expect(reason.textContent!.trim()).not.toBe("");
    expect(el.shadowRoot!.querySelector("fieldset.locales")!.getAttribute("aria-describedby")).toBe(
      reason.id,
    );
    const radios = [
      ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="invoiceLocales"]'),
    ];
    expect(radios.length).toBeGreaterThan(1);
    expect(radios.every((radio) => radio.disabled)).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("has no violations when a server error and a client error coincide (one alert)", async () => {
    const { el, host } = await mountWidget<SetupVenueScreen>(
      "setup-venue-screen",
      { errorMessage: "The country must match the fiscal territory." },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next]")!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
