import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { ChoiceForm, type ChoiceDraft } from "./choice-form.js";
import type { ModifierForm } from "./modifier-form.js";
import "./modifier-form.js";

afterEach(cleanupWidgets);

const extras: ChoiceDraft = {
  id: "c",
  name: { es: "Queso" },
  available: true,
  priceDelta: "1.00",
  maxQuantity: 1,
  addAllergens: { milk: { presence: "contains" } },
  suitableFor: ["vegetarian"],
};
const options: ChoiceDraft = {
  id: "c",
  name: { es: "Opción" },
  available: true,
  addAllergens: { milk: { presence: "contains" } },
  suitableFor: ["vegetarian"],
};

describe.each(["light", "dark"] as const)("choice form (%s)", (theme) => {
  it.each([
    { kind: "extras", value: extras },
    { kind: "options", value: options },
  ] as const)("accessible $kind controls", async ({ kind, value }) => {
    const { el, host } = await mountWidget<ChoiceForm>(
      "dashboard-choice-form",
      { open: true, kind, value, locales: ["es", "en"] },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    const details = el.shadowRoot!.querySelector("details");
    if (details) details.open = true;
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  it("accessible invalid fields", async () => {
    const { el, host } = await mountWidget<ChoiceForm>(
      "dashboard-choice-form",
      { open: true, kind: "extras", value: null, locales: ["es"] },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="choice-save"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});

/** Focuses the choice modal's default-language name input, as a keyboard user would land there. */
async function focusName(choice: ChoiceForm) {
  await choice.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  const input = choice
    .shadowRoot!.querySelector('wt-input[name="name-es"]')!
    .shadowRoot!.querySelector("input")!;
  input.focus();
  expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
}

it("submits on Enter and cancels on Escape from a focused field", async () => {
  const { el } = await mountWidget<ChoiceForm>("dashboard-choice-form", {
    open: true,
    kind: "options",
    value: options,
    locales: ["es"],
  });
  await focusName(el);
  const save = vi.fn(),
    cancel = vi.fn();
  el.addEventListener("wt-choice-save", save);
  el.addEventListener("wt-choice-cancel", cancel);
  await userEvent.keyboard("{Enter}");
  expect(save).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Escape}");
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("keeps Enter and Escape inside the choice modal when it is open over the modifier form", async () => {
  const { el } = await mountWidget<ModifierForm>("dashboard-modifier-form", {
    open: true,
    locales: ["es"],
    value: {
      id: "m",
      name: { es: "Modificador" },
      available: true,
      type: "options",
      defaultChoiceId: null,
      choices: [options],
    },
  });
  const submit = vi.fn(),
    cancel = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancel);
  const choice = el.shadowRoot!.querySelector("dashboard-choice-form")!;
  const openChoice = async () => {
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="edit-c"]')!.click();
    await el.updateComplete;
    expect(choice.open).toBe(true);
    await focusName(choice);
  };
  await openChoice();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(submit).not.toHaveBeenCalled();
  expect(choice.open).toBe(false); // the choice saved and its modal closed
  await openChoice();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(choice.open).toBe(false));
  expect(cancel).not.toHaveBeenCalled();
  expect(el.open).toBe(true);
});
