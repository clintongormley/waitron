import { LitElement } from "lit";
import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-input.js";

afterEach(cleanup);

test("renders its label", async () => {
  const el = await mount('<wt-input label="Weight"></wt-input>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Weight");
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

test("places field help beside the label without nesting its button inside the label", async () => {
  const el = await mount('<wt-input label="Email"><button slot="help">?</button></wt-input>');
  const label = el.shadowRoot!.querySelector("label")!;
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="help"]')!;
  expect(label.contains(slot)).toBe(false);
  expect(slot.assignedElements()[0]?.textContent).toBe("?");
});

test("places an end action inside the field and only reserves space while it exists", async () => {
  const el = await mount('<wt-input label="Password"><button slot="end">Show</button></wt-input>');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await (el as LitElement).updateComplete;

  const control = el.shadowRoot!.querySelector<HTMLElement>(".control")!;
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
