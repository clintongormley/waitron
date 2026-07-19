import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-switch.js";

afterEach(cleanup);

test("renders its label", async () => {
  const el = await mount('<wt-switch label="Modo formación"></wt-switch>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Modo formación");
});

test("gives each instance a unique id so labels never collide", async () => {
  const a = await mount('<wt-switch label="Modo formación"></wt-switch>');
  const b = await mount('<wt-switch label="Modo entrenamiento"></wt-switch>');
  const inputA = a.shadowRoot!.querySelector("input")!;
  const inputB = b.shadowRoot!.querySelector("input")!;
  const label = a.shadowRoot!.querySelector("label")!;
  expect(inputA.id).not.toBe(inputB.id);
  // Pins down the actual "wt-switch-N" shape uniqueId() produces, and that the label's `for`
  // really points at it — not just that two instances' ids differ from each other.
  expect(inputA.id).toMatch(/^wt-switch-\d+$/);
  expect(inputB.id).toMatch(/^wt-switch-\d+$/);
  expect(label.htmlFor).toBe(inputA.id);
});

test("exposes checked state to assistive technology", async () => {
  const el = await mount("<wt-switch checked></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getAttribute("role")).toBe("switch");
  expect(input.checked).toBe(true);
});

test("emits wt-change with the new checked state", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  let received: boolean | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ checked: boolean }>).detail.checked;
  });

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.click();

  expect(received).toBe(true);
});

test("wt-change bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  // See wt-input.test.ts's identical-purpose test for why the nested-shadow-root + document
  // listener is required to make bubbles and composed both load-bearing (a light-DOM mount()
  // can't distinguish "composed: false" from "composed: true" at all).
  const el = await mountInShadowRoot("<wt-switch></wt-switch>");
  let received: CustomEvent<{ checked: boolean }> | undefined;
  document.addEventListener(
    "wt-change",
    (e) => {
      received = e as CustomEvent<{ checked: boolean }>;
    },
    { once: true },
  );

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.click();

  expect(received?.detail.checked).toBe(true);
});

test("does not leak the native change event outside the component", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  let native = 0;
  host.addEventListener("change", () => native++);

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  // Dispatch a synthetic composed change event rather than input.click(): a
  // checkbox's native `change` event from real user activation is
  // composed: false by spec, so it can never cross the shadow boundary at
  // all, with or without stopPropagation() — that would make this
  // assertion pass unconditionally regardless of whether the component
  // guards against leaking. Constructing the event with composed: true
  // explicitly forces the code path this test actually exists to check,
  // matching the pattern wt-input's own (sound) leak test already uses.
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

  expect(native).toBe(0);
});

test("clicking the visible label toggles the switch", async () => {
  const el = (await mount('<wt-switch label="Modo formación"></wt-switch>')) as HTMLElement & {
    checked: boolean;
  };
  const label = el.shadowRoot!.querySelector("label")!;
  label.click();
  expect(el.checked).toBe(true);
});

test("checked track paints from the primary token", async () => {
  const el = await mount("<wt-switch checked></wt-switch>");
  host.style.setProperty("--wt-color-primary", "rgb(16, 17, 18)");
  const track = el.shadowRoot!.querySelector(".track")!;
  expect(getComputedStyle(track).backgroundColor).toBe("rgb(16, 17, 18)");
});

test("disabled switch dims via the disabled-opacity token", async () => {
  // Mirrors wt-button's and wt-input's identically-named tests. Unlike those two, wt-switch
  // applies the opacity to :host([disabled]) itself (see base-styles.ts's disabledStyles doc
  // comment for why it can't share that fragment), so the assertion reads the host's own computed
  // style rather than an inner element's.
  const el = await mount("<wt-switch disabled></wt-switch>");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(el).opacity).toBe("0.3");
});

test("meets the minimum tap target on both axes", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  const rect = input.getBoundingClientRect();
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.width).toBeGreaterThanOrEqual(44);
});

test("focusing the host delegates focus to the inner input", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("input"));
});

test("the input's hit target does not extend beyond the host's bounds", async () => {
  // Regression guard: the input used to be `position: absolute; inset: 0; height: 100%` plus
  // `min-height: var(--wt-tap-min)` on the INPUT itself, which stretched it to 44px tall inside an
  // 18px-tall host — overflowing far enough to steal clicks from anything stacked directly below
  // the switch. The tap target must come from the host/control being at least 44px, not from the
  // input escaping its container.
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  const hostRect = el.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  expect(inputRect.top).toBeGreaterThanOrEqual(hostRect.top);
  expect(inputRect.bottom).toBeLessThanOrEqual(hostRect.bottom);
  expect(inputRect.left).toBeGreaterThanOrEqual(hostRect.left);
  expect(inputRect.right).toBeLessThanOrEqual(hostRect.right);
});
