import { afterEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { cleanup, mount, mountInShadowRoot } from "../test-helpers.js";
import type { WtSheet } from "./wt-sheet.js";
import "./wt-sheet.js";

afterEach(cleanup);

const parts = (el: Element) => ({
  toggle: el.shadowRoot!.querySelector<HTMLButtonElement>('[part="toggle"]')!,
  body: el.shadowRoot!.querySelector<HTMLElement>('[part="body"]')!,
});

const visible = (node: Element) => (node as HTMLElement).checkVisibility();

it("shows only its heading while collapsed", async () => {
  const el = await mount('<wt-sheet heading="Tables"><p>Slotted</p></wt-sheet>');
  const { toggle } = parts(el);
  expect(visible(el.querySelector("p")!)).toBe(false);
  expect(toggle.textContent!.trim()).toBe("Tables");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("draws no heading text until it is given one", async () => {
  const el = await mount("<wt-sheet></wt-sheet>");
  expect(parts(el).toggle.textContent!.trim()).toBe("");
});

it("pressing the toggle opens it and tells the page", async () => {
  const el = (await mountInShadowRoot(
    '<wt-sheet heading="Tables"><p>Slotted</p></wt-sheet>',
  )) as WtSheet;
  const heard: unknown[] = [];
  const listener = (event: Event) => heard.push((event as CustomEvent).detail);
  document.addEventListener("wt-sheet-toggle", listener);
  const clicks: Event[] = [];
  el.parentNode!.addEventListener("click", (event) => clicks.push(event));
  try {
    parts(el).toggle.click();
    await el.updateComplete;
  } finally {
    document.removeEventListener("wt-sheet-toggle", listener);
  }
  expect(heard).toEqual([{ expanded: true }]);
  expect(el.expanded).toBe(true);
  expect(parts(el).toggle.getAttribute("aria-expanded")).toBe("true");
  expect(visible(el.querySelector("p")!)).toBe(true);
  expect(clicks).toEqual([]);
});

it("pressing it again closes it", async () => {
  const el = (await mount('<wt-sheet heading="Tables"><p>Slotted</p></wt-sheet>')) as WtSheet;
  const heard: unknown[] = [];
  el.addEventListener("wt-sheet-toggle", (event) => heard.push((event as CustomEvent).detail));
  parts(el).toggle.click();
  await el.updateComplete;
  parts(el).toggle.click();
  await el.updateComplete;
  expect(heard).toEqual([{ expanded: true }, { expanded: false }]);
  expect(el.expanded).toBe(false);
  expect(el.hasAttribute("expanded")).toBe(false);
  expect(visible(el.querySelector("p")!)).toBe(false);
});

it("the page can open it", async () => {
  const el = (await mount('<wt-sheet heading="Tables"><p>Slotted</p></wt-sheet>')) as WtSheet;
  el.expanded = true;
  await el.updateComplete;
  expect(visible(el.querySelector("p")!)).toBe(true);
  expect(el.hasAttribute("expanded")).toBe(true);
  expect(parts(el).toggle.getAttribute("aria-expanded")).toBe("true");
});

it("names the body it controls", async () => {
  const el = await mount('<wt-sheet heading="Tables"><p>Slotted</p></wt-sheet>');
  const { toggle, body } = parts(el);
  expect(body.id).not.toBe("");
  expect(toggle.getAttribute("aria-controls")).toBe(body.id);
});

it("scrolls a long body within 60% of the viewport's height", async () => {
  const [width, height] = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(390, 800);
    const el = await mount(
      '<wt-sheet heading="Tables" expanded><div style="height: 2000px">Long</div></wt-sheet>',
    );
    const { body } = parts(el);
    expect(body.clientHeight).toBe(480);
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    body.scrollTop = 100;
    expect(body.scrollTop).toBe(100);
  } finally {
    await page.viewport(width, height);
  }
});

it("its toggle is at least the tap size", async () => {
  const el = await mount('<wt-sheet heading="Tables"></wt-sheet>');
  const tap = parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
  expect(tap).toBeGreaterThan(0);
  expect(parts(el).toggle.getBoundingClientRect().height).toBeGreaterThanOrEqual(tap);
});

it("paints from tokens", async () => {
  const el = await mount('<wt-sheet heading="Tables"></wt-sheet>');
  el.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
  const style = getComputedStyle(el);
  expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
  expect(style.borderTopColor).toBe("rgb(4, 5, 6)");
  expect(style.borderTopStyle).toBe("solid");
});
