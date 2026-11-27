import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { ShareListShare, WtShareList } from "./wt-share-list.js";
import "./wt-share-list.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

const SHARES: ShareListShare[] = [
  { name: "Guest 1", detail: "card · tip €2.44", amount: "€24.44", state: "paid" },
  { name: "Guest 2", detail: "card in progress", amount: "€24.43", state: "due" },
  { name: "Guest 3", detail: "paying now", amount: "€24.43", state: "current" },
  { name: "Guest 4", detail: "to pay", amount: "€24.43", state: "due" },
];

async function markers(): Promise<{ el: WtShareList; markers: HTMLElement[] }> {
  const el = (await mount('<wt-share-list label="Shares"></wt-share-list>')) as WtShareList;
  el.shares = SHARES;
  await el.updateComplete;
  return { el, markers: [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-marker]")] };
}

test("in forced colours the current share's marker stays filled, the due ones stay rings and the paid one keeps its check", async () => {
  const {
    el,
    markers: [paid, progress, current, due],
  } = await markers();
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
  expect(centre(current!)).not.toEqual(rowBackground(current!));
  expect(centre(due!)).toEqual(rowBackground(due!));
  expect(centre(progress!)).toEqual(rowBackground(progress!));
  expect(ring(due!)).not.toEqual(rowBackground(due!));
  expect(ring(paid!)).not.toEqual(rowBackground(paid!));
  expect(paid!.querySelector("wt-icon")).not.toBeNull();
});
