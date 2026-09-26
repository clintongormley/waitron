import { expect, test, afterEach } from "vitest";
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

test("- on a blank value does nothing, so only clearing the box reaches blank", async () => {
  const el = await mount('<wt-number-stepper label="Max"></wt-number-stepper>');
  const seen = changes(el);
  expect(parts(el).minus.disabled).toBe(true);
  // A disabled button fires no click, so dispatch one straight at the handler's element.
  parts(el).minus.disabled = false;
  parts(el).minus.click();
  expect(seen).toEqual([]);
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

test("the button names can be translated", async () => {
  const el = await mount('<wt-number-stepper label="Máximo"></wt-number-stepper>');
  const stepper = el as HTMLElement & {
    decreaseLabel: string;
    increaseLabel: string;
    updateComplete: Promise<unknown>;
  };
  stepper.decreaseLabel = "Reducir {label}";
  stepper.increaseLabel = "Aumentar {label}";
  await stepper.updateComplete;
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Reducir Máximo");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Aumentar Máximo");
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

test("shows a hint under the box and describes the box with it, before any error", async () => {
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

test("the hint paints from the muted-text token and the error from the danger token", async () => {
  const el = await mount(
    '<wt-number-stepper label="Min" hint="Help" error="Bad"></wt-number-stepper>',
  );
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  expect(getComputedStyle(el.shadowRoot!.querySelector("[data-hint]")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(el.shadowRoot!.querySelector("[data-error]")!).color).toBe(
    "rgb(13, 14, 15)",
  );
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

test("a disabled stepper dims through the disabled-opacity token", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="2" disabled></wt-number-stepper>');
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(parts(el).input).opacity).toBe("0.3");
  expect(getComputedStyle(parts(el).plus).opacity).toBe("0.3");
});

test("paints its buttons and field width from tokens", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-stepper-field-width", "77px");
  expect(getComputedStyle(parts(el).plus).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(parts(el).minus).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(parts(el).input).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(parts(el).input).width).toBe("77px");
});

test("the invalid box paints its border from the danger token", async () => {
  const el = await mount('<wt-number-stepper label="Q" error="Bad"></wt-number-stepper>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  expect(getComputedStyle(parts(el).input).borderTopColor).toBe("rgb(13, 14, 15)");
});

test("the buttons and the box meet the tap target", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="1"></wt-number-stepper>');
  for (const part of [parts(el).minus, parts(el).plus, parts(el).input]) {
    const box = part.getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test("focusing the stepper focuses the number box, not the - button before it", async () => {
  const el = await mount('<wt-number-stepper label="Q" value="3"></wt-number-stepper>');
  expect(parts(el).minus.disabled).toBe(false);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(parts(el).input);
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
