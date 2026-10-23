import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { baseStyles, CATEGORY_PALETTE } from "@waitron/ui";
import { cleanupWidgets, customSquarePixels, mountWidget } from "./test-helpers.js";
import {
  colorField,
  colorFieldStyles,
  colourValueField,
  colourValueStyles,
  type ColorFieldOptions,
  type ColourValueOptions,
} from "./color-field.js";
import { t } from "../i18n/t.js";

/** The smallest host the field renders into: it owns the colour and adds the field's styles. */
@customElement("test-color-field-host")
class ColorFieldHost extends LitElement {
  static override styles = [baseStyles, colorFieldStyles];
  @property({ attribute: false }) color: string | null = null;
  @property({ attribute: false }) categoryColor: string | null | undefined = undefined;
  @property({ attribute: false }) customEvent: "input" | "change" | undefined = undefined;
  @property({ attribute: false }) inheritedFrom: "category" | "default" | undefined = undefined;
  @property({ attribute: false }) legend: string | undefined = undefined;
  @property({ attribute: false }) noneChoice: ColorFieldOptions["noneChoice"] = undefined;
  @property({ attribute: false }) code: ColorFieldOptions["code"] = undefined;
  override render() {
    return colorField({
      ...(this.legend === undefined ? {} : { legend: this.legend }),
      ...(this.noneChoice === undefined ? {} : { noneChoice: this.noneChoice }),
      ...(this.code === undefined ? {} : { code: this.code }),
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
  extra: Partial<
    Pick<
      ColorFieldHost,
      "categoryColor" | "customEvent" | "inheritedFrom" | "legend" | "noneChoice" | "code"
    >
  > = {},
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

it("keeps the category inheritance choice on one line when the category has no colour", async () => {
  const plain = await mount(null);
  const plainLines = fieldLines(plain.el);
  cleanupWidgets();
  const { el } = await mount(null, undefined, { categoryColor: null });
  const none = noneButton(el);
  await expect
    .element(page.elementLocator(none))
    .toHaveAccessibleName(t("editor.color_use_category"));
  await expect.element(page.elementLocator(none)).toHaveAccessibleDescription("");
  expect(none.querySelector(".note, .chip")).toBeNull();
  expect(fieldLines(el)).toEqual(plainLines);
});

it("does not paint or describe an invalid inherited colour", async () => {
  const { el } = await mount(null, undefined, { categoryColor: "#256bb1;position:fixed;inset:0" });
  const none = noneButton(el);
  expect(none.querySelector(".chip")).toBeNull();
  expect(none.querySelector(".note")).toBeNull();
  expect(none.hasAttribute("aria-describedby")).toBe(false);
});

it("keeps the inheritance choice's label clear of its border", async () => {
  const { el } = await mount(null, undefined, { categoryColor: null });
  const none = noneButton(el).getBoundingClientRect();
  const label = el.shadowRoot!.querySelector("#test-color-none-label")!.getBoundingClientRect();
  expect(label.top - none.top).toBeGreaterThanOrEqual(3);
  expect(none.bottom - label.bottom).toBeGreaterThanOrEqual(3);
});

it("draws today's No colour choice when given neither setting", async () => {
  const { el } = await mount(null);
  const none = noneButton(el);
  await expect.element(page.elementLocator(none)).toHaveAccessibleName(t("editor.color_none"));
  await expect.element(page.elementLocator(none)).toHaveAccessibleDescription("");
  expect(none.querySelector(".chip, .note")).toBeNull();
});

it("A498 keeps category inheritance selectable without an empty-colour note", async () => {
  const { el } = await mount(null, undefined, { categoryColor: null });
  const none = noneButton(el);
  await expect
    .element(page.elementLocator(none))
    .toHaveAccessibleName(t("editor.color_use_category"));
  expect(none.querySelector(".note")).toBeNull();
  expect(none.hasAttribute("aria-describedby")).toBe(false);
  await click(el, "#b12525");
  none.click();
  await el.updateComplete;
  expect(el.color).toBeNull();
});

it("a legend and a none choice of the caller's own", async () => {
  const { el } = await mount("#b12525", undefined, {
    legend: "Brand colour",
    noneChoice: { label: "Waitron's", chip: "#1f6feb" },
  });
  expect(el.shadowRoot!.querySelector("legend")!.textContent!.trim()).toBe("Brand colour");
  expect(el.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe(
    "Brand colour",
  );
  const none = noneButton(el);
  expect(none.textContent!.trim()).toBe("Waitron's");
  await expect.element(page.elementLocator(none)).toHaveAccessibleName("Waitron's");
  const chip = none.querySelector<HTMLElement>(".chip")!;
  expect(getComputedStyle(chip).backgroundColor).toBe("rgb(31, 111, 235)");
  await click(el, "");
  expect(el.color).toBeNull();
});

it("a code field beside the custom colour", async () => {
  const change = vi.fn();
  const code = { name: "brandColor", label: "Colour code", value: "", error: "", change };
  const { el } = await mount(null, undefined, { code });
  const field = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
    "wt-input[name=brandColor]",
  )!;
  expect(field).not.toBeNull();
  expect(field.closest("label")).toBeNull();
  expect(field.hideLabel).toBe(true);
  expect(field.label).toBe("Colour code");
  const inner = field.shadowRoot!.querySelector("input")!;
  await expect.element(page.elementLocator(inner)).toHaveAccessibleName("Colour code");
  const outer = vi.fn();
  el.addEventListener("wt-change", outer);
  await page.elementLocator(inner).fill("#1E5B3A");
  expect(change).toHaveBeenLastCalledWith("#1E5B3A");
  expect(outer).not.toHaveBeenCalled();

  el.code = { ...code, value: "#12", error: "Enter a colour as # and six digits or letters a–f." };
  await el.updateComplete;
  await field.updateComplete;
  expect(field.shadowRoot!.querySelector("[data-error]")!.textContent).toBe(
    "Enter a colour as # and six digits or letters a–f.",
  );
  expect(inner.getAttribute("aria-invalid")).toBe("true");
});

/** A host for one colour value, with a probe painted with the base focus ring. */
@customElement("test-colour-value-host")
class ColourValueHost extends LitElement {
  static override styles = [baseStyles, colourValueStyles];
  @property({ attribute: false }) options!: ColourValueOptions;
  override render() {
    return html`${colourValueField(this.options)}<span
        class="probe"
        style="outline: var(--wt-focus-ring); outline-offset: var(--wt-focus-offset)"
        >probe</span
      >`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "test-colour-value-host": ColourValueHost;
  }
}

describe("colourValueField", () => {
  const options = (extra: Partial<ColourValueOptions> = {}): ColourValueOptions => ({
    colour: "#f8f1e1",
    code: "#f8f1e1",
    name: "handSet.light.bg",
    pickerName: "handSetPicker.light.bg",
    label: "Page, light screens",
    codeLabel: "Page, light screens, colour code",
    error: "",
    busy: false,
    pick: vi.fn(),
    type: vi.fn(),
    ...extra,
  });
  const mountValue = (opts: ColourValueOptions) =>
    mountWidget<ColourValueHost>("test-colour-value-host", { options: opts });
  const picker = (el: ColourValueHost) =>
    el.shadowRoot!.querySelector<HTMLInputElement>('input[name="handSetPicker.light.bg"]')!;
  const codeField = (el: ColourValueHost) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      'wt-input[name="handSet.light.bg"]',
    )!;

  it("draws a picker and a hidden-label code field named for the value", async () => {
    const { el } = await mountValue(options({ code: "#F8F1E", error: "Bad code" }));
    const input = picker(el);
    expect(input.getAttribute("type")).toBe("color");
    expect(input.getAttribute("aria-label")).toBe("Page, light screens");
    expect(input.value).toBe("#f8f1e1");
    expect(input.classList.contains("on")).toBe(false);
    const field = codeField(el);
    expect(field.hideLabel).toBe(true);
    expect(field.label).toBe("Page, light screens, colour code");
    expect(field.value).toBe("#F8F1E");
    expect(field.error).toBe("Bad code");
    expect(input.disabled).toBe(false);
    expect(field.disabled).toBe(false);
  });

  it("reports a pick once and a typed code, and keeps both events inside", async () => {
    const opts = options();
    const { el } = await mountValue(opts);
    const outerInput = vi.fn();
    el.addEventListener("input", outerInput);
    const input = picker(el);
    input.value = "#123456";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect(opts.pick).toHaveBeenCalledTimes(1);
    expect(opts.pick).toHaveBeenCalledWith("#123456");
    expect(outerInput).not.toHaveBeenCalled();
    el.removeEventListener("input", outerInput);
    const outerChange = vi.fn();
    el.addEventListener("wt-change", outerChange);
    const inner = codeField(el).shadowRoot!.querySelector("input")!;
    await page.elementLocator(inner).fill("#abcdef");
    expect(opts.type).toHaveBeenLastCalledWith("#abcdef");
    expect(outerChange).not.toHaveBeenCalled();
  });

  it("keeps the code field compact, and an error under it on one line where there is room", async () => {
    const error = "Type a colour code such as #1e5b3a.";
    const { el, host } = await mountValue(options({ code: "#F8F1E", error }));
    host.style.width = "600px";
    await el.updateComplete;
    const field = codeField(el);
    const box = field.shadowRoot!.querySelector("[part=field]")!.getBoundingClientRect();
    expect(box.width).toBeLessThan(140);
    const message = field.shadowRoot!.querySelector("[data-error]")!;
    expect(message.textContent).toBe(error);
    const range = document.createRange();
    range.selectNodeContents(message);
    expect(range.getClientRects()).toHaveLength(1);
  });

  it("sets the code in the fixed-width font, and its error in the ordinary one", async () => {
    const { el } = await mountValue(options({ code: "#F8F1E", error: "Bad code" }));
    const field = codeField(el);
    const mono = getComputedStyle(el).getPropertyValue("--wt-font-family-mono").trim();
    const input = field.shadowRoot!.querySelector("input")!;
    expect(getComputedStyle(input).fontFamily).toBe(mono);
    const message = field.shadowRoot!.querySelector("[data-error]")!;
    expect(getComputedStyle(message).fontFamily).not.toBe(mono);
    expect(getComputedStyle(message).fontFamily).toBe(getComputedStyle(el).fontFamily);
  });

  it("disables both while busy", async () => {
    const { el } = await mountValue(options({ busy: true }));
    expect(picker(el).disabled).toBe(true);
    expect(codeField(el).disabled).toBe(true);
  });

  it("rings the focused picker with the base focus ring", async () => {
    const { el } = await mountValue(options());
    const input = picker(el);
    expect(getComputedStyle(input).outlineStyle).toBe("none");
    await userEvent.tab();
    expect(el.shadowRoot!.activeElement).toBe(input);
    const probe = getComputedStyle(el.shadowRoot!.querySelector(".probe")!);
    const ring = getComputedStyle(input);
    expect(probe.outlineOffset).toBe("2px");
    expect(ring.outlineColor).toBe(probe.outlineColor);
    expect(ring.outlineOffset).toBe(probe.outlineOffset);
  });
});
