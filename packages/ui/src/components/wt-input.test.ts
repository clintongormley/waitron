import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

test("renders its label", async () => {
  const el = await mount('<wt-input label="Peso"></wt-input>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Peso");
});

test("associates the label with the input so it has an accessible name", async () => {
  const el = await mount('<wt-input label="Peso"></wt-input>');
  const label = el.shadowRoot!.querySelector("label")!;
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.id).not.toBe("");
  expect(label.htmlFor).toBe(input.id);
});

test("gives each instance a unique id so labels never collide", async () => {
  const a = await mount('<wt-input label="Peso"></wt-input>');
  const b = await mount('<wt-input label="Precio"></wt-input>');
  const inputA = a.shadowRoot!.querySelector("input")!;
  const inputB = b.shadowRoot!.querySelector("input")!;
  expect(inputA.id).not.toBe(inputB.id);
  // Pins down the actual "wt-input-N" shape uniqueId() produces, not just that two ids differ
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
  // Regression guard for the mutation-testing survivor on `bubbles`/`composed` here: dispatched
  // straight into document's light DOM (what mount()+el.addEventListener gives every other test
  // in this file), an event only ever needs to *bubble* to reach a listener — composed never
  // comes into play, so a mutant flipping `composed: true` to `false` survives even a listener on
  // `document`. Nesting wt-input inside a wrapper's own shadow root (mountInShadowRoot) and
  // listening on `document` — genuinely outside that shadow root — makes both flags load-bearing:
  // flipping either bubbles or composed to false stops the event from arriving here.
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

test("invalid state paints from the danger token", async () => {
  const el = await mount("<wt-input invalid></wt-input>");
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(getComputedStyle(input).borderColor).toBe("rgb(13, 14, 15)");
});

test("disabled input dims via the disabled-opacity token", async () => {
  const el = await mount("<wt-input disabled></wt-input>");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(getComputedStyle(input).opacity).toBe("0.3");
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
