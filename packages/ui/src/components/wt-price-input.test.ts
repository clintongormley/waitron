import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
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
  // See wt-input.test.ts's identical-purpose test: only a nested shadow root plus a document
  // listener makes both `bubbles` and `composed` load-bearing, so a mutant flipping either to
  // false is caught.
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
