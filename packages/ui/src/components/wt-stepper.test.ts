import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
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

test("the portion stepper shows the selected count out of the maximum as it changes", async () => {
  const el = (await mount(
    '<wt-stepper variant="portion" label="Burger" value="1" max="3"></wt-stepper>',
  )) as Stepper;
  const { count, plus, minus, group } = parts(el);
  expect(count.textContent?.trim()).toBe("1 of 3");
  expect(group.getBoundingClientRect().height).toBe(36);
  const target = minus.getBoundingClientRect();
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  const hostBox = el.getBoundingClientRect();
  expect(target.top).toBeGreaterThanOrEqual(hostBox.top);
  expect(target.bottom).toBeLessThanOrEqual(hostBox.bottom);

  el.formatCount = (value, max) => `${value} de ${max}`;
  plus.click();
  await el.updateComplete;
  expect(count.textContent?.trim()).toBe("2 de 3");

  el.max = null;
  await el.updateComplete;
  expect(count.textContent?.trim()).toBe("2");
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

function bin(el: Element) {
  return el.shadowRoot!.querySelector<HTMLButtonElement>("button[data-remove]");
}

function removals(el: Element): number[] {
  const seen: number[] = [];
  el.addEventListener("wt-remove", (e) =>
    seen.push((e as CustomEvent<{ value: number }>).detail.value),
  );
  return seen;
}

test("with removeLabel, − becomes an enabled bin at min, named by it", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="1" min="1"></wt-stepper>')) as Stepper;
  expect(bin(el)).toBeNull();
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const button = bin(el)!;
  expect(button.disabled).toBe(false);
  expect(button.type).toBe("button");
  expect(button.getAttribute("aria-label")).toBe("Remove Burger");
  const icon = button.querySelector("wt-icon")!;
  expect(icon.getAttribute("name")).toBe("menu-delete");
  await icon.updateComplete;
  // The stepper registers the icon itself: this file imports nothing else.
  expect(icon.shadowRoot!.querySelector("path")?.getAttribute("d")).toMatch(/^M4\.67 14/);
  expect(button.querySelector("[data-mark]")).toBeNull();
  expect(el.shadowRoot!.querySelector('button[data-step="-1"]')).toBeNull();
  // In −'s place: before the count.
  const buttons = [...el.shadowRoot!.querySelectorAll('[role="group"] > *')];
  expect(buttons.indexOf(button)).toBe(0);
});

test("above min the bin is − again, and stepping down to min brings the bin", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="2" min="1"></wt-stepper>')) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  expect(bin(el)).toBeNull();
  expect(parts(el).minus.disabled).toBe(false);
  parts(el).minus.click();
  await el.updateComplete;
  expect(el.value).toBe(1);
  expect(bin(el)).not.toBeNull();
});

test("the bin sends wt-remove with the count, out of a shadow root, and steps nothing", async () => {
  const el = (await mountInShadowRoot(
    '<wt-stepper label="Burger" value="1" min="1"></wt-stepper>',
  )) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const seen = changes(el);
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  const outside: number[] = [];
  const listener = (e: Event) => {
    expect((e as CustomEvent).bubbles).toBe(true);
    expect((e as CustomEvent).composed).toBe(true);
    outside.push((e as CustomEvent<{ value: number }>).detail.value);
  };
  document.addEventListener("wt-remove", listener);
  try {
    bin(el)!.click();
  } finally {
    document.removeEventListener("wt-remove", listener);
  }
  await el.updateComplete;
  expect(outside).toEqual([1]);
  expect(seen).toEqual([]);
  expect(clicks).toBe(0);
  expect(el.value).toBe(1);
});

test("a disabled stepper's bin is disabled, and a click straight after disabling sends nothing", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="1" min="1"></wt-stepper>')) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const seen = removals(el);
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  el.disabled = true;
  bin(el)!.click();
  await el.updateComplete;
  expect(bin(el)!.disabled).toBe(true);
  bin(el)!.click();
  expect(seen).toEqual([]);
  expect(clicks).toBe(0);
});

test("removeLabel is a property only, never read from an attribute", async () => {
  const el = await mount('<wt-stepper label="Q" value="0" removelabel="Bin {label}"></wt-stepper>');
  expect(bin(el)).toBeNull();
  expect(parts(el).minus.disabled).toBe(true);
});

test("paints the bin in −'s place, size and colour from the tokens", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="1" min="1"></wt-stepper>')) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  el.style.setProperty("--wt-tap-min", "50px");
  el.style.setProperty("--wt-color-text", "rgb(7, 8, 9)");
  el.style.setProperty("--wt-font-size-lg", "21px");
  el.style.setProperty("--wt-opacity-disabled", "0.3");
  await el.updateComplete;
  const button = bin(el)!;
  const icon = button.querySelector("wt-icon")!;
  const box = button.getBoundingClientRect();
  expect([box.width, box.height]).toEqual([50, 50]);
  const drawn = icon.getBoundingClientRect();
  expect([drawn.width, drawn.height]).toEqual([21, 21]);
  expect([drawn.left + drawn.width / 2 - box.left, drawn.top + drawn.height / 2 - box.top]).toEqual(
    [25, 25],
  );
  expect(getComputedStyle(icon).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(icon).opacity).toBe("1");
  el.disabled = true;
  await el.updateComplete;
  expect(getComputedStyle(icon).opacity).toBe("0.3");
});

test("a bin click straight after the count rises past min, before the redraw, sends nothing", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="1" min="1"></wt-stepper>')) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const seen = removals(el);
  const button = bin(el)!;
  el.value = 2;
  button.click();
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(bin(el)).toBeNull();
});

test("Enter on − that brings the bin leaves focus on +, so a second Enter adds and removes nothing", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="2" min="1"></wt-stepper>')) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const seen = removals(el);
  const steps = changes(el);
  const { minus, plus } = parts(el);
  minus.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(bin(el)).not.toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(plus);
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(seen).toEqual([]);
  expect(steps).toEqual([1, 2]);
  expect(el.shadowRoot!.activeElement).toBe(plus);
});

test("Enter on + that takes away the bin keeps focus on +", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="1" min="1"></wt-stepper>')) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const { plus } = parts(el);
  plus.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(bin(el)).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(plus);
});

test("with + disabled at max, Enter on − that brings the bin moves focus to the group, which Enter does not remove from", async () => {
  const el = (await mount(
    '<wt-stepper label="Burger" value="2" min="1" max="1"></wt-stepper>',
  )) as Stepper;
  el.removeLabel = (label) => `Remove ${label}`;
  await el.updateComplete;
  const seen = removals(el);
  const { minus, plus, group } = parts(el);
  expect(plus.disabled).toBe(true);
  minus.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(bin(el)).not.toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(group);
  await userEvent.keyboard("{Enter}");
  expect(seen).toEqual([]);
  bin(el)!.focus();
  expect(group.hasAttribute("tabindex")).toBe(false);
});

test('variant="round" draws − and + as separate circles beside a large number, from the tokens', async () => {
  const el = (await mount(
    '<wt-stepper variant="round" label="Guests" value="3"></wt-stepper>',
  )) as Stepper;
  el.style.setProperty("--wt-tap-min", "50px");
  el.style.setProperty("--wt-space-1", "8px");
  el.style.setProperty("--wt-space-3", "10px");
  el.style.setProperty("--wt-space-4", "20px");
  el.style.setProperty("--wt-space-5", "30px");
  el.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
  el.style.setProperty("--wt-color-text", "rgb(7, 8, 9)");
  el.style.setProperty("--wt-color-primary", "rgb(10, 11, 12)");
  el.style.setProperty("--wt-font-size-payment-amount", "47px");
  el.style.setProperty("--wt-font-weight-bold", "700");
  el.style.setProperty("--wt-field-line-width", "1px");
  const { group, minus, plus, count } = parts(el);
  const box = getComputedStyle(group);
  expect(box.borderTopStyle).toBe("none");
  expect(box.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  for (const button of [minus, plus]) {
    const circle = getComputedStyle(button);
    const { width, height } = button.getBoundingClientRect();
    // calc(--wt-tap-min + --wt-space-3) square.
    expect([width, height]).toEqual([60, 60]);
    expect(circle.borderTopWidth).toBe("1px");
    expect(circle.borderTopStyle).toBe("solid");
    expect(circle.borderTopColor).toBe("rgb(1, 2, 3)");
    expect(circle.borderTopLeftRadius).toBe("50%");
    expect(circle.backgroundColor).toBe("rgb(4, 5, 6)");
  }
  expect(getComputedStyle(minus.querySelector("[data-mark]")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(plus.querySelector("[data-mark]")!).color).toBe("rgb(10, 11, 12)");
  const number = getComputedStyle(count);
  // At least calc(--wt-tap-min + --wt-space-5) wide.
  expect(count.getBoundingClientRect().width).toBeGreaterThanOrEqual(80);
  expect(number.fontSize).toBe("47px");
  expect(number.fontWeight).toBe("700");
  expect(number.fontVariantNumeric).toBe("tabular-nums");
  // Apart, with calc(--wt-space-4 + --wt-space-1 / 2) between each circle and the number.
  expect(count.getBoundingClientRect().left - minus.getBoundingClientRect().right).toBe(24);
  expect(plus.getBoundingClientRect().left - count.getBoundingClientRect().right).toBe(24);
});

test('variant="round" steps as the default one does', async () => {
  const el = (await mount(
    '<wt-stepper variant="round" label="Guests" value="2" min="1"></wt-stepper>',
  )) as Stepper;
  const seen = changes(el);
  parts(el).minus.click();
  await el.updateComplete;
  expect(parts(el).minus.disabled).toBe(true);
  parts(el).plus.click();
  expect(seen).toEqual([1, 2]);
});

test("variant reflects to its attribute", async () => {
  const el = (await mount('<wt-stepper label="Guests" value="2"></wt-stepper>')) as Stepper;
  el.variant = "round";
  await el.updateComplete;
  expect(el.getAttribute("variant")).toBe("round");
});

test("the default variant keeps its one box", async () => {
  const el = (await mount('<wt-stepper label="Burger" value="2"></wt-stepper>')) as Stepper;
  expect(el.variant).toBe("box");
  const { minus } = parts(el);
  expect(getComputedStyle(minus).borderTopStyle).toBe("none");
  expect(getComputedStyle(parts(el).group).borderTopStyle).toBe("solid");
});
