import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { RotaPopup } from "./rota-popup.js";
import "./rota-popup.js";

let host: HTMLDivElement;
let el: RotaPopup;
let content: HTMLDivElement;
let closes: number;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  applyTokens(host);
  el = document.createElement("rota-popup");
  el.heading = "Fri 4 Dec · Sous chef · 09:00–17:00";
  content = document.createElement("div");
  content.style.cssText = "width: 300px; height: 200px;";
  el.append(content);
  host.append(el);
  closes = 0;
  el.addEventListener("rota-popup-close", () => closes++);
  await el.updateComplete;
});
afterEach(async () => {
  const scrolled =
    scrollX !== 0 || scrollY !== 0
      ? new Promise((resolve) => addEventListener("scroll", resolve, { once: true }))
      : undefined;
  host.remove();
  scrollTo(0, 0);
  await scrolled;
});

async function useViewport(width: number, height: number) {
  const before = [innerWidth, innerHeight] as const;
  await page.viewport(width, height);
  await vi.waitFor(() => expect(innerWidth).toBe(width));
  onTestFinished(() => page.viewport(...before));
}
function anchorAt(left: number, top: number, parent: HTMLElement = host): HTMLButtonElement {
  const anchor = document.createElement("button");
  anchor.textContent = "+ unfilled";
  anchor.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; width: 120px; height: 40px; box-sizing: border-box;`;
  parent.append(anchor);
  return anchor;
}
const popup = () => el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const box = () => popup().getBoundingClientRect();
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
function insideWindow() {
  const rect = box();
  expect(rect.left).toBeGreaterThanOrEqual(8 - 0.5);
  expect(rect.top).toBeGreaterThanOrEqual(8 - 0.5);
  expect(rect.right).toBeLessThanOrEqual(innerWidth - 8 + 0.5);
  expect(rect.bottom).toBeLessThanOrEqual(innerHeight - 8 + 0.5);
}
const scrolled = (target: EventTarget) =>
  new Promise((resolve) => target.addEventListener("scroll", resolve, { once: true }));
async function closedOnce() {
  await expect.poll(() => closes).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(closes).toBe(1);
  expect(el.shown).toBe(false);
}

describe("rota-popup", () => {
  it("opens beside its anchor on the end side, top-aligned, as a dialog named by its heading", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(100, 200);
    el.show(anchor);
    expect(el.shown).toBe(true);
    expect(popup().getAttribute("role")).toBe("dialog");
    const heading = el.shadowRoot!.querySelector("h2")!;
    expect(popup().getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.textContent!.trim()).toBe("Fri 4 Dec · Sous chef · 09:00–17:00");
    near(box().left, anchor.getBoundingClientRect().right);
    near(box().top, anchor.getBoundingClientRect().top);
    insideWindow();
  });

  it("opens on the start side when the end side has no room", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(1100, 200);
    el.show(anchor);
    near(box().right, anchor.getBoundingClientRect().left);
    near(box().top, anchor.getBoundingClientRect().top);
    insideWindow();
  });

  it("keeps 8 px inside the window when the anchor is near the bottom", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(100, 820);
    el.show(anchor);
    near(box().left, anchor.getBoundingClientRect().right);
    insideWindow();
  });

  it("sits below its anchor when neither side has room", async () => {
    await useViewport(390, 844);
    expect(el.sheet).toBe(false);
    const anchor = anchorAt(135, 200);
    el.show(anchor);
    near(box().top, anchor.getBoundingClientRect().bottom);
    insideWindow();
  });

  it("places again after its content grows, without moving focus", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(700, 200);
    const inside = document.createElement("button");
    inside.textContent = "Ana";
    el.append(inside);
    el.show(anchor);
    inside.focus();
    content.style.width = "600px";
    el.show(anchor);
    expect(deepActive()).toBe(inside);
    near(box().right, anchor.getBoundingClientRect().left);
  });

  it("follows its anchor when the box it is drawn in scrolls, and closes once the anchor leaves that box", async () => {
    await useViewport(1280, 900);
    const scroller = document.createElement("div");
    scroller.style.cssText =
      "position: absolute; left: 0; top: 100px; width: 400px; height: 100px; overflow: auto;";
    const wide = document.createElement("div");
    wide.style.cssText = "position: relative; width: 1200px; height: 60px;";
    scroller.append(wide);
    host.append(scroller);
    const anchor = anchorAt(100, 10, wide);
    el.show(anchor);
    near(box().left, anchor.getBoundingClientRect().right);
    let scroll = scrolled(scroller);
    scroller.scrollLeft = 40;
    await scroll;
    expect(anchor.getBoundingClientRect().right).toBeLessThan(220 - 30);
    near(box().left, anchor.getBoundingClientRect().right);
    expect(el.shown).toBe(true);
    scroll = scrolled(scroller);
    scroller.scrollLeft = 400;
    await scroll;
    expect(anchor.getBoundingClientRect().right).toBeLessThan(
      scroller.getBoundingClientRect().left,
    );
    await closedOnce();
  });

  it("follows an anchor slotted into another shadow root's scrolling box, and closes once it leaves", async () => {
    await useViewport(1280, 900);
    const shadowHost = document.createElement("div");
    host.append(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.style.cssText =
      "position: absolute; left: 0; top: 100px; width: 400px; height: 100px; overflow-x: auto;";
    // Boxes clipping one way only, wide and tall enough to clip nothing of the anchor.
    const clipsX = document.createElement("div");
    clipsX.style.cssText = "width: 1200px; height: 60px; overflow-x: clip;";
    const clipsY = document.createElement("div");
    clipsY.style.cssText = "position: relative; width: 1200px; height: 60px; overflow-y: clip;";
    clipsY.append(document.createElement("slot"));
    clipsX.append(clipsY);
    scroller.append(clipsX);
    root.append(scroller);
    const anchor = anchorAt(100, 10, shadowHost);
    el.show(anchor);
    near(box().left, anchor.getBoundingClientRect().right);
    let scroll = scrolled(scroller);
    scroller.scrollLeft = 40;
    await scroll;
    expect(anchor.getBoundingClientRect().right).toBeLessThan(220 - 30);
    near(box().left, anchor.getBoundingClientRect().right);
    expect(el.shown).toBe(true);
    scroll = scrolled(scroller);
    scroller.scrollLeft = 400;
    await scroll;
    await closedOnce();
  });

  it("closes once its anchor scrolls above the top of the window", async () => {
    await useViewport(1280, 900);
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    host.append(spacer);
    const anchor = anchorAt(100, 300);
    el.show(anchor);
    const scroll = scrolled(window);
    window.scrollBy(0, 400);
    await scroll;
    expect(anchor.getBoundingClientRect().bottom).toBeLessThan(0);
    await closedOnce();
  });

  it("places again when the window is resized", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(700, 200);
    el.show(anchor);
    near(box().left, anchor.getBoundingClientRect().right);
    await useViewport(1000, 900);
    await expect
      .poll(() => Math.abs(box().right - anchor.getBoundingClientRect().left))
      .toBeLessThanOrEqual(1);
    expect(el.shown).toBe(true);
  });

  it("focuses its heading on open, closes on Escape and gives focus back to its anchor", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(100, 200);
    el.show(anchor);
    expect(deepActive()).toBe(el.shadowRoot!.querySelector("h2"));
    await userEvent.keyboard("{Escape}");
    await closedOnce();
    expect(deepActive()).toBe(anchor);
  });

  it("closes on a click outside, leaving focus on the button that was clicked", async () => {
    await useViewport(1280, 900);
    const anchor = anchorAt(100, 200);
    const other = anchorAt(100, 600);
    other.textContent = "Another slot";
    el.show(anchor);
    await userEvent.click(other);
    await closedOnce();
    expect(deepActive()).toBe(other);
  });

  it("closes from hide() and stops following its anchor", async () => {
    await useViewport(1280, 900);
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    host.append(spacer);
    const anchor = anchorAt(100, 300);
    el.show(anchor);
    expect(el.shown).toBe(true);
    el.hide();
    expect(el.shown).toBe(false);
    el.hide();
    await closedOnce();
    const scroll = scrolled(window);
    window.scrollBy(0, 100);
    await scroll;
    expect(el.shown).toBe(false);
  });

  it("stops following its anchor once taken off the page", async () => {
    await useViewport(1280, 900);
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    host.append(spacer);
    const anchor = anchorAt(100, 300);
    el.show(anchor);
    expect(el.shown).toBe(true);
    el.remove();
    host.append(el);
    expect(el.shown).toBe(false);
    const scroll = scrolled(window);
    window.scrollBy(0, 100);
    await scroll;
    expect(el.shown).toBe(false);
  });

  it("as a sheet it sits at the bottom of the window at full width, scrolls within 70% of its height, and dims the page", async () => {
    await useViewport(390, 844);
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    host.append(spacer);
    const anchor = anchorAt(100, 300);
    content.style.cssText = "";
    for (let i = 0; i < 40; i++) {
      const row = document.createElement("button");
      row.textContent = `Person ${i}`;
      row.style.display = "block";
      content.append(row);
    }
    el.sheet = true;
    await el.updateComplete;
    el.show(anchor);
    expect(el.shown).toBe(true);
    const placed = () => {
      const rect = box();
      near(rect.left, 0);
      near(rect.width, 390);
      near(rect.bottom, 844);
      expect(rect.height).toBeLessThanOrEqual(591);
    };
    placed();
    expect(popup().scrollHeight).toBeGreaterThan(popup().clientHeight);
    expect(getComputedStyle(popup()).overflowY).toBe("auto");
    const backdrop = getComputedStyle(popup(), "::backdrop").backgroundColor;
    expect(backdrop).not.toBe("rgba(0, 0, 0, 0)");
    expect(backdrop).not.toBe("transparent");
    const scroll = scrolled(window);
    window.scrollBy(0, 600);
    await scroll;
    expect(anchor.getBoundingClientRect().bottom).toBeLessThan(0);
    await new Promise(requestAnimationFrame);
    expect(el.shown).toBe(true);
    placed();
  });

  it("a sheet shown again after its content changes stays open at the foot without moving focus", async () => {
    await useViewport(390, 844);
    const anchor = anchorAt(100, 300);
    const inside = document.createElement("button");
    inside.textContent = "Ana";
    el.append(inside);
    el.sheet = true;
    await el.updateComplete;
    el.show(anchor);
    inside.focus();
    content.style.height = "100px";
    el.show(anchor);
    expect(el.shown).toBe(true);
    expect(deepActive()).toBe(inside);
    near(box().bottom, 844);
    near(box().left, 0);
    expect(closes).toBe(0);
  });

  it("a sheet's Cancel closes it and returns focus to what opened it", async () => {
    await useViewport(390, 844);
    const anchor = anchorAt(100, 300);
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => el.hide());
    el.append(cancel);
    el.sheet = true;
    await el.updateComplete;
    el.show(anchor);
    expect(deepActive()).toBe(el.shadowRoot!.querySelector("h2"));
    await userEvent.click(cancel);
    await closedOnce();
    expect(deepActive()).toBe(anchor);
  });

  it("paints its background and border from the surface and border tokens", async () => {
    await useViewport(1280, 900);
    el.show(anchorAt(100, 200));
    const probe = document.createElement("span");
    probe.style.background = "var(--wt-color-surface)";
    probe.style.color = "var(--wt-color-border)";
    host.append(probe);
    const style = getComputedStyle(popup());
    expect(style.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.borderTopColor).toBe(getComputedStyle(probe).color);
    expect(style.borderTopWidth).not.toBe("0px");
  });
});
