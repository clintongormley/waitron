import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import type { WtSlider } from "./wt-slider.js";
import "./wt-slider.js";

afterEach(cleanup);

const inputOf = (el: Element) => el.shadowRoot!.querySelector<HTMLInputElement>("input")!;
const shownOf = (el: Element) => el.shadowRoot!.querySelector('[part="value"]')!.textContent;

async function mountSlider(attributes = ""): Promise<WtSlider> {
  return (await mount(
    `<wt-slider label="Columns" min="2" max="10" value="6" ${attributes}></wt-slider>`,
  )) as WtSlider;
}

/** Every event the host hears, by type, in order. */
function hostHears(el: Element): Event[] {
  const heard: Event[] = [];
  for (const type of ["input", "change", "wt-change"]) {
    el.addEventListener(type, (event) => heard.push(event));
  }
  return heard;
}

test("forwards its name, range and value to the native range input", async () => {
  const el = await mountSlider('name="columns" step="2"');
  const input = inputOf(el);
  expect(input.type).toBe("range");
  expect(input.name).toBe("columns");
  expect([input.min, input.max, input.step, input.value]).toEqual(["2", "10", "2", "6"]);

  el.max = 8;
  el.value = 4;
  await el.updateComplete;
  expect([input.max, input.value]).toEqual(["8", "4"]);
});

test("a slider given no name leaves its native input unnamed", async () => {
  const el = await mountSlider();
  expect(inputOf(el).hasAttribute("name")).toBe(false);
});

test("defaults to an unlabelled whole-number range from 0 to 10", async () => {
  const el = (await mount("<wt-slider></wt-slider>")) as WtSlider;
  expect(el.shadowRoot!.querySelector("label")!.textContent).toBe("");
  const input = inputOf(el);
  expect([input.min, input.max, input.step, input.value]).toEqual(["0", "10", "1", "0"]);
  expect(shownOf(el)).toBe("0");
});

test("shows its label, tied to the input, and its current value", async () => {
  const el = await mountSlider();
  const label = el.shadowRoot!.querySelector("label")!;
  expect(label.textContent).toBe("Columns");
  expect(label.htmlFor).toBe(inputOf(el).id);
  expect(inputOf(el).labels?.[0]).toBe(label);
  expect(shownOf(el)).toBe("6");
});

test("gives each instance its own input id", async () => {
  const a = await mountSlider();
  const b = await mountSlider();
  expect(inputOf(a).id).toMatch(/^wt-slider-\d+$/);
  expect(inputOf(a).id).not.toBe(inputOf(b).id);
});

test("the host sees one event per interaction", async () => {
  const el = await mountSlider();
  const heard = hostHears(el);
  const input = inputOf(el);

  input.value = "8";
  // Composed on purpose, as a real drag's `input` is: unstopped, it would reach the host.
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(shownOf(el)).toBe("8");
  expect(heard).toEqual([]);
  expect(el.value).toBe(6);

  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(heard.map((event) => event.type)).toEqual(["wt-change"]);
  const change = heard[0] as CustomEvent<{ value: number }>;
  expect(change.detail).toEqual({ value: 8 });
  expect(change.bubbles).toBe(true);
  expect(change.composed).toBe(true);
  expect(el.value).toBe(8);
  expect(shownOf(el)).toBe("8");
});

test("wt-change crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = await mountInShadowRoot('<wt-slider label="Columns" value="3"></wt-slider>');
  let received: CustomEvent<{ value: number }> | undefined;
  const listener = (event: Event) => (received = event as CustomEvent<{ value: number }>);
  document.addEventListener("wt-change", listener);
  try {
    const input = inputOf(el);
    input.value = "5";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(received?.detail).toEqual({ value: 5 });
  } finally {
    document.removeEventListener("wt-change", listener);
  }
});

test("after a release the shown number follows the value property again", async () => {
  const el = await mountSlider();
  const input = inputOf(el);
  input.value = "9";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;

  el.value = 3;
  await el.updateComplete;
  expect(shownOf(el)).toBe("3");
  expect(input.value).toBe("3");
});

test("a drag that ends without a change still lets a new value redraw the number", async () => {
  const el = await mountSlider();
  const input = inputOf(el);
  // Chromium sends no `change` when a drag ends where it began, so only `input` arrives.
  for (const step of ["8", "6"]) {
    input.value = step;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  await el.updateComplete;

  el.value = 3;
  await el.updateComplete;
  expect(input.value).toBe("3");
  expect(shownOf(el)).toBe("3");
});

test("a page that sets the value straight back on wt-change puts the range back too", async () => {
  const el = await mountSlider();
  const input = inputOf(el);
  el.addEventListener("wt-change", () => (el.value = 6));

  input.value = "8";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;

  expect(el.value).toBe(6);
  expect(shownOf(el)).toBe("6");
  expect(input.value).toBe("6");
});

test("a keyboard step moves the value by one step and sends exactly one wt-change", async () => {
  const el = await mountSlider();
  const heard = hostHears(el);

  el.focus();
  await userEvent.keyboard("{ArrowRight}");
  await el.updateComplete;

  expect(heard.map((event) => event.type)).toEqual(["wt-change"]);
  expect((heard[0] as CustomEvent<{ value: number }>).detail).toEqual({ value: 7 });
  expect(shownOf(el)).toBe("7");
});

test("a real click on the track sends exactly one wt-change with a number", async () => {
  const el = await mountSlider();
  const heard = hostHears(el);
  const input = inputOf(el);
  const box = input.getBoundingClientRect();
  const hostBox = el.getBoundingClientRect();

  await userEvent.click(el, {
    position: { x: box.right - 2 - hostBox.left, y: box.top + box.height / 2 - hostBox.top },
  });
  await el.updateComplete;

  expect(heard.map((event) => event.type)).toEqual(["wt-change"]);
  const { value } = (heard[0] as CustomEvent<{ value: number }>).detail;
  expect(typeof value).toBe("number");
  expect(value).toBe(10);
  expect(shownOf(el)).toBe("10");
});

test("a disabled slider disables its input and sends nothing when clicked", async () => {
  const el = await mountSlider("disabled");
  const heard = hostHears(el);
  const input = inputOf(el);
  expect(input.disabled).toBe(true);
  expect(el.hasAttribute("disabled")).toBe(true);

  const box = input.getBoundingClientRect();
  const hostBox = el.getBoundingClientRect();
  await userEvent.click(el, {
    position: { x: box.right - 2 - hostBox.left, y: box.top + box.height / 2 - hostBox.top },
    force: true,
  });
  await el.updateComplete;

  expect(heard.filter((event) => event.type === "wt-change")).toEqual([]);
  expect(shownOf(el)).toBe("6");
  expect(el.value).toBe(6);
});

test("disabled is reflected, so a page can style a disabled slider", async () => {
  const el = await mountSlider();
  el.disabled = true;
  await el.updateComplete;
  expect(el.hasAttribute("disabled")).toBe(true);
  expect(inputOf(el).disabled).toBe(true);
});

test("a disabled slider dims through the disabled-opacity token", async () => {
  const el = await mountSlider("disabled");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(el).opacity).toBe("0.3");
});

test("shows an error under the control as an alert that describes the input", async () => {
  const el = await mountSlider('error="Pick at least 2"');
  const input = inputOf(el);
  const alert = el.shadowRoot!.querySelector('[role="alert"]')!;
  expect(alert.textContent).toBe("Pick at least 2");
  expect(el.shadowRoot!.querySelector("[data-error]")).toBe(alert);
  expect(alert.id).not.toBe("");
  expect(input.getAttribute("aria-describedby")).toBe(alert.id);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(alert.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    input.getBoundingClientRect().bottom,
  );
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");
  expect(getComputedStyle(alert).color).toBe("rgb(1, 2, 3)");
});

test("without an error there is no alert and the input is neither invalid nor described", async () => {
  const el = await mountSlider();
  const input = inputOf(el);
  expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
  expect(input.hasAttribute("aria-describedby")).toBe(false);
  expect(input.hasAttribute("aria-invalid")).toBe(false);
});

test("draws its value through format, while dragging too", async () => {
  const el = await mountSlider();
  el.format = (n) => `${n}%`;
  await el.updateComplete;
  expect(shownOf(el)).toBe("6%");
  const input = inputOf(el);
  input.value = "8";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(shownOf(el)).toBe("8%");
  expect(input.value).toBe("8");
});

test("says its value through valueText", async () => {
  const el = await mountSlider();
  const input = inputOf(el);
  expect(input.hasAttribute("aria-valuetext")).toBe(false);
  el.valueText = (n) => `${n} percent`;
  await el.updateComplete;
  expect(input.getAttribute("aria-valuetext")).toBe("6 percent");
  input.value = "8";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(input.getAttribute("aria-valuetext")).toBe("8 percent");
  el.valueText = null;
  await el.updateComplete;
  expect(input.hasAttribute("aria-valuetext")).toBe(false);
});

test("shows a hint under the range, describing it", async () => {
  const el = await mountSlider('hint="Bigger wraps more"');
  const input = inputOf(el);
  const hint = el.shadowRoot!.querySelector<HTMLElement>('[part="hint"]')!;
  expect(hint.textContent).toBe("Bigger wraps more");
  expect(hint.id).not.toBe("");
  expect(hint.hasAttribute("role")).toBe(false);
  expect(hint.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    input.getBoundingClientRect().bottom,
  );
  expect(input.getAttribute("aria-describedby")).toBe(hint.id);
  expect(input.hasAttribute("aria-invalid")).toBe(false);

  el.error = "Pick at least 2";
  await el.updateComplete;
  const alert = el.shadowRoot!.querySelector('[role="alert"]')!;
  expect(input.getAttribute("aria-describedby")).toBe(`${hint.id} ${alert.id}`);
  expect(alert.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    hint.getBoundingClientRect().bottom,
  );
});

test("the hint paints from the muted text and small size tokens", async () => {
  const el = await mountSlider('hint="Bigger wraps more"');
  const hint = el.shadowRoot!.querySelector('[part="hint"]')!;
  host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-font-size-sm", "11px");
  expect(getComputedStyle(hint).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(hint).fontSize).toBe("11px");
  expect(getComputedStyle(hint).marginTop).toBe("0px");
});

test("the label paints from the muted text and small size tokens, as the other fields' labels do", async () => {
  const el = await mountSlider();
  const label = el.shadowRoot!.querySelector('[part="label"]')!;
  expect(getComputedStyle(label).fontSize).toBe("12px");
  host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-font-size-sm", "11px");
  expect(getComputedStyle(label).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(label).fontSize).toBe("11px");
});

test("without a hint or a format it draws as before", async () => {
  const el = await mountSlider();
  expect(el.shadowRoot!.querySelector('[part="hint"]')).toBeNull();
  expect(inputOf(el).hasAttribute("aria-describedby")).toBe(false);
  expect(shownOf(el)).toBe("6");
  expect([el.format(6), el.valueText, el.hint]).toEqual(["6", null, ""]);
});

test("the range paints from the primary token", async () => {
  const el = await mountSlider();
  host.style.setProperty("--wt-color-primary", "rgb(16, 17, 18)");
  expect(getComputedStyle(inputOf(el)).accentColor).toBe("rgb(16, 17, 18)");
});

test("the field max-width token bounds the slider's width", async () => {
  const el = await mountSlider();
  host.style.width = "600px";
  host.style.setProperty("--wt-field-max-width", "150px");
  expect(el.getBoundingClientRect().width).toBe(150);
  host.style.setProperty("--wt-field-max-width", "300px");
  expect(el.getBoundingClientRect().width).toBe(300);
});

test("the input is at least the tap target tall and wide", async () => {
  const el = await mountSlider();
  const tap = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
  expect(tap).toBeGreaterThan(0);
  const box = inputOf(el).getBoundingClientRect();
  expect(box.height).toBeGreaterThanOrEqual(tap);
  expect(box.width).toBeGreaterThanOrEqual(tap);
});

test("focusing the host focuses the input", async () => {
  const el = await mountSlider();
  const input = inputOf(el);
  expect(input).toBeInstanceOf(HTMLInputElement);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(input);
});

test("continuous input changes the public value before release and emits no matching release", async () => {
  const el = await mountSlider("continuous");
  const heard = hostHears(el);
  const input = inputOf(el);
  for (const value of [7, 8, 9]) {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.value).toBe(value);
    expect(shownOf(el)).toBe(String(value));
  }
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  expect(heard.map((event) => event.type)).toEqual(["wt-change", "wt-change", "wt-change"]);
  expect(heard.map((event) => (event as CustomEvent<{ value: number }>).detail)).toEqual([
    { value: 7 },
    { value: 8 },
    { value: 9 },
  ]);
  expect(heard.every((event) => event.bubbles && event.composed)).toBe(true);
});

test("continuous keyboard steps each send one integer value including the limits", async () => {
  const el = await mountSlider("continuous");
  const heard = hostHears(el);
  el.focus();
  await userEvent.keyboard("{ArrowRight}{End}{ArrowRight}{Home}{ArrowLeft}");
  await el.updateComplete;
  expect(heard.map((event) => event.type)).toEqual(["wt-change", "wt-change", "wt-change"]);
  expect(heard.map((event) => (event as CustomEvent<{ value: number }>).detail)).toEqual([
    { value: 7 },
    { value: 10 },
    { value: 2 },
  ]);
  expect([el.value, shownOf(el), inputOf(el).value]).toEqual([2, "2", "2"]);
});

test("continuous track clicks send one event", async () => {
  const el = await mountSlider("continuous");
  const heard = hostHears(el);
  const box = inputOf(el).getBoundingClientRect();
  const hostBox = el.getBoundingClientRect();
  await userEvent.click(el, {
    position: { x: box.right - 2 - hostBox.left, y: box.top + box.height / 2 - hostBox.top },
  });
  await el.updateComplete;
  expect(heard.map((event) => event.type)).toEqual(["wt-change"]);
  expect((heard[0] as CustomEvent<{ value: number }>).detail).toEqual({ value: 10 });
  expect(el.value).toBe(10);
});

test("continuous mode accepts a change without an input and clears its prior release marker", async () => {
  const el = await mountSlider("continuous");
  const heard = hostHears(el);
  const input = inputOf(el);
  input.value = "8";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  el.value = 6;
  await el.updateComplete;
  input.value = "8";
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(heard.map((event) => event.type)).toEqual(["wt-change", "wt-change"]);
  expect(heard.map((event) => (event as CustomEvent<{ value: number }>).detail)).toEqual([
    { value: 8 },
    { value: 8 },
  ]);
  expect(el.value).toBe(8);
});

test("continuous input still lets its consumer replace a value synchronously", async () => {
  const el = await mountSlider("continuous");
  el.addEventListener("wt-change", () => (el.value = 6));
  const input = inputOf(el);
  input.value = "8";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect([el.value, shownOf(el), input.value]).toEqual([6, "6", "6"]);
});

test("turning continuous mode off restores release-only changes", async () => {
  const el = await mountSlider("continuous");
  const heard = hostHears(el);
  el.continuous = false;
  await el.updateComplete;
  const input = inputOf(el);
  input.value = "8";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.value).toBe(6);
  expect(heard).toEqual([]);
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  expect(heard.map((event) => event.type)).toEqual(["wt-change"]);
});

test("disabled continuous sliders refuse keyboard and track changes", async () => {
  const el = await mountSlider("continuous disabled");
  const heard = hostHears(el);
  const input = inputOf(el);
  expect(input.disabled).toBe(true);
  expect(el.shadowRoot!.querySelector(".row")!.getAttribute("aria-disabled")).toBe("true");
  el.focus();
  await userEvent.keyboard("{ArrowRight}");
  const box = input.getBoundingClientRect();
  const hostBox = el.getBoundingClientRect();
  await userEvent.click(el, {
    position: { x: box.right - 2 - hostBox.left, y: box.top + box.height / 2 - hostBox.top },
    force: true,
  });
  await el.updateComplete;
  expect(heard.filter((event) => event.type === "wt-change")).toEqual([]);
  expect([el.value, shownOf(el), input.value]).toEqual([6, "6", "6"]);
});

describe.each(["light", "dark"] as const)("continuous slider tokens (%s)", (theme) => {
  test("keeps its accent and focus styles during input", async () => {
    const el = await mountSlider("continuous");
    host.setAttribute("data-theme", theme);
    host.style.setProperty("--wt-color-primary", "rgb(16, 17, 18)");
    const input = inputOf(el);
    el.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(getComputedStyle(input).accentColor).toBe("rgb(16, 17, 18)");
    expect(getComputedStyle(input).outlineStyle).toBe("solid");
    expect(parseFloat(getComputedStyle(input).outlineWidth)).toBeGreaterThan(0);
    expect(el.shadowRoot!.activeElement).toBe(input);
  });
});

describe("step marks", () => {
  const marksOf = (el: Element) => [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>('[part="mark"]'),
  ];
  const partOf = (el: Element, part: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[part="${part}"]`)!;

  async function mountMarked(): Promise<WtSlider> {
    const el = (await mount(
      '<wt-slider label="Text size" min="100" max="130" step="5" value="110" marks></wt-slider>',
    )) as WtSlider;
    host.style.width = "300px";
    host.style.setProperty("--wt-field-max-width", "300px");
    await document.fonts.ready;
    return el;
  }

  test("marks one tick per step under the range", async () => {
    const el = await mountMarked();
    const marks = marksOf(el);
    expect(marks).toHaveLength(7);
    const inputBottom = inputOf(el).getBoundingClientRect().bottom;
    for (const mark of marks) {
      expect(mark.getBoundingClientRect().top).toBeGreaterThanOrEqual(inputBottom);
      expect(mark.getBoundingClientRect().height).toBeGreaterThan(0);
    }
    expect(partOf(el, "marks").getAttribute("aria-hidden")).toBe("true");
  });

  test("counts whole steps only, from min", async () => {
    const el = (await mount(
      '<wt-slider label="Columns" min="2" max="9" step="3" value="5" marks></wt-slider>',
    )) as WtSlider;
    expect(marksOf(el)).toHaveLength(3);
    el.max = 11;
    await el.updateComplete;
    expect(marksOf(el)).toHaveLength(4);
  });

  test("puts each mark under the thumb's centre for its value", async () => {
    const el = await mountMarked();
    const r = inputOf(el).getBoundingClientRect();
    expect(marksOf(el)).toHaveLength(7);
    marksOf(el).forEach((mark, i) => {
      const box = mark.getBoundingClientRect();
      const centre = box.left + box.width / 2;
      expect(Math.abs(centre - (r.left + 8 + (i * (r.width - 16)) / 6))).toBeLessThanOrEqual(0.1);
    });
  });

  test("the marks' inset follows the thumb-size token, not the spacing scale", async () => {
    const el = await mountMarked();
    const centres = () =>
      marksOf(el).map((mark) => {
        const box = mark.getBoundingClientRect();
        return box.left + box.width / 2;
      });
    const r = inputOf(el).getBoundingClientRect();

    host.style.setProperty("--wt-space-4", "40px");
    const [first] = centres();
    expect(Math.abs(first! - (r.left + 8))).toBeLessThanOrEqual(0.1);
    expect(Math.abs(centres().at(-1)! - (r.right - 8))).toBeLessThanOrEqual(0.1);

    host.style.setProperty("--wt-slider-thumb-size", "40px");
    expect(Math.abs(centres()[0]! - (r.left + 20))).toBeLessThanOrEqual(0.1);
    expect(Math.abs(centres().at(-1)! - (r.right - 20))).toBeLessThanOrEqual(0.1);
  });

  test("on a range a step does not divide, each mark sits under its value and none at max", async () => {
    const el = (await mount(
      '<wt-slider label="Columns" min="2" max="9" step="3" value="5" marks></wt-slider>',
    )) as WtSlider;
    host.style.width = "300px";
    host.style.setProperty("--wt-field-max-width", "300px");
    await document.fonts.ready;
    const r = inputOf(el).getBoundingClientRect();
    const centres = marksOf(el).map((mark) => {
      const box = mark.getBoundingClientRect();
      return box.left + box.width / 2;
    });
    expect(centres).toHaveLength(3);
    centres.forEach((centre, i) => {
      expect(Math.abs(centre - (r.left + 8 + ((i * 3) / 7) * (r.width - 16)))).toBeLessThanOrEqual(
        0.1,
      );
    });
  });

  test.each([
    ["a step of 0", 'min="100" max="130" step="0"'],
    ["a negative step", 'min="100" max="130" step="-5"'],
    ["max below min", 'min="130" max="100" step="5"'],
    ["max equal to min", 'min="100" max="100" step="5"'],
    ["more than 101 steps", 'min="0" max="1010" step="10"'],
  ])("with %s it draws its label and range but no marks", async (_, range) => {
    const el = (await mount(
      `<wt-slider label="Text size" ${range} value="100" marks></wt-slider>`,
    )) as WtSlider;
    expect(partOf(el, "label").textContent).toBe("Text size");
    expect(inputOf(el).type).toBe("range");
    expect(marksOf(el)).toHaveLength(0);
  });

  test("draws up to 101 marks", async () => {
    const el = (await mount(
      '<wt-slider label="Percent" min="0" max="1000" step="10" value="0" marks></wt-slider>',
    )) as WtSlider;
    expect(marksOf(el)).toHaveLength(101);
  });

  test("draws the value at the end of the range's row", async () => {
    const el = await mountMarked();
    const r = inputOf(el).getBoundingClientRect();
    const value = partOf(el, "value").getBoundingClientRect();
    const label = partOf(el, "label").getBoundingClientRect();
    expect(value.left).toBeGreaterThanOrEqual(r.right);
    const middle = value.top + value.height / 2;
    expect(middle).toBeGreaterThanOrEqual(r.top);
    expect(middle).toBeLessThanOrEqual(r.bottom);
    expect(value.top).toBeGreaterThanOrEqual(label.bottom);
    expect(partOf(el, "value").textContent).toBe("110");
  });

  test("marks paint from the muted text token, a line wide and a small space tall", async () => {
    const el = await mountMarked();
    host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-field-line-width", "3px");
    host.style.setProperty("--wt-space-2", "7px");
    const mark = marksOf(el)[0]!;
    expect(getComputedStyle(mark).backgroundColor).toBe("rgb(1, 2, 3)");
    expect(mark.getBoundingClientRect().width).toBe(3);
    expect(mark.getBoundingClientRect().height).toBe(7);
  });

  test("a disabled marked slider disables its range and marks its label row", async () => {
    const el = (await mount(
      '<wt-slider label="Text size" min="100" max="130" step="5" value="110" marks disabled></wt-slider>',
    )) as WtSlider;
    expect(inputOf(el).disabled).toBe(true);
    expect(el.shadowRoot!.querySelector(".row")!.getAttribute("aria-disabled")).toBe("true");
    el.disabled = false;
    await el.updateComplete;
    expect(inputOf(el).disabled).toBe(false);
    expect(el.shadowRoot!.querySelector(".row")!.hasAttribute("aria-disabled")).toBe(false);
  });

  test("without marks the value stays on the label row", async () => {
    const el = await mountSlider();
    await document.fonts.ready;
    expect(el.shadowRoot!.querySelector('[part="marks"]')).toBeNull();
    expect(marksOf(el)).toHaveLength(0);
    const label = partOf(el, "label").getBoundingClientRect();
    const value = partOf(el, "value").getBoundingClientRect();
    expect([value.top < label.bottom, label.top < value.bottom]).toEqual([true, true]);
  });
});
