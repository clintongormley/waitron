import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { baseStyles, CATEGORY_PALETTE } from "@waitron/ui";
import { cleanupWidgets, customSquarePixels, mountWidget } from "./test-helpers.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { t } from "../i18n/t.js";

/** The smallest host the field renders into: it owns the colour and adds the field's styles. */
@customElement("test-color-field-host")
class ColorFieldHost extends LitElement {
  static override styles = [baseStyles, colorFieldStyles];
  @property({ attribute: false }) color: string | null = null;
  @property({ attribute: false }) categoryColor: string | null | undefined = undefined;
  @property({ attribute: false }) customEvent: "input" | "change" | undefined = undefined;
  @property({ attribute: false }) inheritedFrom: "category" | "default" | undefined = undefined;
  override render() {
    return colorField({
      ...(this.inheritedFrom === undefined ? {} : { inheritedFrom: this.inheritedFrom }),
      ...(this.categoryColor === undefined ? {} : { categoryColor: this.categoryColor }),
      ...(this.customEvent === undefined ? {} : { customEvent: this.customEvent }),
      color: this.color,
      busy: false,
      error: "",
      name: "test-color",
      errorId: "test-color-error",
      change: (color) => {
        this.color = color;
      },
    });
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "test-color-field-host": ColorFieldHost;
  }
}

afterEach(cleanupWidgets);

const mount = (
  color: string | null,
  theme?: "light" | "dark",
  extra: Partial<Pick<ColorFieldHost, "categoryColor" | "customEvent" | "inheritedFrom">> = {},
) => mountWidget<ColorFieldHost>("test-color-field-host", { color, ...extra }, theme);

const noneButton = (el: ColorFieldHost) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('[data-color=""]')!;
/** The fieldset's own children, by tag and class: what a field draws, line by line. */
const fieldLines = (el: ColorFieldHost) =>
  [...el.shadowRoot!.querySelector("fieldset")!.children].map(
    (child) => `${child.tagName.toLowerCase()}.${child.className}`,
  );

async function click(el: ColorFieldHost, value: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-color="${value}"]`)!.click();
  await el.updateComplete;
}

it("reports the chosen palette colour", async () => {
  const { el } = await mount(null);
  await click(el, "#b12525");
  expect(el.color).toBe("#b12525");
});

it("lays out every palette hue as a column of three tones", async () => {
  const { el } = await mount(null);
  const swatches = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('.swatches [data-color]:not([data-color=""])'),
  ];
  expect(swatches).toHaveLength(24);

  const boxes = swatches.slice(0, 4).map((swatch) => swatch.getBoundingClientRect());
  expect(boxes[1]!.left).toBe(boxes[0]!.left);
  expect(boxes[2]!.left).toBe(boxes[0]!.left);
  expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.top);
  expect(boxes[2]!.top).toBeGreaterThan(boxes[1]!.top);
  expect(boxes[3]!.left).toBeGreaterThan(boxes[0]!.left);
  expect(boxes[3]!.top).toBe(boxes[0]!.top);
  const secondHalf = swatches[12]!.getBoundingClientRect();
  expect(secondHalf.left).toBeGreaterThan(boxes[3]!.left);
  expect(secondHalf.top).toBe(boxes[0]!.top);

  const yellow = el.shadowRoot!.querySelector<HTMLElement>('[data-color="#dddd5f"]')!;
  expect(yellow).not.toBeNull();
  expect(getComputedStyle(yellow).backgroundColor).toBe("rgb(221, 221, 95)");
});

it("starts from an existing colour and can clear it", async () => {
  const { el } = await mount("#256bb1");
  await click(el, "");
  expect(el.color).toBeNull();
});

it("reports a custom colour picked via the native colour input", async () => {
  const { el } = await mount(null);
  const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"]')!;
  input.value = "#123456";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect((await customSquarePixels(el.shadowRoot!)).inside).toEqual([0x12, 0x34, 0x56, 255]);
  expect(el.color).toBe("#123456");
});

it("reports a custom colour only once the picker settles on it when asked to", async () => {
  const { el } = await mount(null, undefined, { customEvent: "change" });
  const input = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"]')!;
  input.value = "#123456";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.color).toBeNull();
  input.value = "#654321";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
  expect(el.color).toBe("#654321");
});

it.each(["light", "dark"] as const)(
  "draws the Custom square as an empty bordered box, not black, while no colour is chosen (%s)",
  async (theme) => {
    const { el } = await mount(null, theme);
    const { inside, border, borderColor, beside } = await customSquarePixels(el.shadowRoot!);
    expect(inside).not.toEqual([0, 0, 0, 255]);
    expect(inside).toEqual(beside);
    expect(border).toEqual(borderColor);
    expect(border).not.toEqual(beside);
    expect(el.color).toBeNull();
  },
);

it.each([
  ["#123456", [0x12, 0x34, 0x56, 255]],
  ["#000000", [0, 0, 0, 255]],
])("paints a chosen custom colour %s in the Custom square", async (color, rgba) => {
  const { el } = await mount(color);
  expect((await customSquarePixels(el.shadowRoot!)).inside).toEqual(rgba);
  expect(el.color).toBe(color);
});

it.each(["light", "dark"] as const)(
  "rings the Custom square as selected while a custom colour is chosen (%s)",
  async (theme) => {
    const { el } = await mount("#123456", theme);
    const { row, column, ringColor } = await customSquarePixels(el.shadowRoot!);
    expect([row[0], row[1], column[0], column[1]]).toEqual(Array(4).fill(ringColor));
    expect(el.shadowRoot!.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(0);
  },
);

it.each([
  ["a palette colour", CATEGORY_PALETTE[0], "light"],
  ["no colour", null, "light"],
  ["a palette colour", CATEGORY_PALETTE[0], "dark"],
  ["no colour", null, "dark"],
] as const)("does not ring the Custom square while %s is chosen (%s)", async (_, color, theme) => {
  const { el } = await mount(color, theme);
  const { row, column, borderColor, ringColor } = await customSquarePixels(el.shadowRoot!);
  expect(borderColor).not.toEqual(ringColor);
  expect([row[0], column[0]]).toEqual([borderColor, borderColor]);
  const checked = el.shadowRoot!.querySelectorAll('[role="radio"][aria-checked="true"]');
  expect([...checked].map((radio) => radio.getAttribute("data-color"))).toEqual([color ?? ""]);
});

it.each(["light", "dark"] as const)(
  "fills the Custom square with a chosen custom colour right up to its ring, with no rim (%s)",
  async (theme) => {
    const { el } = await mount("#123456", theme);
    const { row, column } = await customSquarePixels(el.shadowRoot!);
    const within = [...row.slice(2), ...column.slice(2)];
    expect(within).toEqual(within.map(() => [0x12, 0x34, 0x56, 255]));
  },
);

it.each(["light", "dark"] as const)(
  "fills the Custom square right up to its border while a palette colour is chosen, with no rim (%s)",
  async (theme) => {
    const { el } = await mount(CATEGORY_PALETTE[0], theme);
    const hex = CATEGORY_PALETTE[0];
    const expected = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255);
    const { row, column } = await customSquarePixels(el.shadowRoot!);
    const within = [...row.slice(1), ...column.slice(1)];
    expect(within).toEqual(within.map(() => expected));
  },
);

it.each(["light", "dark"] as const)(
  "names the colour radiogroup and every one of its options (%s)",
  async (theme) => {
    const { el } = await mount(null, theme);
    const group = el.shadowRoot!.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBeTruthy();
    const options = [...group.querySelectorAll('[role="radio"]')];
    expect(options.length).toBeGreaterThan(1);
    for (const option of options) {
      const name = option.getAttribute("aria-label") ?? option.textContent?.trim();
      expect(name).toBeTruthy();
    }
  },
);

it("names the no-colour choice by its label and describes it by the colour it then takes, drawn in a chip", async () => {
  const { el } = await mount(null, undefined, { categoryColor: "#25b125" });
  const none = noneButton(el);
  await expect
    .element(page.elementLocator(none))
    .toHaveAccessibleName(t("editor.color_use_category"));
  await expect.element(page.elementLocator(none)).toHaveAccessibleDescription("#25b125");
  const chip = none.querySelector<HTMLElement>(".chip")!;
  expect(chip.getAttribute("aria-hidden")).toBe("true");
  expect(getComputedStyle(chip).backgroundColor).toBe("rgb(37, 177, 37)");
  const swatch = el.shadowRoot!.querySelector<HTMLElement>('[data-color="#b12525"]')!;
  await expect.element(page.elementLocator(swatch)).toHaveAccessibleName("#b12525");
});

it("names the no-colour choice Use default colour when the colour it takes is the venue default", async () => {
  const { el } = await mount(null, undefined, {
    categoryColor: "#25b125",
    inheritedFrom: "default",
  });
  const none = noneButton(el);
  await expect
    .element(page.elementLocator(none))
    .toHaveAccessibleName(t("editor.color_use_default"));
  await expect.element(page.elementLocator(none)).toHaveAccessibleDescription("#25b125");
});

it("says inside the no-colour choice, as its description, that the category has no colour", async () => {
  const plain = await mount(null);
  const plainLines = fieldLines(plain.el);
  cleanupWidgets();
  const { el } = await mount(null, undefined, { categoryColor: null });
  const none = noneButton(el);
  await expect
    .element(page.elementLocator(none))
    .toHaveAccessibleName(t("editor.color_use_category"));
  await expect
    .element(page.elementLocator(none))
    .toHaveAccessibleDescription(t("editor.color_category_none"));
  const note = none.querySelector<HTMLElement>(".note")!;
  expect(note.textContent!.trim()).toBe(t("editor.color_category_none"));
  expect(none.querySelector(".chip")).toBeNull();
  // The note is the button's second line, not a line drawn under the field.
  expect(note.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    none
      .querySelector<HTMLElement>(`#${CSS.escape("test-color-none-label")}`)!
      .getBoundingClientRect().bottom,
  );
  expect(fieldLines(el)).toEqual(plainLines);
});

it("says the category has no colour when the colour it would take is not lowercase #rrggbb", async () => {
  const { el } = await mount(null, undefined, { categoryColor: "#256bb1;position:fixed;inset:0" });
  const none = noneButton(el);
  expect(none.querySelector(".chip")).toBeNull();
  expect(none.querySelector(".note")!.textContent!.trim()).toBe(t("editor.color_category_none"));
});

it("keeps a two-line no-colour choice's text clear of its border", async () => {
  const { el } = await mount(null, undefined, { categoryColor: null });
  const none = noneButton(el).getBoundingClientRect();
  const label = el.shadowRoot!.querySelector("#test-color-none-label")!.getBoundingClientRect();
  const note = noneButton(el).querySelector(".note")!.getBoundingClientRect();
  expect(label.top - none.top).toBeGreaterThanOrEqual(3);
  expect(none.bottom - note.bottom).toBeGreaterThanOrEqual(3);
});

it("draws today's No colour choice when given neither setting", async () => {
  const { el } = await mount(null);
  const none = noneButton(el);
  await expect.element(page.elementLocator(none)).toHaveAccessibleName(t("editor.color_none"));
  await expect.element(page.elementLocator(none)).toHaveAccessibleDescription("");
  expect(none.querySelector(".chip, .note")).toBeNull();
});
