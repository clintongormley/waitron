import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

test("renders slotted content", async () => {
  const el = await mount("<wt-button>Cobrar</wt-button>");
  expect(el.textContent?.trim()).toBe("Cobrar");
});

test("defaults to the secondary variant", async () => {
  const el = await mount("<wt-button>x</wt-button>");
  expect(el.getAttribute("variant")).toBe("secondary");
});

test("meets the minimum tap target at default size on both axes", async () => {
  // A POS numpad ("1", "+", "−") is exactly the failing case: a single narrow glyph produces a
  // button whose height clears --wt-tap-min but whose width does not.
  const el = await mount("<wt-button>1</wt-button>");
  const rect = el.getBoundingClientRect();
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.width).toBeGreaterThanOrEqual(44);
});

test("does not emit click when disabled", async () => {
  const el = await mount("<wt-button disabled>x</wt-button>");
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();
  expect(clicks).toBe(0);
});

test("disabled button dims via the disabled-opacity token", async () => {
  const el = await mount("<wt-button disabled>x</wt-button>");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  const inner = el.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(inner).opacity).toBe("0.3");
});

test("emits click when enabled", async () => {
  const el = await mount("<wt-button>x</wt-button>");
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();
  expect(clicks).toBe(1);
});

test("does not forward a host type attribute to the inner button (no submit-type support)", async () => {
  // Full form association via ElementInternals is out of scope. A shadow-DOM <button
  // type="submit"> is not form-associated and never fires a real submit — keeping a `type`
  // property around would document behaviour that does not work. The inner button must always
  // render type="button" regardless of what a caller sets on the host.
  const el = await mount('<wt-button type="submit">x</wt-button>');
  const inner = el.shadowRoot!.querySelector("button")!;
  expect(inner.getAttribute("type")).toBe("button");
});

test("forwards aria-label to the inner button so icon-only buttons have an accessible name", async () => {
  const el = await mount(
    '<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>',
  );
  const inner = el.shadowRoot!.querySelector("button")!;
  expect(inner.getAttribute("aria-label")).toBe("Cerrar");
});

test("focusing the host delegates focus to the inner button", async () => {
  const el = await mount("<wt-button>x</wt-button>");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("button"));
});

test("primary variant paints from the primary token", async () => {
  const el = await mount('<wt-button variant="primary">x</wt-button>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  const inner = el.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(inner).backgroundColor).toBe("rgb(1, 2, 3)");
});
