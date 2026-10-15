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
  host.append(anchor, below, box);
  document.body.append(host);
  applyTokens(host);
  closes = 0;
  box.addEventListener("calendar-day-box-close", () => closes++);
  await box.updateComplete;
});
afterEach(async () => {
  host.remove();
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

  it("closes on Escape and returns focus to its anchor", async () => {
    box.show(anchor);
    await userEvent.keyboard("{Escape}");
    expect(isOpen()).toBe(false);
    expect(closes).toBe(1);
    expect(deepActive()).toBe(anchor);
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
    expect(closes).toBe(1);
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

  it("stays on screen near the bottom, and when it grows", async () => {
    anchor.style.cssText = `position: fixed; left: 100px; top: ${innerHeight - 20 - 24}px; height: 24px;`;
    box.rows = [{ name: "Front Bar", text: "Open" }];
    await box.updateComplete;
    box.show(anchor);
    insideViewport(popup().getBoundingClientRect());
    box.rows = Array.from({ length: 12 }, (_, i) => ({
      name: `Zone ${i}`,
      text: "Open 17:00–02:00",
    }));
    await box.updateComplete;
    box.show(anchor);
    insideViewport(popup().getBoundingClientRect());
  });
});
