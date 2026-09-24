import { expect, test, afterEach } from "vitest";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-switch.js";

afterEach(cleanup);

test("forwards a semantic name and keeps unnamed switches unnamed", async () => {
  const el = await mount('<wt-switch name="printer-active"></wt-switch>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.name).toBe("printer-active");
  el.setAttribute("name", "ticketScope");
  await (el as import("./wt-switch.js").WtSwitch).updateComplete;
  expect(input.name).toBe("ticketScope");
  el.removeAttribute("name");
  await (el as import("./wt-switch.js").WtSwitch).updateComplete;
  expect(input.hasAttribute("name")).toBe(false);
});

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
  // Composed on purpose: a real click's native `change` is not composed, so it could never leak and
  // the assertion would pass whatever the component does.
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
  // wt-switch dims the host itself, not an inner element.
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
  // An input overflowing its host steals clicks from whatever sits below the switch.
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  const hostRect = el.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  expect(inputRect.top).toBeGreaterThanOrEqual(hostRect.top);
  expect(inputRect.bottom).toBeLessThanOrEqual(hostRect.bottom);
  expect(inputRect.left).toBeGreaterThanOrEqual(hostRect.left);
  expect(inputRect.right).toBeLessThanOrEqual(hostRect.right);
});

test("a switch with no label renders no label text and no aria-label attribute", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(input.hasAttribute("aria-label")).toBe(false);
});

test("names the switch for assistive technology with its own label text", async () => {
  const el = await mount('<wt-switch label="Modo formación"></wt-switch>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.getAttribute("aria-label")).toBe("Modo formación");
});

test("a switch given no name leaves its native input unnamed", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  expect(el.shadowRoot!.querySelector("input")!.hasAttribute("name")).toBe(false);
});

test("a hidden label still names the switch but draws no text beside it", async () => {
  const el = await mount('<wt-switch label="Disponible" hide-label></wt-switch>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.getAttribute("aria-label")).toBe("Disponible");
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Disponible");
  // Only the control is left, so the switch takes no more room than its own tap target.
  const tap = parseFloat(getComputedStyle(el).minWidth);
  expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(tap);
});
