import { expect, test, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-number-stepper.js";
import "./wt-input.js";

afterEach(cleanup);

function parts(el: Element) {
  const root = el.shadowRoot!;
  return {
    input: root.querySelector("input")!,
    minus: root.querySelector<HTMLButtonElement>('button[data-step="-1"]')!,
    plus: root.querySelector<HTMLButtonElement>('button[data-step="1"]')!,
    label: root.querySelector("label"),
  };
}

function changes(el: Element): string[] {
  const seen: string[] = [];
  el.addEventListener("wt-change", (e) =>
    seen.push((e as CustomEvent<{ value: string }>).detail.value),
  );
  return seen;
}

function type(el: Element, text: string): void {
  const { input } = parts(el);
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

test("+ and - step the value and emit it", async () => {
  const el = await mount('<wt-number-stepper label="Max" value="2" min="1"></wt-number-stepper>');
  const seen = changes(el);
  parts(el).plus.click();
  parts(el).minus.click();
  expect(seen).toEqual(["3", "2"]);
});

test("a step shows the new value in the box", async () => {
  const el = await mount('<wt-number-stepper label="Max" value="2"></wt-number-stepper>');
  parts(el).plus.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(parts(el).input.value).toBe("3");
});

test("- is disabled at min and + at max", async () => {
  const el = await mount(
    '<wt-number-stepper label="Q" value="1" min="1" max="1"></wt-number-stepper>',
  );
  expect(parts(el).minus.disabled).toBe(true);
  expect(parts(el).plus.disabled).toBe(true);
});

test("both buttons are enabled strictly between the bounds", async () => {
  const el = await mount(
    '<wt-number-stepper label="Q" value="2" min="1" max="3"></wt-number-stepper>',
  );
  expect(parts(el).minus.disabled).toBe(false);
  expect(parts(el).plus.disabled).toBe(false);
});

test("+ stops at max and - stops at min even when the typed value is already outside them", async () => {
  const el = await mount(
    '<wt-number-stepper label="Q" value="9" min="1" max="5"></wt-number-stepper>',
  );
  const seen = changes(el);
  // Above max: + is disabled, and - brings it back inside rather than to 8.
  expect(parts(el).plus.disabled).toBe(true);
  parts(el).minus.click();
  const low = await mount('<wt-number-stepper label="Q" value="-3" min="1"></wt-number-stepper>');
  const seenLow = changes(low);
  expect(parts(low).minus.disabled).toBe(true);
  parts(low).plus.click();
  expect(seen).toEqual(["5"]);
  expect(seenLow).toEqual(["1"]);
});

test("+ has no upper bound when max is not set", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="999"></wt-number-stepper>');
  const seen = changes(el);
  parts(el).plus.click();
  expect(seen).toEqual(["1000"]);
});

test("+ on a blank value gives min, or 1 when min is 0", async () => {
  const zero = await mount('<wt-number-stepper label="Max"></wt-number-stepper>');
  const seenZero = changes(zero);
  parts(zero).plus.click();
  expect(seenZero).toEqual(["1"]);
  const three = await mount('<wt-number-stepper label="Min" min="3"></wt-number-stepper>');
  const seenThree = changes(three);
  parts(three).plus.click();
  expect(seenThree).toEqual(["3"]);
});

test("+ on text that is not a whole number starts again from min", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="abc" min="2"></wt-number-stepper>');
  const seen = changes(el);
  expect(parts(el).minus.disabled).toBe(true);
  parts(el).plus.click();
  expect(seen).toEqual(["2"]);
});

test("+ on a blank or non-numeric value never goes above max", async () => {
  for (const value of ["", "abc"]) {
    const el = await mount(
      `<wt-number-stepper label="Q" value="${value}" min="0" max="0"></wt-number-stepper>`,
    );
    const seen = changes(el);
    parts(el).plus.click();
    expect(seen).toEqual(["0"]);
  }
});

test("a step that leaves the value where it is emits nothing", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1" max="2"></wt-number-stepper>');
  const seen = changes(el);
  // Both clicks land before a render can disable + at max.
  parts(el).plus.click();
  parts(el).plus.click();
  expect(seen).toEqual(["2"]);
});

test("- on a blank value does nothing, so only clearing the box reaches blank", async () => {
  const el = await mount('<wt-number-stepper label="Max"></wt-number-stepper>');
  const seen = changes(el);
  expect(parts(el).minus.disabled).toBe(true);
  // A disabled button fires no click, so re-enable it for the click to reach the handler.
  parts(el).minus.disabled = false;
  parts(el).minus.click();
  expect(seen).toEqual([]);
});

test("a clearable stepper's − on its lowest number clears the box and emits the blank", async () => {
  const el = await mount(
    '<wt-number-stepper label="Max" value="1" min="1" clearable></wt-number-stepper>',
  );
  const seen = changes(el);
  expect(parts(el).minus.disabled).toBe(false);
  parts(el).minus.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(seen).toEqual([""]);
  expect(parts(el).input.value).toBe("");
});

test("a clearable stepper steps down to its lowest number before it clears", async () => {
  const el = await mount(
    '<wt-number-stepper label="Max" value="3" min="1" clearable></wt-number-stepper>',
  );
  const seen = changes(el);
  for (let press = 0; press < 3; press++) {
    parts(el).minus.click();
    await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  }
  expect(seen).toEqual(["2", "1", ""]);
});

test("a clearable stepper's − is disabled only while the box is blank", async () => {
  const blank = await mount(
    '<wt-number-stepper label="Max" min="1" clearable></wt-number-stepper>',
  );
  expect(parts(blank).minus.disabled).toBe(true);
  const seen = changes(blank);
  parts(blank).plus.click();
  expect(seen).toEqual(["1"]);
  await (blank as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(parts(blank).minus.disabled).toBe(false);
});
test("typing emits the raw text, unclamped, so the form's own validation sees it", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1" min="1"></wt-number-stepper>');
  const seen = changes(el);
  for (const typed of ["0", "abc", ""]) type(el, typed);
  expect(seen).toEqual(["0", "abc", ""]);
  expect((el as HTMLElement & { value: string }).value).toBe("");
});

test("a typed value is what the next step counts from", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  const seen = changes(el);
  type(el, "7");
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  parts(el).plus.click();
  expect(seen).toEqual(["7", "8"]);
});

test("a step emits exactly one wt-change and lets no native click out", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  let clicks = 0;
  host.addEventListener("click", () => clicks++);
  const seen = changes(el);
  parts(el).plus.click();
  expect(seen).toEqual(["2"]);
  expect(clicks).toBe(0);
});

test("a step that changes nothing lets no native click out either", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="2" max="2"></wt-number-stepper>');
  let clicks = 0;
  host.addEventListener("click", () => clicks++);
  const seen = changes(el);
  parts(el).plus.disabled = false;
  parts(el).plus.click();
  expect(seen).toEqual([]);
  expect(clicks).toBe(0);
});

test("typing lets no native input event out", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  let inputs = 0;
  host.addEventListener("input", () => inputs++);
  type(el, "4");
  expect(inputs).toBe(0);
});

test("the buttons are named after the field", async () => {
  const el = await mount('<wt-number-stepper label="Maximum quantity"></wt-number-stepper>');
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Decrease Maximum quantity");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Increase Maximum quantity");
});

test("the button names can be translated, each built from the field's label", async () => {
  const el = await mount('<wt-number-stepper label="Máximo"></wt-number-stepper>');
  const stepper = el as HTMLElement & {
    decreaseLabel: (label: string) => string;
    increaseLabel: (label: string) => string;
    updateComplete: Promise<unknown>;
  };
  stepper.decreaseLabel = (label) => `Reducir ${label}`;
  stepper.increaseLabel = (label) => `${label}: aumentar`;
  await stepper.updateComplete;
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Reducir Máximo");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Máximo: aumentar");
});

test("the button names are properties only, never read from an attribute", async () => {
  const el = await mount(
    '<wt-number-stepper label="Q" decreaselabel="Reducir {label}" increaselabel="Aumentar {label}"></wt-number-stepper>',
  );
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Decrease Q");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Increase Q");
});

test("the buttons are plain buttons, not submit buttons", async () => {
  const el = await mount('<wt-number-stepper label="Q"></wt-number-stepper>');
  expect(parts(el).minus.type).toBe("button");
  expect(parts(el).plus.type).toBe("button");
});

test("the buttons draw the minus and plus icons", async () => {
  const el = await mount('<wt-number-stepper label="Q"></wt-number-stepper>');
  expect(parts(el).minus.querySelector("wt-icon")!.getAttribute("name")).toBe("minus");
  expect(parts(el).plus.querySelector("wt-icon")!.getAttribute("name")).toBe("plus");
});

test("wt-change crosses shadow boundaries", async () => {
  const el = await mountInShadowRoot('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener("wt-change", (e) => (received = e as CustomEvent<{ value: string }>), {
    once: true,
  });
  parts(el).plus.click();
  expect(received?.detail.value).toBe("2");
});

test("a typed wt-change crosses shadow boundaries too", async () => {
  const el = await mountInShadowRoot('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener("wt-change", (e) => (received = e as CustomEvent<{ value: string }>), {
    once: true,
  });
  type(el, "12");
  expect(received?.detail.value).toBe("12");
});

test("associates the label with the number box", async () => {
  const el = await mount('<wt-number-stepper label="Maximum" name="max"></wt-number-stepper>');
  const { input, label } = parts(el);
  expect(input.id).toBe("max");
  expect(input.getAttribute("name")).toBe("max");
  expect(label!.htmlFor).toBe("max");
  expect(label!.textContent!.trim()).toBe("Maximum");
});

test("an unnamed stepper gets its own id and carries no name", async () => {
  const a = await mount('<wt-number-stepper label="A"></wt-number-stepper>');
  const b = await mount('<wt-number-stepper label="B"></wt-number-stepper>');
  expect(parts(a).input.id).toMatch(/^wt-number-stepper-\d+$/);
  expect(parts(a).input.id).not.toBe(parts(b).input.id);
  expect(parts(a).label!.htmlFor).toBe(parts(a).input.id);
  expect(parts(a).input.hasAttribute("name")).toBe(false);
});

test("the number box asks for a numeric keypad and shows the value", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="4"></wt-number-stepper>');
  expect(parts(el).input.getAttribute("inputmode")).toBe("numeric");
  expect(parts(el).input.value).toBe("4");
});

test("hide-label names the box for assistive technology but draws no label", async () => {
  const el = await mount(
    '<wt-number-stepper label="Max quantity" name="q" hide-label></wt-number-stepper>',
  );
  expect(parts(el).label).toBeNull();
  expect(parts(el).input.getAttribute("aria-label")).toBe("Max quantity");
  const shown = await mount('<wt-number-stepper label="Max quantity"></wt-number-stepper>');
  expect(parts(shown).label).not.toBeNull();
  // A drawn label names the box; a second name would be read twice.
  expect(parts(shown).input.hasAttribute("aria-label")).toBe(false);
});

test("a stepper with no label draws no label", async () => {
  const el = await mount("<wt-number-stepper></wt-number-stepper>");
  expect(parts(el).label).toBeNull();
});

test("shows its placeholder only on an empty box, and carries none when unset", async () => {
  const el = await mount(
    '<wt-number-stepper label="Max" placeholder="No limit"></wt-number-stepper>',
  );
  expect(parts(el).input.placeholder).toBe("No limit");
  expect(parts(el).input.matches(":placeholder-shown")).toBe(true);
  const bare = await mount('<wt-number-stepper label="Max"></wt-number-stepper>');
  expect(parts(bare).input.hasAttribute("placeholder")).toBe(false);
});

test("links the error text to the box and marks it invalid", async () => {
  const el = await mount(
    '<wt-number-stepper label="Max" error="Enter 1 or more"></wt-number-stepper>',
  );
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(error.textContent).toBe("Enter 1 or more");
  expect(error.id).toMatch(/^wt-number-stepper-error-\d+$/);
  expect(parts(el).input.getAttribute("aria-invalid")).toBe("true");
  expect(parts(el).input.getAttribute("aria-describedby")).toBe(error.id);
});

test("invalid alone marks the box without an error line", async () => {
  const el = await mount('<wt-number-stepper label="Max" invalid></wt-number-stepper>');
  expect(parts(el).input.getAttribute("aria-invalid")).toBe("true");
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(parts(el).input.hasAttribute("aria-describedby")).toBe(false);
});

test("a valid stepper is not marked invalid", async () => {
  const el = await mount('<wt-number-stepper label="Max"></wt-number-stepper>');
  expect(parts(el).input.getAttribute("aria-invalid")).toBe("false");
});

test("describes the box with its hint, before any error", async () => {
  const el = await mount(
    '<wt-number-stepper label="Min" hint="0 makes the list optional" error="Too many"></wt-number-stepper>',
  );
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(hint.textContent).toBe("0 makes the list optional");
  expect(hint.id).toMatch(/^wt-number-stepper-hint-\d+$/);
  expect(parts(el).input.getAttribute("aria-describedby")).toBe(`${hint.id} ${error.id}`);
  const bare = await mount('<wt-number-stepper label="Min"></wt-number-stepper>');
  expect(bare.shadowRoot!.querySelector("[data-hint]")).toBeNull();
});

test("a hint shown as the placeholder paints from the muted-text token and the error from the danger token", async () => {
  const el = await mount(
    '<wt-number-stepper label="Min" hint="Help" error="Bad"></wt-number-stepper>',
  );
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  expect(getComputedStyle(parts(el).input, "::placeholder").color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(el.shadowRoot!.querySelector("[data-error]")!).color).toBe(
    "rgb(13, 14, 15)",
  );
});

test("shows the hint inside the empty box as its placeholder when no placeholder is given", async () => {
  const el = await mount('<wt-number-stepper label="Min" hint="Optional"></wt-number-stepper>');
  expect(parts(el).input.getAttribute("placeholder")).toBe("Optional");
  expect(parts(el).input.matches(":placeholder-shown")).toBe(true);
});

test("an explicit placeholder wins over the hint, which still describes the box", async () => {
  const el = await mount(
    '<wt-number-stepper label="Max" placeholder="No limit" hint="Leave it empty for no limit"></wt-number-stepper>',
  );
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  expect(parts(el).input.getAttribute("placeholder")).toBe("No limit");
  expect(hint.textContent).toBe("Leave it empty for no limit");
  expect(parts(el).input.getAttribute("aria-describedby")).toBe(hint.id);
});

test("draws no hint line: the description is visually hidden and takes no room", async () => {
  const hinted = await mount(
    '<wt-number-stepper label="Min" hint="0 makes the list optional"></wt-number-stepper>',
  );
  const plain = await mount('<wt-number-stepper label="Min"></wt-number-stepper>');
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

test("cuts a placeholder too long for the box with an ellipsis", async () => {
  const el = await mount('<wt-number-stepper label="Min" hint="Optional"></wt-number-stepper>');
  expect(getComputedStyle(parts(el).input).textOverflow).toBe("ellipsis");
});

test("marks a required stepper visibly and on the native box", async () => {
  const el = await mount('<wt-number-stepper label="Max" required></wt-number-stepper>');
  expect(parts(el).input.required).toBe(true);
  expect(el.shadowRoot!.querySelector("[data-required]")?.textContent).toBe("*");
  const optional = await mount('<wt-number-stepper label="Max"></wt-number-stepper>');
  expect(parts(optional).input.required).toBe(false);
  expect(optional.shadowRoot!.querySelector("[data-required]")).toBeNull();
});

test("disabled locks the box and both buttons", async () => {
  const el = await mount(
    '<wt-number-stepper label="Q" value="2" min="1" max="3" disabled></wt-number-stepper>',
  );
  const seen = changes(el);
  const { input, minus, plus } = parts(el);
  expect(input.disabled).toBe(true);
  expect(minus.disabled).toBe(true);
  expect(plus.disabled).toBe(true);
  plus.click();
  expect(seen).toEqual([]);
  expect(el.hasAttribute("disabled")).toBe(true);
});

test("a disabled stepper keeps its number at full opacity and fades only the symbols", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="2" disabled></wt-number-stepper>');
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(parts(el).input).opacity).toBe("1");
  expect(getComputedStyle(parts(el).plus).opacity).toBe("1");
  expect(getComputedStyle(parts(el).plus).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(parts(el).plus.querySelector("wt-icon")!).opacity).toBe("0.3");
  expect(getComputedStyle(parts(el).plus).cursor).toBe("not-allowed");
});
test("paints its field width and its buttons' width from tokens, and the buttons draw no fill", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  host.style.setProperty("--wt-color-stepper-button", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-stepper-field-width", "165px");
  host.style.setProperty("--wt-stepper-button-width", "30px");
  for (const button of [parts(el).minus, parts(el).plus]) {
    expect(button.getBoundingClientRect().width).toBe(30);
    expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  }
  expect(getComputedStyle(parts(el).input).borderTopStyle).toBe("none");
  expect(box(el).getBoundingClientRect().width).toBe(165);
});
test("the invalid box paints its bottom line and label from the danger token", async () => {
  const el = await mount('<wt-number-stepper label="Q" error="Bad"></wt-number-stepper>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  expect(getComputedStyle(box(el)).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(parts(el).label!).color).toBe("rgb(13, 14, 15)");
});

test("a three-digit number shows whole in the narrowest box, between the buttons", async () => {
  const el = await mount(
    '<wt-number-stepper label="Q" hide-label value="999"></wt-number-stepper>',
  );
  const input = parts(el).input;
  expect(box(el).getBoundingClientRect().width).toBe(88);
  expect(input.scrollWidth).toBeLessThanOrEqual(input.clientWidth);
});

test("the number box meets the tap target, and each button WCAG's 24px minimum", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  const input = parts(el).input.getBoundingClientRect();
  expect(input.width).toBeGreaterThanOrEqual(44);
  expect(input.height).toBeGreaterThanOrEqual(44);
  for (const part of [parts(el).minus, parts(el).plus]) {
    const box = part.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});
test("− sits at the box's start and + at its end, under the label, with the number box spanning the box beneath them", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  const field = box(el).getBoundingClientRect();
  const label = parts(el).label!.getBoundingClientRect();
  const input = parts(el).input.getBoundingClientRect();
  const minus = parts(el).minus.getBoundingClientRect();
  const plus = parts(el).plus.getBoundingClientRect();
  expect(Math.abs(minus.left - field.left)).toBeLessThan(0.5);
  expect(Math.abs(plus.right - field.right)).toBeLessThan(0.5);
  expect([input.left, input.right]).toEqual([field.left, field.right]);
  for (const button of [minus, plus]) {
    expect(button.width).toBe(24);
    expect(button.top).toBeGreaterThanOrEqual(label.bottom);
    expect(button.bottom).toBe(field.bottom);
  }
});
test("the step buttons draw their icon in the primary colour with no fill or separator, and a hover tints the button's area above the bottom line", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  host.style.setProperty("--wt-color-stepper-button", "rgb(20, 30, 40)");
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  for (const button of [parts(el).minus, parts(el).plus]) {
    expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(button).color).toBe("rgb(1, 2, 3)");
    expect(getComputedStyle(button).borderLeftWidth).toBe("0px");
  }
  const button = parts(el).plus;
  await userEvent.hover(button);
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(20, 30, 40)");
  expect(getComputedStyle(button).backgroundClip).toBe("content-box");
  expect(getComputedStyle(button).paddingBottom).toBe("3px");
});
test("focusing the stepper focuses the number box", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  expect(parts(el).minus.disabled).toBe(false);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(parts(el).input);
});

test("the buttons take the height left under the floated label, down to the box's bottom", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  host.style.setProperty("--wt-space-3", "10px");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-stepper-button-width", "31px");
  const field = box(el).getBoundingClientRect();
  for (const button of [parts(el).minus, parts(el).plus]) {
    const edge = button.getBoundingClientRect();
    expect(edge.width).toBe(31);
    expect(edge.top - field.top).toBe(21);
    expect(edge.bottom).toBe(field.bottom);
  }
});
test("its baseline is the number's baseline, so a row aligned by baseline lines the text up", async () => {
  // A wt-input beside it shares the box's padding, border and font, so their text baselines line up
  // exactly when their boxes' tops do. Without baseline alignment inside the stepper, its baseline
  // is the - button's, which sits lower.
  await mount(`<div style="display: flex; align-items: baseline">
      <wt-input value="12"></wt-input>
      <wt-number-stepper label="Q" hide-label value="3"></wt-number-stepper>
    </div>`);
  const reference = host.querySelector("wt-input")!;
  await (reference as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const stepper = host.querySelector("wt-number-stepper")!;
  const referenceTop = reference.shadowRoot!.querySelector("input")!.getBoundingClientRect().top;
  const stepperTop = parts(stepper).input.getBoundingClientRect().top;
  expect(Math.abs(referenceTop - stepperTop)).toBeLessThan(0.5);
});

// ── The filled field (A178) ──

function box(el: Element): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".field")!;
}

test("an empty stepper's label floats on the top line, and the hidden copy that widens its box is drawn at the label's size", async () => {
  const el = await mount('<wt-number-stepper label="Q"></wt-number-stepper>');
  host.style.setProperty("--wt-font-size-sm", "11px");
  const { label, minus } = parts(el);
  expect(box(el).getAttribute("data-label")).toBe("float");
  expect(getComputedStyle(label!).fontSize).toBe("11px");
  expect(getComputedStyle(box(el), "::before").fontSize).toBe("11px");
  expect(label!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    minus.getBoundingClientRect().top,
  );
});
test("the number and both buttons sit in a filled field box, with its label on the top line while empty", async () => {
  const el = await mount('<wt-number-stepper label="Q"></wt-number-stepper>');
  host.style.setProperty("--wt-field-height", "70px");
  host.style.setProperty("--wt-font-size-md", "17px");
  host.style.setProperty("--wt-color-field-fill", "rgb(8, 8, 8)");
  host.style.setProperty("--wt-color-field-line", "rgb(7, 7, 7)");
  host.style.setProperty("--wt-field-line-width", "1px");
  host.style.setProperty("--wt-font-size-sm", "11px");
  const field = box(el);
  const { input, label, minus, plus } = parts(el);
  expect(field.getAttribute("part")).toBe("field");
  expect(field.getAttribute("data-label")).toBe("float");
  expect(field.contains(input)).toBe(true);
  expect(field.contains(label)).toBe(true);
  expect(field.contains(minus)).toBe(true);
  expect(field.contains(plus)).toBe(true);
  expect(field.getBoundingClientRect().height).toBe(70);
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(8, 8, 8)");
  expect(getComputedStyle(field).boxShadow).toBe("rgb(7, 7, 7) 0px -1px 0px 0px inset");
  expect(getComputedStyle(label!).fontSize).toBe("11px");
});

for (const [what, attrs] of [
  ["a value", 'value="3"'],
  ["a hint", 'hint="Optional"'],
  ["a placeholder", 'placeholder="No limit"'],
] as const) {
  test(`with ${what}, the label floats small at the top of the box`, async () => {
    const el = await mount(`<wt-number-stepper label="Q" ${attrs}></wt-number-stepper>`);
    host.style.setProperty("--wt-font-size-sm", "11px");
    expect(box(el).getAttribute("data-label")).toBe("float");
    expect(getComputedStyle(parts(el).label!).fontSize).toBe("11px");
    expect(parts(el).label!.getBoundingClientRect().top - box(el).getBoundingClientRect().top).toBe(
      8,
    );
  });
}

test("the number paints from the field-value token, centred in the box between the buttons", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  host.style.setProperty("--wt-color-field-value", "rgb(31, 32, 33)");
  host.style.setProperty("--wt-stepper-button-width", "27px");
  const style = getComputedStyle(parts(el).input);
  expect(style.color).toBe("rgb(31, 32, 33)");
  expect(style.textAlign).toBe("center");
  expect([style.paddingLeft, style.paddingRight]).toEqual(["27px", "27px"]);
  const input = parts(el).input.getBoundingClientRect();
  const field = box(el).getBoundingClientRect();
  expect([input.left, input.right]).toEqual([field.left, field.right]);
});
test("focusing the number draws the focus line and label colour, and no focus ring on the number", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  parts(el).input.focus();
  expect(getComputedStyle(box(el)).boxShadow).toBe("rgb(1, 2, 3) 0px -3px 0px 0px inset");
  expect(getComputedStyle(parts(el).label!).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(parts(el).input).outlineStyle).toBe("none");
});

test("invalid alone draws the danger line, and a valid stepper's box is unmarked", async () => {
  const el = await mount('<wt-number-stepper label="Q" invalid></wt-number-stepper>');
  const plain = await mount('<wt-number-stepper label="Q"></wt-number-stepper>');
  expect(box(el).hasAttribute("data-invalid")).toBe(true);
  expect(box(plain).hasAttribute("data-invalid")).toBe(false);
});

test("a disabled stepper's box paints its own paler fill, a dashed line and muted text", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="2" disabled></wt-number-stepper>');
  host.style.setProperty("--wt-color-field-fill-disabled", "rgb(21, 22, 23)");
  host.style.setProperty("--wt-color-text-muted", "rgb(24, 25, 26)");
  expect(box(el).hasAttribute("data-disabled")).toBe(true);
  expect(getComputedStyle(box(el)).backgroundColor).toBe("rgb(21, 22, 23)");
  expect(getComputedStyle(box(el), "::after").borderBottomStyle).toBe("dashed");
  expect(getComputedStyle(parts(el).input).color).toBe("rgb(24, 25, 26)");
});

test("hide-label makes the box compact, the same height as the buttons", async () => {
  const el = await mount('<wt-number-stepper label="Q" hide-label value="2"></wt-number-stepper>');
  host.style.setProperty("--wt-tap-min", "47px");
  expect(box(el).hasAttribute("data-compact")).toBe(true);
  expect(box(el).getBoundingClientRect().height).toBe(47);
  expect(parts(el).plus.getBoundingClientRect().height).toBe(47);
  const labelled = await mount('<wt-number-stepper label="Q"></wt-number-stepper>');
  expect(box(labelled).hasAttribute("data-compact")).toBe(false);
});

const LONG_LABEL = "Maximum number of portions in an order x";

function labelText(stepper: Element): HTMLElement {
  return stepper.shadowRoot!.querySelector<HTMLElement>(".field-label-text")!;
}

/** The test window is narrower than a resting 40-character label needs. */
async function mountInWideRow(html: string): Promise<HTMLElement> {
  const el = await mount(html);
  host.style.width = "600px";
  return el;
}

function expectWholeLabelShown(el: Element): void {
  const text = labelText(el);
  expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
  expect(parts(el).label!.getBoundingClientRect().right).toBeLessThanOrEqual(
    box(el).getBoundingClientRect().right,
  );
}

test("a stepper labelled with 40 characters widens its box past --wt-stepper-field-width to show the whole label on one line", async () => {
  const el = await mount(`<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`);
  host.style.setProperty("--wt-stepper-field-width", "77px");
  const short = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  expect(LONG_LABEL).toHaveLength(40);
  expect(box(el).getBoundingClientRect().width).toBeGreaterThan(77);
  expectWholeLabelShown(el);
  expect(labelText(el).scrollHeight).toBe(labelText(short).scrollHeight);
});

test("the number box spans the widened box, with + still at its end", async () => {
  const el = await mount(`<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`);
  host.style.setProperty("--wt-stepper-field-width", "165px");
  const field = box(el).getBoundingClientRect();
  expect(field.width).toBeGreaterThan(165);
  expect(parts(el).input.getBoundingClientRect().right).toBe(field.right);
  expect(parts(el).plus.getBoundingClientRect().right).toBe(field.right);
});

test("a label longer than the box runs above the + button, not stopping before it", async () => {
  const el = await mountInWideRow(
    `<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`,
  );
  expectWholeLabelShown(el);
  expect(labelText(el).getBoundingClientRect().right).toBeGreaterThan(
    parts(el).plus.getBoundingClientRect().left,
  );
});
test("the widened box shows the whole label, and keeps its width whether it is empty or holds a number", async () => {
  const empty = await mountInWideRow(
    `<wt-number-stepper label="${LONG_LABEL}"></wt-number-stepper>`,
  );
  expectWholeLabelShown(empty);
  const filled = await mountInWideRow(
    `<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`,
  );
  expect(box(filled).getBoundingClientRect().width).toBe(box(empty).getBoundingClientRect().width);
});
test("the label's sizing copy is visibility: hidden, which keeps it out of the accessibility tree", async () => {
  const el = await mount(`<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`);
  expect(getComputedStyle(box(el), "::before").content).toBe(`"${LONG_LABEL}"`);
  expect(getComputedStyle(box(el), "::before").visibility).toBe("hidden");
});

test("a required stepper's widened box shows the whole label and its star", async () => {
  const el = await mountInWideRow(
    `<wt-number-stepper label="${LONG_LABEL}" required></wt-number-stepper>`,
  );
  expectWholeLabelShown(el);
  const star = el.shadowRoot!.querySelector("[data-required]")!.getBoundingClientRect();
  expect(star.right).toBeLessThanOrEqual(box(el).getBoundingClientRect().right);
});

test("a short label leaves the box at --wt-stepper-field-width, however wide the row", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  host.style.setProperty("--wt-stepper-field-width", "165px");
  host.style.width = "600px";
  expect(box(el).getBoundingClientRect().width).toBe(165);
});

test("in a row too narrow for the whole label, the stepper fits the row and cuts its label with an ellipsis", async () => {
  const el = await mount(`<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`);
  host.style.setProperty("--wt-stepper-field-width", "77px");
  host.style.width = "220px";
  const row = host.getBoundingClientRect();
  expect(parts(el).plus.getBoundingClientRect().right).toBeLessThanOrEqual(row.right);
  expect(box(el).getBoundingClientRect().width).toBeGreaterThan(77);
  expect(getComputedStyle(labelText(el)).textOverflow).toBe("ellipsis");
  expect(labelText(el).scrollWidth).toBeGreaterThan(labelText(el).clientWidth);
  expect(parts(el).label!.getBoundingClientRect().right).toBeLessThanOrEqual(
    box(el).getBoundingClientRect().right,
  );
});

test("in a row narrower than the buttons and the standard box, the box stays at --wt-stepper-field-width", async () => {
  const el = await mount(`<wt-number-stepper label="${LONG_LABEL}" value="3"></wt-number-stepper>`);
  host.style.setProperty("--wt-stepper-field-width", "165px");
  host.style.width = "100px";
  expect(box(el).getBoundingClientRect().width).toBe(165);
  expect(parts(el).input.getBoundingClientRect().width).toBe(165);
});

test("a required stepper keeps its star inside the box", async () => {
  const el = await mount(
    '<wt-number-stepper label="Maximum number of portions allowed" required value="3"></wt-number-stepper>',
  );
  const star = el.shadowRoot!.querySelector("[data-required]")!.getBoundingClientRect();
  expect(star.width).toBeGreaterThan(0);
  expect(star.right).toBeLessThanOrEqual(box(el).getBoundingClientRect().right);
});

test("the label is inset --wt-space-2 from both edges of the box, spanning above both buttons", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  host.style.setProperty("--wt-space-2", "5px");
  const label = parts(el).label!.getBoundingClientRect();
  const field = box(el).getBoundingClientRect();
  expect(label.left - field.left).toBe(5);
  expect(field.right - label.right).toBe(5);
});
