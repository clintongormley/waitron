import { afterEach, describe, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-colour-chooser.js";
import type { ColourChoice, WtColourChooser } from "./wt-colour-chooser.js";
import { registerIcons } from "./wt-icon.js";

afterEach(cleanup);

registerIcons({ "chevron-down": "M3 6 L8 11 L13 6" });

const CHOICES: readonly ColourChoice[] = [
  { value: "red", label: "Red", fill: "var(--wt-color-palette-red)", usedBy: ["Waiter"] },
  { value: "amber", label: "Amber", fill: "var(--wt-color-palette-amber)" },
  { value: "grey", label: "Grey", fill: "var(--wt-color-palette-grey)" },
  {
    value: "blue",
    label: "Blue",
    fill: "var(--wt-color-palette-blue)",
    usedBy: ["Runner", "Cook"],
  },
  { value: "green", label: "Green", fill: "var(--wt-color-palette-green)" },
  { value: "purple", label: "Purple", fill: "var(--wt-color-palette-purple)" },
];

async function mountChooser(attributes: string, theme: "light" | "dark") {
  const el = (await mountThemed(
    `<wt-colour-chooser name="colour" label="Colour" ${attributes}></wt-colour-chooser>`,
    theme,
  )) as WtColourChooser;
  el.choices = CHOICES;
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("wt-colour-chooser a11y (%s theme)", (theme) => {
  test("closed, with a chosen colour", async () => {
    await mountChooser('value="blue"', theme);
    await expectNoA11yViolations(host);
  });

  test("closed, with a value in no choice", async () => {
    await mountChooser('value="pink"', theme);
    await expectNoA11yViolations(host);
  });

  test("required", async () => {
    await mountChooser('value="blue" required', theme);
    await expectNoA11yViolations(host);
  });

  test("with an error", async () => {
    await mountChooser('value="pink" error="Choose a colour."', theme);
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountChooser('value="blue" disabled', theme);
    await expectNoA11yViolations(host);
  });

  test("open, with marks", async () => {
    const el = await mountChooser('value="blue"', theme);
    const panel = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(el.shadowRoot!.querySelector("button.trigger")!);
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
    expect(panel.querySelectorAll(".used-by")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });

  test("open, with more names than the window has room for, so the panel scrolls", async () => {
    const el = await mountChooser('value="blue"', theme);
    el.choices = CHOICES.map((choice) => ({
      ...choice,
      usedBy: Array.from({ length: 20 }, (_, i) => `Restaurant department number ${i}`),
    }));
    await el.updateComplete;
    const panel = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    await userEvent.click(el.shadowRoot!.querySelector("button.trigger")!);
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    await expectNoA11yViolations(host);
  });
});
