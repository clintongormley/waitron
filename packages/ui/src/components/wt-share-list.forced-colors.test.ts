import { afterEach, describe, expect, test } from "vitest";
import { commands } from "vitest/browser";
import { cleanup, elementPixels, emulateForcedColours, host, mount } from "../test-helpers.js";
import type { ShareListShare, WtShareList } from "./wt-share-list.js";
import "./wt-share-list.js";

afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
  await commands.emulateColorScheme(null);
});

const SHARES: ShareListShare[] = [
  { name: "Guest 1", detail: "card · tip €2.44", amount: "€24.44", state: "paid" },
  { name: "Guest 2", detail: "card in progress", amount: "€24.43", state: "due" },
  { name: "Guest 3", detail: "paying now", amount: "€24.43", state: "current" },
  { name: "Guest 4", detail: "to pay", amount: "€24.43", state: "due" },
];

async function markers(
  theme: "light" | "dark",
): Promise<{ el: WtShareList; markers: HTMLElement[] }> {
  await commands.emulateColorScheme(theme);
  await emulateForcedColours("active");
  const el = (await mount('<wt-share-list label="Shares"></wt-share-list>')) as WtShareList;
  host.dataset["theme"] = theme;
  el.shares = SHARES;
  await el.updateComplete;
  return { el, markers: [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-marker]")] };
}

describe.each(["light", "dark"] as const)("forced colours in %s", (theme) => {
  test("the current share's marker stays filled, the due ones stay rings and the paid one keeps its check", async () => {
    const {
      el,
      markers: [paid, progress, current, due],
    } = await markers(theme);
    const at = await elementPixels(el);
    const centre = (marker: HTMLElement) => {
      const box = marker.getBoundingClientRect();
      return at(box.left + box.width / 2, box.top + box.height / 2);
    };
    const ring = (marker: HTMLElement) => {
      const box = marker.getBoundingClientRect();
      return at(box.left + box.width / 2, box.top + 1);
    };
    const rowBackground = (marker: HTMLElement) => {
      const box = marker.getBoundingClientRect();
      return at(box.left - 2, box.top + box.height / 2);
    };
    // Points well inside the ring, so only the tick can paint them.
    const paintedInside = (marker: HTMLElement) => {
      const box = marker.getBoundingClientRect();
      const background = String(rowBackground(marker));
      const reach = box.width / 4;
      let painted = 0;
      for (let dx = -reach; dx <= reach; dx += 1) {
        for (let dy = -reach; dy <= reach; dy += 1) {
          const x = box.left + box.width / 2 + dx;
          const y = box.top + box.height / 2 + dy;
          if (String(at(x, y)) !== background) painted += 1;
        }
      }
      return painted;
    };
    expect(centre(current!)).not.toEqual(rowBackground(current!));
    expect(centre(due!)).toEqual(rowBackground(due!));
    expect(centre(progress!)).toEqual(rowBackground(progress!));
    expect(ring(due!)).not.toEqual(rowBackground(due!));
    expect(ring(paid!)).not.toEqual(rowBackground(paid!));
    expect(paintedInside(due!)).toBe(0);
    expect(paintedInside(paid!)).toBeGreaterThan(0);
  });
});
