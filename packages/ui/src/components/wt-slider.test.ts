import { afterEach, expect, test } from "vitest";
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
