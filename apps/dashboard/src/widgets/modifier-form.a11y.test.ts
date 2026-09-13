import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { ModifierForm } from "./modifier-form.js";
import type { Modifier } from "../api/client.js";
afterEach(cleanupWidgets);
const common = { id: "m", name: { es: "Modificador" }, available: true };
const values: Modifier[] = [
  { ...common, type: "text" },
  { ...common, type: "yes-no", yesLabel: { es: "Sí" }, noLabel: { es: "No" }, defaultValue: false },
  {
    ...common,
    type: "options",
    defaultChoiceId: "c",
    choices: [{ id: "c", name: { es: "Opción" }, available: true }],
  },
  {
    ...common,
    type: "extras",
    required: false,
    maxTotalQuantity: null,
    choices: [
      {
        id: "c",
        name: { es: "Queso" },
        available: true,
        priceDelta: "1.00",
        maxQuantity: 1,
        defaultQuantity: 0,
        addAllergens: { milk: { presence: "contains" } },
        addOrigins: ["dairy"],
      },
    ],
  },
];
describe.each(["light", "dark"] as const)("modifier form (%s)", (theme) => {
  it.each(values)("accessible $type controls", async (value) => {
    const { el, host } = await mountWidget<ModifierForm>(
      "dashboard-modifier-form",
      { open: true, value, locales: ["es", "en"] },
      theme,
    );
    await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
    const details = el.shadowRoot!.querySelector("details");
    if (details) details.open = true;
    await expectNoA11yViolations(host);
  });
  it("accessible invalid fields", async () => {
    const { el, host } = await mountWidget<ModifierForm>(
      "dashboard-modifier-form",
      { open: true, locales: ["es"] },
      theme,
    );
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]')!.click();
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
it("focuses the modal, submits Enter and cancels Escape", async () => {
  const { el } = await mountWidget<ModifierForm>("dashboard-modifier-form", {
    open: true,
    locales: ["es"],
    value: values[0],
  });
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  const input = el.shadowRoot!.querySelector("wt-input")!.shadowRoot!.querySelector("input")!;
  input.focus();
  expect(
    input.getRootNode() instanceof ShadowRoot && (input.getRootNode() as ShadowRoot).activeElement,
  ).toBe(input);
  const submit = vi.fn(),
    cancel = vi.fn();
  el.addEventListener("wt-submit", submit);
  el.addEventListener("wt-cancel", cancel);
  await userEvent.keyboard("{Enter}");
  expect(submit).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Escape}");
  expect(cancel).toHaveBeenCalledTimes(1);
});
