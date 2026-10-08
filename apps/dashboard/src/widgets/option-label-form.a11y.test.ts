import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
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

async function mountOpen(value: DraftLabel | null, theme: "light" | "dark") {
  const { el, host } = await mountWidget<OptionLabelForm>(
    "dashboard-option-label-form",
    { open: true, languages: { defaultLanguage: "en", languages: ["en", "es"] }, value },
    theme,
  );
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return { el, host };
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: OptionLabelForm) {
  await el.updateComplete;
  const save =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
async function type(el: OptionLabelForm, name: string, value: string) {
  const input = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    `[name="${name}"]`,
  )!;
  await input.updateComplete;
  await userEvent.fill(page.elementLocator(input.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

describe.each(["light", "dark"] as const)("option window Save states (%s)", (theme) => {
  it("is accessible with Save quiet, for an option and for Add option", async () => {
    for (const value of [rare, null]) {
      const { el, host } = await mountOpen(value, theme);
      expect(await saveState(el)).toEqual(quiet);
      await expectNoA11yViolations(host);
      cleanupWidgets();
    }
  });

  it("is accessible with Save primary after an edit", async () => {
    const { el, host } = await mountOpen(rare, theme);
    await type(el, "label-name", "Very rare");
    expect(await saveState(el)).toEqual(ready);
    await expectNoA11yViolations(host);
  });
});
