import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { CalendarDayBox } from "./calendar-day-box.js";
import "./calendar-day-box.js";

let host: HTMLDivElement;
let anchor: HTMLButtonElement;
let below: HTMLParagraphElement;
let box: CalendarDayBox;
let closes: number;

beforeEach(async () => {
  await page.viewport(1280, 800);
  host = document.createElement("div");
  anchor = document.createElement("button");
  anchor.textContent = "16";
  below = document.createElement("p");
  below.textContent = "Next row";
  box = document.createElement("calendar-day-box");
  box.heading = "Fri, 16 Oct 2026";
  host.append(anchor, box, below);
  document.body.append(host);
  applyTokens(host);
  closes = 0;
  box.addEventListener("calendar-day-box-close", () => closes++);
  await box.updateComplete;
});
afterEach(async () => {
  host.remove();
  scrollTo(0, 0);
  await page.viewport(1280, 800);
});

const popup = () => box.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
const isOpen = () => popup().matches(":popover-open");
function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
function insideViewport(rect: DOMRect) {
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.bottom).toBeLessThanOrEqual(innerHeight);
  expect(rect.right).toBeLessThanOrEqual(innerWidth);
}

describe("calendar-day-box", () => {
  it("opens below its anchor, on top of the page, moving nothing", async () => {
    const before = below.getBoundingClientRect().top;
    box.show(anchor);
    expect(isOpen()).toBe(true);
    expect(popup().getAttribute("role")).toBe("dialog");
    expect(
      Math.abs(popup().getBoundingClientRect().top - anchor.getBoundingClientRect().bottom),
    ).toBeLessThanOrEqual(1);
    expect(below.getBoundingClientRect().top).toBe(before);
    const heading = box.shadowRoot!.querySelector("h2")!;
    expect(popup().getAttribute("aria-labelledby")).toBe(heading.id);
    expect(deepActive()).toBe(heading);
  });

  it("draws its heading, name, line and rows", async () => {
    box.name = "School holidays";
    box.nameKind = "special";
    box.line = "Special day — replaces Autumn's standard hours";
    box.rows = [
      { name: "Santet Deli Co", text: "Lunch 16:00–17:00", strong: true },
      { name: "Front Bar", text: "as Santet Deli Co" },
    ];
    await box.updateComplete;
    const root = box.shadowRoot!;
    expect(root.querySelector("h2")!.textContent!.trim()).toBe("Fri, 16 Oct 2026");
    const name = root.querySelector<HTMLElement>("[data-test=name]")!;
    expect(name.textContent!.trim()).toBe("School holidays");
    expect(name.dataset.kind).toBe("special");
    expect(root.querySelector("[data-test=line]")!.textContent!.trim()).toBe(
      "Special day — replaces Autumn's standard hours",
    );
    const terms = [...root.querySelectorAll("dl dt")];
    const details = [...root.querySelectorAll("dl dd")];
    expect(terms.map((dt) => dt.textContent!.trim())).toEqual(["Santet Deli Co", "Front Bar"]);
    expect(details.map((dd) => dd.textContent!.trim())).toEqual([
      "Lunch 16:00–17:00",
      "as Santet Deli Co",
    ]);
    expect(Number(getComputedStyle(terms[0]!).fontWeight)).toBeGreaterThanOrEqual(600);
    expect(Number(getComputedStyle(terms[1]!).fontWeight)).toBeLessThan(600);
  });

  it("shows a message instead of the rows, and nothing for an empty name or line", async () => {
    box.rows = [{ name: "Front Bar", text: "Open" }];
    box.message = "Loading…";
    await box.updateComplete;
    const root = box.shadowRoot!;
    expect(root.querySelector("dl")).toBeNull();
    expect(root.querySelector("[data-test=message]")!.textContent!.trim()).toBe("Loading…");
    expect(root.querySelector("[data-test=name]")).toBeNull();
    expect(root.querySelector("[data-test=line]")).toBeNull();
  });

  it("draws an error as an alert beside its rows, instead of them when there are none, and drops it when cleared", async () => {
    box.rows = [{ name: "Front Bar", text: "Open" }];
    box.error = "Opening hours could not be loaded.";
    await box.updateComplete;
    const root = box.shadowRoot!;
    const error = () => root.querySelector<HTMLElement>("[data-test=error]");
    expect(error()!.getAttribute("role")).toBe("alert");
    expect(error()!.textContent!.trim()).toBe("Opening hours could not be loaded.");
    expect(root.querySelector("[data-test=message]")).toBeNull();
    expect([...root.querySelectorAll("dl dt")].map((dt) => dt.textContent!.trim())).toEqual([
      "Front Bar",
    ]);
    box.rows = [];
    await box.updateComplete;
    expect(error()!.textContent!.trim()).toBe("Opening hours could not be loaded.");
    expect(root.querySelector("dl")).toBeNull();
    box.error = "";
    await box.updateComplete;
    expect(error()).toBeNull();
  });

  it("closes on Escape and returns focus to its anchor", async () => {
    box.show(anchor);
    await userEvent.keyboard("{Escape}");
    expect(isOpen()).toBe(false);
    expect(closes).toBe(1);
    expect(deepActive()).toBe(anchor);
  });

  it("returns focus to its anchor when both live in a shadow root and a slotted button had focus", async () => {
    const shadowHost = document.createElement("div");
    host.append(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const inner = document.createElement("calendar-day-box");
    inner.heading = "Fri, 16 Oct 2026";
    const button = document.createElement("button");
    button.textContent = "Edit special day";
    inner.append(button);
    const innerAnchor = document.createElement("button");
    innerAnchor.textContent = "17";
    root.append(innerAnchor, inner);
    await inner.updateComplete;
    inner.show(innerAnchor);
    await expect.poll(() => button.checkVisibility()).toBe(true);
    button.focus();
    expect(deepActive()).toBe(button);
    await userEvent.keyboard("{Escape}");
    expect(inner.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
    expect(deepActive()).toBe(innerAnchor);
  });

  it("closes on a click elsewhere and leaves focus where the click put it", async () => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Elsewhere");
    host.append(input);
    box.show(anchor);
    await userEvent.click(input);
    expect(isOpen()).toBe(false);
    expect(closes).toBe(1);
    expect(deepActive()).toBe(input);
  });

  it("closes from hide() and sends one close event", async () => {
    box.show(anchor);
    box.hide();
    await expect.poll(() => closes).toBe(1);
    expect(isOpen()).toBe(false);
    box.hide();
    // The browser queues every popover's toggle event as a task in one queue, so a close this
    // second hide() had queued would arrive before the probe's own toggle event.
    const probe = document.createElement("div");
    probe.popover = "manual";
    host.append(probe);
    const probed = new Promise((resolve) =>
      probe.addEventListener("toggle", resolve, { once: true }),
    );
    probe.showPopover();
    await probed;
    expect(closes).toBe(1);
  });

  it("says whether it is shown, false from the moment it is hidden", () => {
    expect(box.shown).toBe(false);
    box.show(anchor);
    expect(box.shown).toBe(true);
    box.hide();
    expect(box.shown).toBe(false);
  });

  it("stays inside a phone's width", async () => {
    await page.viewport(390, 800);
    expect(innerWidth).toBe(390);
    anchor.style.cssText = "position: fixed; right: 0; top: 100px;";
    box.line =
      "Special day — replaces Autumn's standard hours, and every zone follows its department";
    box.rows = [
      { name: "Santet Deli Co", text: "Lunch 16:00–17:00 · Open 17:00–02:00 · closed 23:00–02:00" },
    ];
    await box.updateComplete;
    box.show(anchor);
    const rect = popup().getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(390 - 8);
    expect(rect.left).toBeGreaterThanOrEqual(8);
  });

  it("follows its date across the viewport when a phone turns, staying on screen", async () => {
    await page.viewport(844, 390);
    anchor.style.cssText = "position: fixed; right: 8px; top: 80px;";
    box.rows = [{ name: "Restaurant", text: "Lunch 13:00–16:00" }];
    await box.updateComplete;
    box.show(anchor);
    await page.viewport(390, 844);
    expect([innerWidth, innerHeight]).toEqual([390, 844]);
    await expect.poll(() => popup().getBoundingClientRect().right).toBeLessThanOrEqual(390 - 8);
    const placed = popup().getBoundingClientRect();
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(Math.abs(placed.top - anchor.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
  });

  const scrolled = (target: EventTarget) =>
    new Promise((resolve) => target.addEventListener("scroll", resolve, { once: true }));

  it("stays beside its date when the page scrolls", async () => {
    host.style.height = "3000px";
    anchor.style.marginTop = "300px";
    box.show(anchor);
    const gap = () => popup().getBoundingClientRect().top - anchor.getBoundingClientRect().bottom;
    expect(Math.abs(gap())).toBeLessThanOrEqual(1);
    const scroll = scrolled(window);
    window.scrollBy(0, 150);
    await scroll;
    expect(anchor.getBoundingClientRect().top).toBeLessThan(300);
    expect(Math.abs(gap())).toBeLessThanOrEqual(1);
    expect(box.shown).toBe(true);
  });

  it("stays beside a date inside another shadow root's scrolling box when that box scrolls", async () => {
    const shadowHost = document.createElement("div");
    host.prepend(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const scroller = document.createElement("div");
    scroller.style.cssText = "height: 300px; overflow: auto;";
    const inner = document.createElement("button");
    inner.textContent = "17";
    inner.style.marginTop = "200px";
    const tail = document.createElement("div");
    tail.style.height = "1000px";
    scroller.append(inner, tail);
    root.append(scroller);
    box.show(inner);
    const gap = () => popup().getBoundingClientRect().top - inner.getBoundingClientRect().bottom;
    expect(Math.abs(gap())).toBeLessThanOrEqual(1);
    const scroll = scrolled(scroller);
    scroller.scrollTop = 100;
    await scroll;
    expect(Math.abs(gap())).toBeLessThanOrEqual(1);
    expect(box.shown).toBe(true);
  });

  it("closes when its date scrolls out of view", async () => {
    host.style.height = "3000px";
    anchor.style.marginTop = "300px";
    box.show(anchor);
    const scroll = scrolled(window);
    window.scrollBy(0, 600);
    await scroll;
    expect(anchor.getBoundingClientRect().bottom).toBeLessThan(0);
    await expect.poll(() => closes).toBe(1);
    expect(box.shown).toBe(false);
    // Focus goes back to the date without scrolling the page back to it.
    expect(deepActive()).toBe(anchor);
    expect(scrollY).toBe(600);
  });

  it("closes when its date scrolls out of its scrolling box, though still inside the window", async () => {
    const shadowHost = document.createElement("div");
    host.prepend(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const banner = document.createElement("header");
    banner.style.height = "100px";
    const scroller = document.createElement("div");
    scroller.style.cssText = "height: 300px; overflow: auto;";
    const inner = document.createElement("button");
    inner.textContent = "17";
    inner.style.marginTop = "50px";
    const tail = document.createElement("div");
    tail.style.height = "1000px";
    scroller.append(inner, tail);
    root.append(banner, scroller);
    box.show(inner);
    const scroll = scrolled(scroller);
    scroller.scrollTop = 120;
    await scroll;
    const date = inner.getBoundingClientRect();
    expect(date.bottom).toBeLessThan(scroller.getBoundingClientRect().top);
    expect(date.top).toBeGreaterThanOrEqual(0);
    await expect.poll(() => closes).toBe(1);
    expect(box.shown).toBe(false);
  });

  it("closes when a date slotted into another shadow root's scrolling box scrolls out of it", async () => {
    const shadowHost = document.createElement("div");
    host.prepend(shadowHost);
    const root = shadowHost.attachShadow({ mode: "open" });
    const banner = document.createElement("header");
    banner.style.height = "100px";
    const scroller = document.createElement("div");
    scroller.style.cssText = "height: 300px; overflow: auto;";
    const tail = document.createElement("div");
    tail.style.height = "1000px";
    scroller.append(document.createElement("slot"), tail);
    root.append(banner, scroller);
    const slotted = document.createElement("button");
    slotted.textContent = "17";
    slotted.style.cssText = "display: block; margin-top: 50px;";
    shadowHost.append(slotted);
    box.show(slotted);
    expect(box.shown).toBe(true);
    const scroll = scrolled(scroller);
    scroller.scrollTop = 120;
    await scroll;
    const date = slotted.getBoundingClientRect();
    expect(date.bottom).toBeLessThan(scroller.getBoundingClientRect().top);
    expect(date.top).toBeGreaterThanOrEqual(0);
    await expect.poll(() => closes).toBe(1);
    expect(box.shown).toBe(false);
  });

  it("stays open beside its date when the page scrolls, its root element setting its own overflow", async () => {
    document.documentElement.style.overflowY = "scroll";
    try {
      host.style.height = "3000px";
      anchor.style.marginTop = "900px";
      box.show(anchor);
      const scroll = scrolled(window);
      window.scrollBy(0, 300);
      await scroll;
      expect(anchor.getBoundingClientRect().top).toBeGreaterThan(innerHeight - 300);
      expect(anchor.getBoundingClientRect().bottom).toBeLessThan(innerHeight);
      expect(box.shown).toBe(true);
    } finally {
      document.documentElement.style.overflowY = "";
    }
  });

  it("closes when the window shrinks and leaves its date below the fold", async () => {
    anchor.style.marginTop = "600px";
    box.show(anchor);
    await page.viewport(1280, 500);
    await expect.poll(() => innerHeight).toBe(500);
    expect(anchor.getBoundingClientRect().top).toBeGreaterThan(innerHeight);
    await expect.poll(() => closes).toBe(1);
    expect(box.shown).toBe(false);
  });

  it.each([
    ["closed", () => box.hide()],
    [
      "taken off the page",
      () => {
        box.remove();
        host.append(box);
      },
    ],
  ])("stops following the page once %s", async (_, end) => {
    host.style.height = "3000px";
    anchor.style.marginTop = "300px";
    box.show(anchor);
    end();
    expect(box.shown).toBe(false);
    // Placing it again would show it: placement opens a closed popover.
    const scroll = scrolled(window);
    window.scrollBy(0, 100);
    await scroll;
    expect(box.shown).toBe(false);
    await page.viewport(1000, 700);
    await expect.poll(() => innerWidth).toBe(1000);
    expect(box.shown).toBe(false);
  });

  it("opens above its anchor when there is no room below but room above, covering nothing of it", async () => {
    anchor.style.cssText = `position: fixed; left: 100px; top: ${innerHeight - 20 - 24}px; height: 24px;`;
    box.rows = [{ name: "Front Bar", text: "Open" }];
    await box.updateComplete;
    box.show(anchor);
    const placed = popup().getBoundingClientRect();
    const date = anchor.getBoundingClientRect();
    expect(Math.abs(placed.bottom - date.top)).toBeLessThanOrEqual(1);
    expect(placed.bottom <= date.top + 1 || placed.top >= date.bottom - 1).toBe(true);
    insideViewport(placed);
  });

  it("stays on screen near the bottom, and when it grows", async () => {
    anchor.style.cssText = `position: fixed; left: 100px; top: ${innerHeight - 20 - 24}px; height: 24px;`;
    box.rows = [{ name: "Front Bar", text: "Open" }];
    await box.updateComplete;
    box.show(anchor);
    insideViewport(popup().getBoundingClientRect());
    // Too tall to fit below the anchor, so it sits above it.
    expect(
      Math.abs(popup().getBoundingClientRect().bottom - anchor.getBoundingClientRect().top),
    ).toBeLessThanOrEqual(1);
    box.rows = Array.from({ length: 12 }, (_, i) => ({
      name: `Zone ${i}`,
      text: "Open 17:00–02:00",
    }));
    await box.updateComplete;
    box.show(anchor);
    insideViewport(popup().getBoundingClientRect());
  });
});
