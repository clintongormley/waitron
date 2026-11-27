import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-stepper.js";

afterEach(cleanup);

type Stepper = HTMLElementTagNameMap["wt-stepper"];

function parts(el: Element) {
  const root = el.shadowRoot!;
  return {
    group: root.querySelector<HTMLElement>('[role="group"]')!,
    minus: root.querySelector<HTMLButtonElement>('button[data-step="-1"]')!,
    plus: root.querySelector<HTMLButtonElement>('button[data-step="1"]')!,
    count: root.querySelector<HTMLElement>("[aria-live]")!,
  };
}

function changes(el: Element): number[] {
  const seen: number[] = [];
  el.addEventListener("wt-change", (e) =>
    seen.push((e as CustomEvent<{ value: number }>).detail.value),
  );
  return seen;
}

test("+ and − step the count, show it and emit it as a number", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="2"></wt-stepper>')) as Stepper;
  const seen = changes(el);
  parts(el).plus.click();
  await el.updateComplete;
  expect(parts(el).count.textContent?.trim()).toBe("3");
  parts(el).minus.click();
  parts(el).minus.click();
  await el.updateComplete;
  expect(seen).toEqual([3, 2, 1]);
  expect(el.value).toBe(1);
  expect(parts(el).count.textContent?.trim()).toBe("1");
});

test("wt-change bubbles out of a shadow root", async () => {
  const el = await mountInShadowRoot('<wt-stepper label="Burger" value="1"></wt-stepper>');
  const seen: number[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent<{ value: number }>).detail.value);
  document.addEventListener("wt-change", listener);
  try {
    parts(el).plus.click();
  } finally {
    document.removeEventListener("wt-change", listener);
  }
  expect(seen).toEqual([2]);
});

test("− is disabled at min and + at max, and neither steps past them", async () => {
  const el = (await mount(
    '<wt-stepper label="Burger" value="1" min="1" max="1"></wt-stepper>',
  )) as Stepper;
  const seen = changes(el);
  expect(parts(el).minus.disabled).toBe(true);
  expect(parts(el).plus.disabled).toBe(true);
  el.value = 2;
  el.max = 3;
  await el.updateComplete;
  expect(parts(el).minus.disabled).toBe(false);
  expect(parts(el).plus.disabled).toBe(false);
  expect(seen).toEqual([]);
});

test("min defaults to 0 and max to none", async () => {
  const el = (await mount('<wt-stepper label="Burger"></wt-stepper>')) as Stepper;
  expect(el.value).toBe(0);
  expect(parts(el).minus.disabled).toBe(true);
  expect(parts(el).plus.disabled).toBe(false);
  el.value = 999;
  await el.updateComplete;
  expect(parts(el).plus.disabled).toBe(false);
});

test("disabled locks both buttons", async () => {
  const el = (await mount(
    '<wt-stepper label="Burger" value="2" disabled></wt-stepper>',
  )) as Stepper;
  expect(parts(el).minus.disabled).toBe(true);
  expect(parts(el).plus.disabled).toBe(true);
});

test("the inner click does not reach the host's listeners", async () => {
  const el = await mount('<wt-stepper label="Burger" value="2"></wt-stepper>');
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  host.addEventListener("click", () => clicks++);
  parts(el).plus.click();
  parts(el).minus.click();
  expect(clicks).toBe(0);
});

test("the buttons are named by decreaseLabel and increaseLabel, given label", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="2"></wt-stepper>')) as Stepper;
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Decrease Burger");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Increase Burger");
  el.decreaseLabel = (label) => `One fewer ${label}`;
  el.increaseLabel = (label) => `One more ${label}`;
  await el.updateComplete;
  expect(parts(el).minus.getAttribute("aria-label")).toBe("One fewer Burger");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("One more Burger");
  expect(parts(el).group.getAttribute("aria-label")).toBe("Burger");
  expect(parts(el).count.getAttribute("aria-live")).toBe("polite");
});

test("the button names are properties only, never read from an attribute", async () => {
  const el = await mount(
    '<wt-stepper label="Q" decreaselabel="Fewer {label}" increaselabel="More {label}"></wt-stepper>',
  );
  expect(parts(el).minus.getAttribute("aria-label")).toBe("Decrease Q");
  expect(parts(el).plus.getAttribute("aria-label")).toBe("Increase Q");
});

test("the buttons are plain buttons, not submit buttons", async () => {
  const el = await mount('<wt-stepper label="Q"></wt-stepper>');
  expect(parts(el).minus.type).toBe("button");
  expect(parts(el).plus.type).toBe("button");
});

test("two clicks in one turn never step past min or max", async () => {
  const low = (await mount(
    '<wt-stepper label="Burger" value="2" min="1"></wt-stepper>',
  )) as Stepper;
  const lowSeen = changes(low);
  parts(low).minus.click();
  parts(low).minus.click();
  await low.updateComplete;
  expect(lowSeen).toEqual([1]);
  expect(low.value).toBe(1);
  const high = (await mount(
    '<wt-stepper label="Burger" value="4" max="5"></wt-stepper>',
  )) as Stepper;
  const highSeen = changes(high);
  parts(high).plus.click();
  parts(high).plus.click();
  await high.updateComplete;
  expect(highSeen).toEqual([5]);
  expect(high.value).toBe(5);
});

test("a click straight after disabling, before the redraw, emits nothing", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="2"></wt-stepper>')) as Stepper;
  const seen = changes(el);
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  el.disabled = true;
  parts(el).plus.click();
  parts(el).minus.click();
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(el.value).toBe(2);
  expect(clicks).toBe(0);
});

test("paints its box, buttons and number from the tokens", async () => {
  const el = await mount('<wt-stepper label="Burger" value="2"></wt-stepper>');
  el.style.setProperty("--wt-tap-min", "50px");
  el.style.setProperty("--wt-radius-md", "7px");
  el.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
  el.style.setProperty("--wt-color-text", "rgb(7, 8, 9)");
  el.style.setProperty("--wt-color-primary", "rgb(10, 11, 12)");
  el.style.setProperty("--wt-space-6", "61px");
  el.style.setProperty("--wt-font-size-lg", "21px");
  el.style.setProperty("--wt-space-1", "8px");
  const { group, minus, plus, count } = parts(el);
  const box = getComputedStyle(group);
  expect(group.getBoundingClientRect().height).toBe(50);
  expect(box.borderTopWidth).toBe("1px");
  expect(box.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(box.borderTopLeftRadius).toBe("7px");
  expect(box.backgroundColor).toBe("rgb(4, 5, 6)");
  expect(minus.getBoundingClientRect().width).toBe(50);
  expect(plus.getBoundingClientRect().width).toBe(50);
  expect(minus.getBoundingClientRect().height).toBe(50);
  expect(getComputedStyle(minus.querySelector("[data-mark]")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(plus.querySelector("[data-mark]")!).color).toBe("rgb(10, 11, 12)");
  // Each bar is 2.5 spaces long and 0.625 of a space thick (10 by 2.5 at the usual 4px space),
  // centred in its button and painted in the button's colour.
  const bars = (button: HTMLElement) =>
    [...button.querySelectorAll("[data-mark] rect")].map((bar) => {
      const { width, height, left, top } = bar.getBoundingClientRect();
      const { left: x, top: y } = button.getBoundingClientRect();
      return {
        size: [width, height],
        centre: [left + width / 2 - x, top + height / 2 - y],
        fill: getComputedStyle(bar).fill,
      };
    });
  expect(bars(minus)).toEqual([{ size: [20, 5], centre: [25, 25], fill: "rgb(7, 8, 9)" }]);
  expect(bars(plus)).toEqual([
    { size: [20, 5], centre: [25, 25], fill: "rgb(10, 11, 12)" },
    { size: [5, 20], centre: [25, 25], fill: "rgb(10, 11, 12)" },
  ]);
  const number = getComputedStyle(count);
  expect(count.getBoundingClientRect().width).toBeGreaterThanOrEqual(61);
  expect(number.fontSize).toBe("21px");
  expect(number.fontWeight).toBe("600");
  expect(number.fontVariantNumeric).toBe("tabular-nums");
});

test("a disabled button fades its mark", async () => {
  const el = await mount('<wt-stepper label="Burger" value="0"></wt-stepper>');
  el.style.setProperty("--wt-opacity-disabled", "0.3");
  const { minus, plus } = parts(el);
  expect(getComputedStyle(minus.querySelector("[data-mark]")!).opacity).toBe("0.3");
  expect(getComputedStyle(plus.querySelector("[data-mark]")!).opacity).toBe("1");
});
