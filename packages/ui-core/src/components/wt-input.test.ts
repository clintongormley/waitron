import { LitElement } from "lit";
import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

function parts(el: HTMLElement) {
  const root = el.shadowRoot!;
  return {
    field: root.querySelector<HTMLElement>(".field")!,
    label: root.querySelector<HTMLLabelElement>("label")!,
    input: root.querySelector<HTMLInputElement>("input")!,
  };
}

async function settle(el: HTMLElement): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await (el as LitElement).updateComplete;
}

test("renders its label", async () => {
  const el = await mount('<wt-input label="Weight"></wt-input>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Weight");
});

test("its value is body text and its floated label small text", async () => {
  const el = await mount('<wt-input label="Weight" value="1.25"></wt-input>');
  expect(getComputedStyle(el.shadowRoot!.querySelector("input")!).fontSize).toBe("14px");
  expect(getComputedStyle(el.shadowRoot!.querySelector("label")!).fontSize).toBe("12px");
});

test("associates the label with the input so it has an accessible name", async () => {
  const el = await mount('<wt-input label="Weight"></wt-input>');
  const label = el.shadowRoot!.querySelector("label")!;
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.id).not.toBe("");
  expect(label.htmlFor).toBe(input.id);
});

test("forwards a semantic name and autocomplete purpose to the native input", async () => {
  const el = await mount(
    '<wt-input label="Email" name="email" autocomplete="username"></wt-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.name).toBe("email");
  expect(input.autocomplete).toBe("username");
  expect(input.id).toBe("email");
});

test("forwards a maximum length to the native input, and sets none by default", async () => {
  const limited = await mount('<wt-input label="Name" name="partyName" maxlength="40"></wt-input>');
  const open = await mount('<wt-input label="Name"></wt-input>');
  expect(limited.shadowRoot!.querySelector("input")!.maxLength).toBe(40);
  expect(open.shadowRoot!.querySelector("input")!.hasAttribute("maxlength")).toBe(false);
});

test("marks a required field visibly and in the native input contract", async () => {
  const el = await mount('<wt-input label="Email" name="email" required></wt-input>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.required).toBe(true);
  expect(input.checkValidity()).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-required]")?.textContent).toBe("*");
});

test("links explanatory error text to the invalid native input", async () => {
  const el = await mount(
    '<wt-input label="Email" name="email" error="Enter a valid email address"></wt-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.textContent).toBe("Enter a valid email address");
});

test("describes the native input by its hint, then by any error", async () => {
  const el = await mount(
    '<wt-input label="Price" name="price" hint="Leave it empty to use the product price."></wt-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(hint.textContent).toBe("Leave it empty to use the product price.");
  expect(hint.id).toMatch(/^wt-input-hint-\d+$/);
  expect(input.getAttribute("aria-describedby")).toBe(hint.id);
  expect(hint.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  el.setAttribute("error", "Enter a price");
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(input.getAttribute("aria-describedby")).toBe(`${hint.id} ${error.id}`);
});

test("an input with no hint renders no hint description and is described by nothing", async () => {
  const el = await mount('<wt-input label="Price"></wt-input>');
  expect(el.shadowRoot!.querySelector("[data-hint]")).toBeNull();
  expect(el.shadowRoot!.querySelector("input")!.hasAttribute("aria-describedby")).toBe(false);
});

test("shows the hint inside the empty field as its placeholder when no placeholder is given", async () => {
  const el = await mount('<wt-input label="Price" hint="Leave it empty"></wt-input>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.getAttribute("placeholder")).toBe("Leave it empty");
  expect(input.matches(":placeholder-shown")).toBe(true);
});

test("an explicit placeholder wins over the hint, which still describes the field", async () => {
  const el = await mount(
    '<wt-input label="Price" placeholder="12.00" hint="Leave it empty"></wt-input>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(input.getAttribute("placeholder")).toBe("12.00");
  expect(hint.textContent).toBe("Leave it empty");
  expect(input.getAttribute("aria-describedby")).toBe(hint.id);
});

test("draws no hint line: the description is visually hidden and takes no room", async () => {
  const hinted = await mount(
    '<wt-input label="Price" hint="Leave it empty to use the product price."></wt-input>',
  );
  const plain = await mount('<wt-input label="Price"></wt-input>');
  const hint = hinted.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  const box = hint.getBoundingClientRect();
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
  const style = getComputedStyle(hint);
  expect(style.position).toBe("absolute");
  expect(style.overflow).toBe("hidden");
  expect(style.clip).toBe("rect(0px, 0px, 0px, 0px)");
  expect(style.whiteSpace).toBe("nowrap");
  expect(hinted.getBoundingClientRect().height).toBe(plain.getBoundingClientRect().height);
});

test("cuts a placeholder too long for the field with an ellipsis", async () => {
  const el = await mount('<wt-input label="Price" hint="Optional"></wt-input>');
  expect(getComputedStyle(el.shadowRoot!.querySelector("input")!).textOverflow).toBe("ellipsis");
});

test("a hint shown as the placeholder paints from the muted-text token", async () => {
  const el = await mount('<wt-input label="Price" hint="Optional"></wt-input>');
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(getComputedStyle(input, "::placeholder").color).toBe("rgb(7, 8, 9)");
});

test("places field help beside the field box, nesting its button in neither the label nor the box", async () => {
  const el = await mount('<wt-input label="Email"><button slot="help">?</button></wt-input>');
  const label = el.shadowRoot!.querySelector("label")!;
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="help"]')!;
  expect(label.contains(slot)).toBe(false);
  expect(el.shadowRoot!.querySelector(".field")!.contains(slot)).toBe(false);
  expect(slot.assignedElements()[0]?.textContent).toBe("?");
});

test("places an end action inside the field and only reserves space while it exists", async () => {
  const el = await mount('<wt-input label="Password"><button slot="end">Show</button></wt-input>');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await (el as LitElement).updateComplete;

  const control = el.shadowRoot!.querySelector<HTMLElement>(".field")!;
  const input = el.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  const action = el.querySelector<HTMLButtonElement>('[slot="end"]')!;
  expect(control.classList.contains("has-end")).toBe(true);
  expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(
    input.getBoundingClientRect().right,
  );
  expect(action.getBoundingClientRect().left).toBeGreaterThan(
    input.getBoundingClientRect().left + input.getBoundingClientRect().width / 2,
  );

  action.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await (el as LitElement).updateComplete;
  expect(control.classList.contains("has-end")).toBe(false);
});

test("gives each unnamed instance a unique fallback id", async () => {
  const a = await mount('<wt-input label="Weight"></wt-input>');
  const b = await mount('<wt-input label="Price"></wt-input>');
  const inputA = a.shadowRoot!.querySelector("input")!;
  const inputB = b.shadowRoot!.querySelector("input")!;
  expect(inputA.id).not.toBe(inputB.id);
  // Pins down the unnamed fallback's actual "wt-input-N" shape, not just that two ids differ
  // from each other: a mutant that empties out the "wt-input" prefix argument still produces two
  // distinct (but wrongly-shaped) ids and would slip past a bare inequality check.
  expect(inputA.id).toMatch(/^wt-input-\d+$/);
  expect(inputB.id).toMatch(/^wt-input-\d+$/);
});

test("reflects the initial value into the native input", async () => {
  const el = await mount('<wt-input value="1.25"></wt-input>');
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.value).toBe("1.25");
});

test("emits wt-change with the new value", async () => {
  const el = await mount("<wt-input></wt-input>");
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
  // Nesting wt-input inside a wrapper's own shadow root (mountInShadowRoot) and listening on
  // `document` — genuinely outside that shadow root — means flipping either bubbles or composed to
  // false stops the event from arriving here.
  const el = await mountInShadowRoot("<wt-input></wt-input>");
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

test("does not leak the native input event outside the component", async () => {
  const el = await mount("<wt-input></wt-input>");
  let native = 0;
  host.addEventListener("input", () => native++);

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

  expect(native).toBe(0);
});

test("wires the invalid property to aria-invalid, not just the visual border", async () => {
  const valid = await mount("<wt-input></wt-input>");
  expect(valid.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("false");

  const invalid = await mount("<wt-input invalid></wt-input>");
  expect(invalid.shadowRoot!.querySelector("input")!.getAttribute("aria-invalid")).toBe("true");
});

test("invalid state paints the bottom line and the label from the danger token", async () => {
  const el = await mount('<wt-input label="Email" invalid></wt-input>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label } = parts(el);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label).color).toBe("rgb(13, 14, 15)");
});

test("a disabled field paints its own paler fill, a dashed line and muted text, at full opacity", async () => {
  const el = await mount('<wt-input label="Name" value="Ana" disabled></wt-input>');
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  host.style.setProperty("--wt-color-field-fill-disabled", "rgb(21, 22, 23)");
  host.style.setProperty("--wt-color-text-muted", "rgb(24, 25, 26)");
  const { field, input } = parts(el);
  expect(field.hasAttribute("data-disabled")).toBe(true);
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(21, 22, 23)");
  expect(getComputedStyle(field).borderBottomStyle).toBe("dashed");
  expect(getComputedStyle(field).boxShadow).toBe("none");
  expect(getComputedStyle(input).color).toBe("rgb(24, 25, 26)");
  expect(getComputedStyle(input).opacity).toBe("1");
  expect(getComputedStyle(field).opacity).toBe("1");
});

test("is no wider than the field cap a container sets, and as wide as its container without one", async () => {
  const open = await mount('<wt-input label="Name"></wt-input>');
  host.style.width = "600px";
  expect(open.getBoundingClientRect().width).toBe(600);
  host.style.setProperty("--wt-field-max-width", "200px");
  expect(open.getBoundingClientRect().width).toBe(200);
  expect(open.shadowRoot!.querySelector("input")!.getBoundingClientRect().width).toBe(200);
});

test("meets the minimum tap target", async () => {
  const el = await mount("<wt-input></wt-input>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});

test("focusing the host delegates focus to the inner input", async () => {
  // A POS needs "focus the quantity field" constantly — without delegatesFocus, calling
  // .focus() on the wt-input host leaves the inner <input> unfocused.
  const el = await mount("<wt-input></wt-input>");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("input"));
});

test("an input with no attributes set is a plain text field with no label or placeholder", async () => {
  const el = await mount("<wt-input></wt-input>");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(el.shadowRoot!.querySelector(".label-row")).toBeNull();
  // The rendered attribute, not input.type: the browser reports "text" for an empty type
  // attribute as well, so only the attribute tells a default-typed field from an untyped one.
  expect(input.getAttribute("type")).toBe("text");
  expect(input.getAttribute("placeholder")).toBe("");
});

test("an input with no end action hides the end slot and keeps the field ready to hold one", async () => {
  const el = await mount("<wt-input></wt-input>");
  const input = el.shadowRoot!.querySelector("input")!;
  const end = el.shadowRoot!.querySelector<HTMLElement>('slot[name="end"]')!;
  expect(getComputedStyle(end).display).toBe("none");
  // The end action is positioned against this wrapper, so it has to stay a positioned ancestor
  // even while empty.
  expect(getComputedStyle(input.parentElement!).position).toBe("relative");
});

test("gives each instance's error text an id of its own, distinct from every other instance's", async () => {
  const a = await mount('<wt-input error="Enter a valid email address"></wt-input>');
  const b = await mount('<wt-input error="Enter a valid email address"></wt-input>');
  const errorA = a.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  const errorB = b.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(errorA.id).not.toBe(errorB.id);
  // Pins the "wt-input-error-N" shape, not just that the two differ: emptying the prefix still
  // produces two distinct ids, so only the shape catches it. A bare "-3" is still addressable —
  // `CSS.escape` and an attribute selector both reach it — what it stops being is readable.
  expect(errorA.id).toMatch(/^wt-input-error-\d+$/);
  expect(errorB.id).toMatch(/^wt-input-error-\d+$/);
});

test("the placeholder paints from the muted-text token", async () => {
  const el = await mount('<wt-input label="Name" placeholder="Coffee"></wt-input>');
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(getComputedStyle(input, "::placeholder").color).toBe("rgb(7, 8, 9)");
});

test("a labelled empty field with no hint is the field height tall, its label resting large and centred", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  host.style.setProperty("--wt-field-height", "70px");
  host.style.setProperty("--wt-field-label-rest-size", "17px");
  const { field, label, input } = parts(el);
  expect(field.getBoundingClientRect().height).toBe(70);
  expect(field.getAttribute("data-label")).toBe("rest");
  expect(field.hasAttribute("data-compact")).toBe(false);
  expect(input.hasAttribute("aria-label")).toBe(false);
  expect(getComputedStyle(label).fontSize).toBe("17px");
  const fieldBox = field.getBoundingClientRect();
  const labelBox = label.getBoundingClientRect();
  expect(
    Math.abs(labelBox.top + labelBox.height / 2 - (fieldBox.top + fieldBox.height / 2)),
  ).toBeLessThanOrEqual(1);
});

for (const [what, attrs] of [
  ["a value", 'value="x"'],
  ["a hint", 'hint="h"'],
  ["a placeholder", 'placeholder="p"'],
  ...["date", "time", "datetime-local", "month", "week"].map((type) => [
    `type ${type}`,
    `type="${type}"`,
  ]),
] as const) {
  test(`with ${what}, the label floats small at the top`, async () => {
    const el = await mount(`<wt-input label="When" ${attrs}></wt-input>`);
    host.style.setProperty("--wt-font-size-sm", "11px");
    const { field, label } = parts(el);
    expect(field.getAttribute("data-label")).toBe("float");
    expect(getComputedStyle(label).fontSize).toBe("11px");
    expect(label.getBoundingClientRect().top).toBeLessThan(
      field.getBoundingClientRect().top + field.getBoundingClientRect().height / 2,
    );
  });
}

test("focusing an empty field floats its label and draws the focus line and label colour", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  host.style.setProperty("--wt-field-label-rest-size", "17px");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label } = parts(el);
  expect(getComputedStyle(label).fontSize).toBe("17px");
  el.focus();
  expect(getComputedStyle(label).fontSize).toBe("11px");
  expect(getComputedStyle(field).boxShadow).toBe("rgb(1, 2, 3) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label).color).toBe("rgb(4, 5, 6)");
});

test("a field at rest draws its bottom line from the field-line token at the resting width", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  host.style.setProperty("--wt-color-field-line", "rgb(7, 7, 7)");
  host.style.setProperty("--wt-field-line-width", "1px");
  host.style.setProperty("--wt-color-field-fill", "rgb(8, 8, 8)");
  const { field } = parts(el);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(7, 7, 7) 0px -1px 0px 0px inset");
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(8, 8, 8)");
});

test("the focused control draws no focus ring of its own: the field's line is its focus indicator", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  const { input } = parts(el);
  input.focus();
  expect(input.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(input).outlineStyle).toBe("none");
});

test("a value set from code after the first render floats the label", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  const { field } = parts(el);
  expect(field.getAttribute("data-label")).toBe("rest");
  (el as HTMLElement & { value: string }).value = "Ana";
  await (el as LitElement).updateComplete;
  expect(field.getAttribute("data-label")).toBe("float");
});

test("typing into an empty field floats the label", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  const { field, input } = parts(el);
  input.value = "A";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await (el as LitElement).updateComplete;
  expect(field.getAttribute("data-label")).toBe("float");
});

test("an error marks the field invalid as the invalid property does", async () => {
  const el = await mount('<wt-input label="Email" error="Enter a valid email address"></wt-input>');
  const plain = await mount('<wt-input label="Email"></wt-input>');
  expect(parts(el).field.hasAttribute("data-invalid")).toBe(true);
  expect(parts(plain).field.hasAttribute("data-invalid")).toBe(false);
});

test("a focused invalid field keeps the danger line and label", async () => {
  const el = await mount('<wt-input label="Email" invalid></wt-input>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  el.focus();
  const { field, label, input } = parts(el);
  expect(el.shadowRoot!.activeElement).toBe(input);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label).color).toBe("rgb(13, 14, 15)");
});

test("the value paints from the field-value token", async () => {
  const el = await mount('<wt-input label="Name" value="Ana"></wt-input>');
  host.style.setProperty("--wt-color-field-value", "rgb(31, 32, 33)");
  expect(getComputedStyle(parts(el).input).color).toBe("rgb(31, 32, 33)");
});

test("a hint shown as the placeholder is italic", async () => {
  const el = await mount('<wt-input label="Price" hint="Optional"></wt-input>');
  expect(getComputedStyle(parts(el).input, "::placeholder").fontStyle).toBe("italic");
});

test("hide-label draws no label, names the input by its label, and makes the field compact", async () => {
  const el = await mount('<wt-input label="Search" hide-label></wt-input>');
  host.style.setProperty("--wt-tap-min", "47px");
  const { field, input } = parts(el);
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(input.getAttribute("aria-label")).toBe("Search");
  expect(field.hasAttribute("data-compact")).toBe(true);
  expect(field.getBoundingClientRect().height).toBe(47);
  expect(input.getBoundingClientRect().height).toBe(47);
});

test("a field with no label at all is compact and carries no accessible-name override", async () => {
  const el = await mount("<wt-input></wt-input>");
  host.style.setProperty("--wt-tap-min", "47px");
  const { field, input } = parts(el);
  expect(field.hasAttribute("data-compact")).toBe(true);
  expect(field.getBoundingClientRect().height).toBe(47);
  expect(input.hasAttribute("aria-label")).toBe(false);
});

test("an end action sits inside the field box at its trailing end, and the control leaves room for it", async () => {
  const el = await mount('<wt-input label="Password"><button slot="end">Show</button></wt-input>');
  await settle(el);
  const { field, input } = parts(el);
  const action = el.querySelector<HTMLButtonElement>('[slot="end"]')!;
  const fieldBox = field.getBoundingClientRect();
  const actionBox = action.getBoundingClientRect();
  expect(actionBox.right).toBeLessThanOrEqual(fieldBox.right);
  expect(actionBox.top).toBeGreaterThanOrEqual(fieldBox.top);
  expect(actionBox.bottom).toBeLessThanOrEqual(fieldBox.bottom);
  expect(actionBox.left).toBeGreaterThan(fieldBox.left + fieldBox.width / 2);
  expect(parseFloat(getComputedStyle(input).paddingRight)).toBeGreaterThanOrEqual(
    fieldBox.right - actionBox.left,
  );
});

test("a long label stops short of an end action", async () => {
  const el = await mount(
    `<wt-input label="${"Your current password, as you last set it ".repeat(3)}" value="x"><button slot="end">Show</button></wt-input>`,
  );
  host.style.width = "390px";
  await settle(el);
  const action = el.querySelector<HTMLButtonElement>('[slot="end"]')!;
  expect(parts(el).label.getBoundingClientRect().right).toBeLessThanOrEqual(
    action.getBoundingClientRect().left,
  );
});

test("field help sits outside the field box, at its trailing side and centred on it", async () => {
  const el = await mount('<wt-input label="Email"><button slot="help">?</button></wt-input>');
  const fieldBox = parts(el).field.getBoundingClientRect();
  const helpBox = el.querySelector("button")!.getBoundingClientRect();
  expect(helpBox.left).toBeGreaterThanOrEqual(fieldBox.right);
  expect(
    Math.abs(helpBox.top + helpBox.height / 2 - (fieldBox.top + fieldBox.height / 2)),
  ).toBeLessThanOrEqual(1);
});

test("a long label at phone width is cut with an ellipsis on one line", async () => {
  const long = "Nombre del cliente tal como aparecerá en la factura simplificada y en el ticket "
    .repeat(2)
    .slice(0, 120);
  const el = await mount(`<wt-input label="${long}" value="Ana"></wt-input>`);
  host.style.width = "390px";
  const short = await mount('<wt-input label="Nombre" value="Ana"></wt-input>');
  host.style.width = "390px";
  const label = parts(el).label;
  const field = parts(el).field;
  expect(long).toHaveLength(120);
  expect(getComputedStyle(label).textOverflow).toBe("ellipsis");
  expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
  expect(label.scrollHeight).toBe(parts(short).label.scrollHeight);
  expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
    field.getBoundingClientRect().right,
  );
});
