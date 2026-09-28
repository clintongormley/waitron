import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import { applyTokens } from "../tokens/index.js";
import "./wt-price-input.js";

afterEach(cleanup);

test("associates the label with the field so it has an accessible name", async () => {
  const el = await mount('<wt-price-input label="Price" name="price"></wt-price-input>');
  const label = el.shadowRoot!.querySelector("label")!;
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.id).toBe("price");
  expect(label.htmlFor).toBe(input.id);
});

test("shows the pricing unit on the trailing button", async () => {
  const el = await mount('<wt-price-input label="Price" unit="kg"></wt-price-input>');
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>("button.unit")!;
  expect(button.type).toBe("button");
  expect(button.textContent?.trim()).toBe("kg");
});

test("the unit button paints its border and text from tokens", async () => {
  const el = await mount('<wt-price-input unit="kg"></wt-price-input>');
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  const button = el.shadowRoot!.querySelector("button.unit")!;
  const styles = getComputedStyle(button);
  expect(styles.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(styles.color).toBe("rgb(4, 5, 6)");
});

test("reflects the initial value into the native input", async () => {
  const el = await mount('<wt-price-input value="1.25"></wt-price-input>');
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.value).toBe("1.25");
});

test("emits wt-change with the typed value", async () => {
  const el = await mount("<wt-price-input></wt-price-input>");
  let received: string | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ value: string }>).detail.value;
  });

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.value = "2.50";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

  expect(received).toBe("2.50");
});

test("wt-change bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = await mountInShadowRoot("<wt-price-input></wt-price-input>");
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener(
    "wt-change",
    (e) => {
      received = e as CustomEvent<{ value: string }>;
    },
    { once: true },
  );

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.value = "3.00";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

  expect(received?.detail.value).toBe("3.00");
});

test("clicking the unit button emits exactly one wt-unit-click and no leaked native click", async () => {
  const el = await mount('<wt-price-input unit="each"></wt-price-input>');
  let unitClicks = 0;
  let nativeClicks = 0;
  el.addEventListener("wt-unit-click", () => unitClicks++);
  host.addEventListener("click", () => nativeClicks++);

  el.shadowRoot!.querySelector<HTMLButtonElement>("button.unit")!.click();

  expect(unitClicks).toBe(1);
  // stopPropagation on the native click keeps the consumer from observing the change twice.
  expect(nativeClicks).toBe(0);
});

test("wt-unit-click bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = await mountInShadowRoot('<wt-price-input unit="each"></wt-price-input>');
  let received: CustomEvent | undefined;
  document.addEventListener(
    "wt-unit-click",
    (e) => {
      received = e as CustomEvent;
    },
    { once: true },
  );

  el.shadowRoot!.querySelector<HTMLButtonElement>("button.unit")!.click();

  expect(received).toBeDefined();
});

test("links explanatory error text to the invalid field", async () => {
  const el = await mount(
    '<wt-price-input label="Price" name="price" error="Enter a price"></wt-price-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.textContent).toBe("Enter a price");
});

test("a field with no error is not marked invalid", async () => {
  const el = await mount("<wt-price-input></wt-price-input>");
  expect(el.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("false");
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test("the error message paints from the danger token", async () => {
  const el = await mount('<wt-price-input error="Bad"></wt-price-input>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  const error = el.shadowRoot!.querySelector("[data-error]")!;
  expect(getComputedStyle(error).color).toBe("rgb(13, 14, 15)");
});

test("marks a required field visibly and in the native input contract", async () => {
  const el = await mount('<wt-price-input label="Price" name="price" required></wt-price-input>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.required).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-required]")?.textContent).toBe("*");
});

test("gives each unnamed instance a unique fallback id shaped wt-price-input-N", async () => {
  const a = await mount('<wt-price-input label="A"></wt-price-input>');
  const b = await mount('<wt-price-input label="B"></wt-price-input>');
  const idA = a.shadowRoot!.querySelector("input")!.id;
  const idB = b.shadowRoot!.querySelector("input")!.id;
  expect(idA).not.toBe(idB);
  expect(idA).toMatch(/^wt-price-input-\d+$/);
  expect(idB).toMatch(/^wt-price-input-\d+$/);
});

test("the money field meets the minimum tap target", async () => {
  const el = await mount("<wt-price-input></wt-price-input>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("focusing the host delegates focus to the inner field", async () => {
  const el = await mount("<wt-price-input></wt-price-input>");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("input"));
});

test("a disabled field refuses typing and refuses to open the unit picker", async () => {
  const el = await mount('<wt-price-input unit="kg" disabled></wt-price-input>');
  let unitClicks = 0;
  el.addEventListener("wt-unit-click", () => unitClicks++);
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  const button = el.shadowRoot!.querySelector<HTMLButtonElement>("button.unit")!;

  expect(input.disabled).toBe(true);
  expect(button.disabled).toBe(true);
  // A disabled control fires no click, so the consumer never sees the unit picker request.
  button.click();
  expect(unitClicks).toBe(0);
});

test("a disabled field dims via the disabled-opacity token", async () => {
  const el = await mount('<wt-price-input unit="kg" disabled></wt-price-input>');
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(el.shadowRoot!.querySelector("input")!).opacity).toBe("0.3");
  expect(getComputedStyle(el.shadowRoot!.querySelector("button.unit")!).opacity).toBe("0.3");
});

test("a price field created with nothing set is empty, unlabelled, unmarked and optional", async () => {
  const el = await mount("<wt-price-input></wt-price-input>");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.value).toBe("");
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(el.shadowRoot!.querySelector("button.unit")!.textContent!.trim()).toBe("");
  expect(input.required).toBe(false);
  expect(el.hasAttribute("required")).toBe(false);
});

test("shows its placeholder on the inner field only while the field is empty", async () => {
  const el = await mount('<wt-price-input placeholder="4.50"></wt-price-input>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.placeholder).toBe("4.50");
  expect(input.matches(":placeholder-shown")).toBe(true);

  input.value = "5.00";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(input.matches(":placeholder-shown")).toBe(false);

  input.value = "";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  expect(input.matches(":placeholder-shown")).toBe(true);
});

test("a field given a value does not show its placeholder", async () => {
  const el = await mount('<wt-price-input placeholder="4.50" value="5.00"></wt-price-input>');
  expect(el.shadowRoot!.querySelector("input")!.matches(":placeholder-shown")).toBe(false);
});

test("a field with no placeholder carries no placeholder attribute", async () => {
  const el = await mount("<wt-price-input></wt-price-input>");
  expect(el.shadowRoot!.querySelector("input")!.hasAttribute("placeholder")).toBe(false);
});

test("the placeholder paints from the muted-text token", async () => {
  const el = await mount('<wt-price-input placeholder="4.50"></wt-price-input>');
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(getComputedStyle(input, "::placeholder").color).toBe("rgb(7, 8, 9)");
});

test("a named field submits under its own name, and an unnamed one carries no name at all", async () => {
  const named = await mount('<wt-price-input name="price"></wt-price-input>');
  expect(named.shadowRoot!.querySelector("input")!.getAttribute("name")).toBe("price");
  const unnamed = await mount("<wt-price-input></wt-price-input>");
  expect(unnamed.shadowRoot!.querySelector("input")!.hasAttribute("name")).toBe(false);
});

test("each error message gets its own id shaped wt-price-input-error-N, and the field points at it", async () => {
  const a = await mount('<wt-price-input error="Enter a price"></wt-price-input>');
  const b = await mount('<wt-price-input error="Enter a price"></wt-price-input>');
  const idA = a.shadowRoot!.querySelector("[data-error]")!.id;
  const idB = b.shadowRoot!.querySelector("[data-error]")!.id;
  expect(idA).toMatch(/^wt-price-input-error-\d+$/);
  expect(idB).toMatch(/^wt-price-input-error-\d+$/);
  expect(idA).not.toBe(idB);
  expect(a.shadowRoot!.querySelector("input")!.getAttribute("aria-describedby")).toBe(idA);
});

test("hide-label names the field for assistive technology but draws no label", async () => {
  const el = await mount(
    '<wt-price-input label="Price" name="price" required hide-label></wt-price-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-required]")).toBeNull();
  expect(input.getAttribute("aria-label")).toBe("Price");
  expect(input.required).toBe(true);
});

test("a drawn label names the field, so the field carries no aria-label of its own", async () => {
  const el = await mount('<wt-price-input label="Price" name="price"></wt-price-input>');
  expect(el.shadowRoot!.querySelector("input")!.hasAttribute("aria-label")).toBe(false);
});

test("fixed-unit shows the unit as text, with no control to focus or press", async () => {
  const el = await mount('<wt-price-input label="Price" unit="kg" fixed-unit></wt-price-input>');
  let unitClicks = 0;
  el.addEventListener("wt-unit-click", () => unitClicks++);
  const unit = el.shadowRoot!.querySelector<HTMLElement>(".unit")!;

  expect(el.shadowRoot!.querySelector("button")).toBeNull();
  expect(unit.textContent!.trim()).toBe("kg");
  expect(unit.tabIndex).toBe(-1);
  unit.click();
  expect(unitClicks).toBe(0);
});

test("a fixed unit is read out with the field, after any error", async () => {
  const el = await mount(
    '<wt-price-input label="Price" unit="kg" fixed-unit error="Enter a price"></wt-price-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  const unit = el.shadowRoot!.querySelector<HTMLElement>(".unit")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(input.getAttribute("aria-describedby")).toBe(`${error.id} ${unit.id}`);
});

test("a fixed unit paints its border and text from tokens, and stands as tall as the field", async () => {
  const el = await mount('<wt-price-input unit="kg" fixed-unit></wt-price-input>');
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  const unit = el.shadowRoot!.querySelector<HTMLElement>(".unit")!;
  const input = el.shadowRoot!.querySelector("input")!;
  const styles = getComputedStyle(unit);
  expect(styles.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(styles.color).toBe("rgb(4, 5, 6)");
  expect(styles.cursor).not.toBe("pointer");
  expect(unit.getBoundingClientRect().height).toBe(input.getBoundingClientRect().height);
});

test("a fixed unit is a tighter box than the unit button, padded by --wt-space-2", async () => {
  const el = await mount('<wt-price-input unit="kg" fixed-unit></wt-price-input>');
  host.style.setProperty("--wt-space-2", "5px");
  host.style.setProperty("--wt-space-3", "11px");
  const unit = getComputedStyle(el.shadowRoot!.querySelector(".unit")!);
  expect([unit.paddingInlineStart, unit.paddingInlineEnd]).toEqual(["5px", "5px"]);
});

test("a fixed unit that is empty draws no unit box, and the field keeps its own trailing edge", async () => {
  const el = await mount("<wt-price-input fixed-unit></wt-price-input>");
  host.style.setProperty("--wt-radius-md", "7px");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(el.shadowRoot!.querySelector(".unit")).toBeNull();
  expect(input.hasAttribute("aria-describedby")).toBe(false);
  expect(getComputedStyle(input).borderInlineEndWidth).toBe("1px");
  expect(getComputedStyle(input).borderStartEndRadius).toBe("7px");
});

test("the amount box is --wt-price-field-width wide when nothing stretches it", async () => {
  const el = await mount(
    '<wt-price-input unit="kg" style="display: inline-block"></wt-price-input>',
  );
  host.style.setProperty("--wt-price-field-width", "91px");
  expect(el.shadowRoot!.querySelector("input")!.getBoundingClientRect().width).toBe(91);
});

test("the amount box still fills a wider field", async () => {
  const el = await mount('<wt-price-input unit="kg" style="width: 400px"></wt-price-input>');
  const input = el.shadowRoot!.querySelector("input")!.getBoundingClientRect();
  const unit = el.shadowRoot!.querySelector(".unit")!.getBoundingClientRect();
  expect(input.width + unit.width).toBe(400);
});

test("a fixed unit joins the field with the field's own end border, and square corners at the seam", async () => {
  const el = await mount('<wt-price-input unit="kg" fixed-unit></wt-price-input>');
  host.style.setProperty("--wt-radius-md", "7px");
  const input = getComputedStyle(el.shadowRoot!.querySelector("input")!);
  const unit = getComputedStyle(el.shadowRoot!.querySelector(".unit")!);
  expect([
    input.borderInlineEndWidth,
    input.borderStartEndRadius,
    input.borderEndEndRadius,
  ]).toEqual(["1px", "0px", "0px"]);
  expect([unit.borderInlineStartWidth, unit.borderStartEndRadius]).toEqual(["0px", "7px"]);
});

test("exposes the amount and a fixed unit as parts, so a host can move the unit under the amount", async () => {
  const beside = await mount(
    '<wt-price-input unit="kilogramos" fixed-unit style="display: inline-block"></wt-price-input>',
  );
  const besideBox = beside.shadowRoot!.querySelector("input")!.getBoundingClientRect();
  const besideUnit = beside.shadowRoot!.querySelector(".unit")!.getBoundingClientRect();
  expect([besideUnit.top, besideUnit.left]).toEqual([besideBox.top, besideBox.right]);

  // Styled from a shadow root of its own, as a consuming screen restyles it.
  const outer = document.createElement("div");
  document.body.append(outer);
  applyTokens(outer);
  try {
    const shadow = outer.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
        wt-price-input::part(unit) { flex-basis: 100%; }
        wt-price-input::part(amount) { border-start-end-radius: 3px; }
      </style>
      <wt-price-input unit="kilogramos" fixed-unit style="display: inline-block"></wt-price-input>`;
    const el = shadow.querySelector("wt-price-input")! as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector("input")!;
    const box = input.getBoundingClientRect();
    const unit = el.shadowRoot!.querySelector(".unit")!.getBoundingClientRect();
    expect(unit.top).toBeGreaterThanOrEqual(box.bottom);
    expect(unit.left).toBe(box.left);
    expect(box.width).toBe(besideBox.width);
    expect(getComputedStyle(input).borderStartEndRadius).toBe("3px");
  } finally {
    outer.remove();
  }
});

// The sign is measured after layout, so a test reads positions two frames after mounting.
const settled = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

async function mountPrice(html: string) {
  const el = await mount(html);
  await settled();
  const input = el.shadowRoot!.querySelector("input")!;
  const currency = el.shadowRoot!.querySelector<HTMLElement>('[part~="currency"]');
  return { el, input, currency };
}

/** The input's content box, where it lays out the typed text. */
function contentBox(input: HTMLInputElement) {
  const box = input.getBoundingClientRect();
  const s = getComputedStyle(input);
  const px = (v: string) => Number.parseFloat(v);
  return {
    left: box.left + px(s.borderLeftWidth) + px(s.paddingLeft),
    right: box.right - px(s.borderRightWidth) - px(s.paddingRight),
    top: box.top,
    bottom: box.bottom,
  };
}

/** The typed value's box: the text's measured width, placed where the input aligns it. */
function typedTextBox(input: HTMLInputElement) {
  const s = getComputedStyle(input);
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = s.font;
  const width = ctx.measureText(input.value).width;
  const content = contentBox(input);
  const alignedEnd = s.textAlign === "end" || s.textAlign === "right";
  return alignedEnd
    ? { left: content.right - width, right: content.right }
    : { left: content.left, right: content.left + width };
}

function expectInsideField(currency: HTMLElement, input: HTMLInputElement) {
  const sign = currency.getBoundingClientRect();
  const box = input.getBoundingClientRect();
  expect(sign.width).toBeGreaterThan(0);
  expect(sign.left).toBeGreaterThanOrEqual(box.left);
  expect(sign.right).toBeLessThanOrEqual(box.right);
  expect(sign.top).toBeGreaterThanOrEqual(box.top);
  expect(sign.bottom).toBeLessThanOrEqual(box.bottom);
}

test("with an English locale the euro sign sits inside the field, before the typed amount", async () => {
  const { input, currency } = await mountPrice(
    '<wt-price-input label="Price" unit="kg" value="9.00" locale="en-GB"></wt-price-input>',
  );
  expect(currency!.textContent!.trim()).toBe("€");
  expectInsideField(currency!, input);
  expect(currency!.getBoundingClientRect().right).toBeLessThanOrEqual(typedTextBox(input).left);
});

test("with a Spanish locale the euro sign sits inside the field, after the typed amount", async () => {
  const { input, currency } = await mountPrice(
    '<wt-price-input label="Precio" unit="kg" value="9,00" locale="es-ES"></wt-price-input>',
  );
  expect(currency!.textContent!.trim()).toBe("€");
  expectInsideField(currency!, input);
  expect(currency!.getBoundingClientRect().left).toBeGreaterThanOrEqual(typedTextBox(input).right);
});

test("with no locale the field draws no currency sign", async () => {
  const { input, currency } = await mountPrice(
    '<wt-price-input label="Price" unit="kg" value="9.00"></wt-price-input>',
  );
  expect(currency).toBeNull();
  expect(input.hasAttribute("aria-describedby")).toBe(false);
});

test.each(["en-GB", "es-ES"])(
  "a %s sign never sits over the typed amount, however long the amount runs",
  async (locale) => {
    const { input, currency } = await mountPrice(
      `<wt-price-input unit="kg" fixed-unit locale="${locale}" value="123456789012345678,00"></wt-price-input>`,
    );
    const sign = currency!.getBoundingClientRect();
    const content = contentBox(input);
    expect(sign.right <= content.left || sign.left >= content.right).toBe(true);
  },
);

test.each([
  ["en-GB", "before", "a unit button"],
  ["es-ES", "after", "a unit button"],
  ["es-ES", "after", "a fixed unit"],
])(
  "in a wide %s field the amount sits against the sign %s it, --wt-space-1 away, beside %s",
  async (locale, side, unit) => {
    const fixed = unit === "a fixed unit" ? "fixed-unit" : "";
    const { input, currency } = await mountPrice(
      `<wt-price-input unit="kg" ${fixed} locale="${locale}" value="9,00" style="width: 400px"></wt-price-input>`,
    );
    host.style.setProperty("--wt-space-1", "5px");
    await settled();
    const sign = currency!.getBoundingClientRect();
    const text = typedTextBox(input);
    const gap = side === "before" ? text.left - sign.right : sign.left - text.right;
    expect(gap).toBeCloseTo(5, 0);
  },
);

test("the currency sign paints from the muted-text token", async () => {
  const { currency } = await mountPrice('<wt-price-input locale="en-GB"></wt-price-input>');
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  expect(getComputedStyle(currency!).color).toBe("rgb(7, 8, 9)");
});

test("a disabled field dims its currency sign via the disabled-opacity token", async () => {
  const { currency } = await mountPrice(
    '<wt-price-input locale="en-GB" disabled></wt-price-input>',
  );
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(currency!).opacity).toBe("0.3");
});

test("pressing the currency sign reaches the amount box beneath it", async () => {
  const { el, input, currency } = await mountPrice(
    '<wt-price-input locale="es-ES" value="9,00"></wt-price-input>',
  );
  const sign = currency!.getBoundingClientRect();
  const hit = el.shadowRoot!.elementFromPoint(
    sign.left + sign.width / 2,
    sign.top + sign.height / 2,
  );
  expect(hit).toBe(input);
});

test("the currency is read out with the field, after any error and before a fixed unit", async () => {
  const { el, input, currency } = await mountPrice(
    '<wt-price-input label="Price" unit="kg" fixed-unit locale="en-GB" error="Enter a price"></wt-price-input>',
  );
  const unit = el.shadowRoot!.querySelector<HTMLElement>(".unit")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(currency!.id).toMatch(/^wt-price-input-currency-\d+$/);
  expect(input.getAttribute("aria-describedby")).toBe(`${error.id} ${currency!.id} ${unit.id}`);
});

test("changing the locale moves the sign to the side the new locale writes it, and clearing it removes the sign", async () => {
  const { el } = await mountPrice(
    '<wt-price-input unit="kg" value="9.00" locale="en-GB"></wt-price-input>',
  );
  const price = el as HTMLElementTagNameMap["wt-price-input"];
  const input = el.shadowRoot!.querySelector("input")!;
  price.locale = "es-ES";
  await price.updateComplete;
  await settled();
  const sign = el.shadowRoot!.querySelector<HTMLElement>('[part~="currency"]')!;
  expect(sign.getBoundingClientRect().left).toBeGreaterThanOrEqual(typedTextBox(input).right);

  price.locale = "";
  await price.updateComplete;
  expect(el.shadowRoot!.querySelector('[part~="currency"]')).toBeNull();
  expect(el.shadowRoot!.querySelector("input")!.hasAttribute("aria-describedby")).toBe(false);
});

test("with a locale the amount part is still the input, and a fixed unit still joins the field's trailing edge", async () => {
  const { el, input } = await mountPrice(
    '<wt-price-input unit="kg" fixed-unit locale="es-ES" style="display: inline-block"></wt-price-input>',
  );
  host.style.setProperty("--wt-radius-md", "7px");
  host.style.setProperty("--wt-price-field-width", "91px");
  expect(el.shadowRoot!.querySelector('[part~="amount"]')).toBe(input);
  const box = input.getBoundingClientRect();
  const unit = el.shadowRoot!.querySelector(".unit")!.getBoundingClientRect();
  expect(box.width).toBe(91);
  expect([unit.top, unit.left]).toEqual([box.top, box.right]);
  expect([
    getComputedStyle(input).borderInlineEndWidth,
    getComputedStyle(input).borderStartEndRadius,
  ]).toEqual(["1px", "0px"]);
});

test("with a locale and a unit button, the amount box fills a wider field and meets the button", async () => {
  const { el, input } = await mountPrice(
    '<wt-price-input unit="kg" locale="en-GB" style="width: 400px"></wt-price-input>',
  );
  const box = input.getBoundingClientRect();
  const unit = el.shadowRoot!.querySelector(".unit")!.getBoundingClientRect();
  expect(box.width + unit.width).toBe(400);
  expect(getComputedStyle(input).borderInlineEndWidth).toBe("0px");
});

test("with a locale and no unit, the amount box keeps its own trailing edge", async () => {
  const { input } = await mountPrice('<wt-price-input fixed-unit locale="en-GB"></wt-price-input>');
  host.style.setProperty("--wt-radius-md", "7px");
  expect(getComputedStyle(input).borderInlineEndWidth).toBe("1px");
  expect(getComputedStyle(input).borderStartEndRadius).toBe("7px");
});

function expectSignClearOfText(currency: HTMLElement, input: HTMLInputElement) {
  const sign = currency.getBoundingClientRect();
  const content = contentBox(input);
  expect(sign.width).toBeGreaterThan(0);
  expect(sign.right <= content.left || sign.left >= content.right).toBe(true);
}

test("a field hidden when it renders measures its sign once it is shown", async () => {
  const hidden = await mount(
    '<div style="display: none"><wt-price-input locale="en-GB" value="9.00"></wt-price-input></div>',
  );
  const el = hidden.querySelector("wt-price-input")!;
  await el.updateComplete;
  await settled();
  hidden.style.display = "";
  await settled();
  expectSignClearOfText(
    el.shadowRoot!.querySelector<HTMLElement>('[part~="currency"]')!,
    el.shadowRoot!.querySelector("input")!,
  );
});

test("a field moved elsewhere in the page re-measures its sign", async () => {
  const { el, input, currency } = await mountPrice(
    '<wt-price-input locale="es-ES" value="9,00"></wt-price-input>',
  );
  el.remove();
  host.style.setProperty("--wt-font-size-md", "40px");
  host.append(el);
  await settled();
  expectSignClearOfText(currency!, input);
});
