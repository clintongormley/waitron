import { afterEach, describe, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { OptionLabelForm, type DraftLabel } from "./option-label-form.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

/** The three names read differently on purpose (CLAUDE.md §3). */
const rare: DraftLabel = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Rare",
  customerName: { en: "Barely cooked", es: "Poco hecho" },
  kitchenName: "R",
  available: true,
};

const states = ["closed", "add", "edit", "invalid", "error", "busy"] as const;

describe.each(["light", "dark"] as const)("option editor (%s)", (theme) => {
  it.each(states)("renders %s accessibly", async (state) => {
    const { el, host } = await mountWidget<OptionLabelForm>(
      "dashboard-option-label-form",
      {
        open: state !== "closed",
        languages: { defaultLanguage: "en", languages: ["en", "es"] },
        value: state === "add" || state === "invalid" ? null : rare,
        busy: state === "busy",
        errors: state === "error" ? { "label-kitchen-name": "Too long for the kitchen." } : {},
      },
      theme,
    );
    if (state === "invalid") {
      el.shadowRoot!.querySelector('[name="label-kitchen-name"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "WD" }, bubbles: true, composed: true }),
      );
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
      await el.updateComplete;
      expect(
        el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>('[name="label-name"]')!
          .invalid,
      ).toBe(true);
    }
    // Each named state is scanned in the shape it names.
    expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(state !== "closed");
    await expectNoA11yViolations(host);
  });
});
