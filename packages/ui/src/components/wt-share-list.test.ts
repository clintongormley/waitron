import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { ShareListShare, WtShareList } from "./wt-share-list.js";
import "./wt-share-list.js";

afterEach(cleanup);

const SHARES: ShareListShare[] = [
  { name: "Guest 1", detail: "card · tip €2.44", amount: "€24.44", state: "paid" },
  { name: "Guest 2", detail: "paying now", amount: "€24.43", state: "current" },
  { name: "Guest 3", detail: "to pay", amount: "€24.43", state: "due" },
];

async function list(shares = SHARES, label = "Shares"): Promise<WtShareList> {
  const el = (await mount("<wt-share-list></wt-share-list>")) as WtShareList;
  el.label = label;
  el.shares = shares;
  await el.updateComplete;
  return el;
}

function rows(el: WtShareList) {
  return [...el.shadowRoot!.querySelectorAll<HTMLLIElement>("ol > li")].map((li) => ({
    li,
    marker: li.querySelector<HTMLElement>("[data-marker]")!,
    name: li.querySelector<HTMLElement>("[data-name]")!,
    detail: li.querySelector<HTMLElement>("[data-detail]")!,
    amount: li.querySelector<HTMLElement>("[data-amount]")!,
  }));
}

test("draws the shares as an ordered list, in the order given, named by label", async () => {
  const el = await list();
  const ol = el.shadowRoot!.querySelector("ol")!;
  expect(ol.getAttribute("aria-label")).toBe("Shares");
  expect(
    rows(el).map((row) => [
      row.name.textContent?.trim(),
      row.detail.textContent?.trim(),
      row.amount.textContent?.trim(),
    ]),
  ).toEqual([
    ["Guest 1", "card · tip €2.44", "€24.44"],
    ["Guest 2", "paying now", "€24.43"],
    ["Guest 3", "to pay", "€24.43"],
  ]);
});

test("marks only the current share as the current step", async () => {
  const el = await list();
  expect(rows(el).map((row) => row.li.getAttribute("aria-current"))).toEqual([null, "step", null]);
});

test("hides every marker from screen readers, and only a paid share's holds a check", async () => {
  const el = await list();
  const markers = rows(el).map((row) => row.marker);
  expect(markers.map((marker) => marker.getAttribute("aria-hidden"))).toEqual([
    "true",
    "true",
    "true",
  ]);
  expect(
    markers.map((marker) => marker.querySelector("wt-icon")?.getAttribute("name") ?? null),
  ).toEqual(["check", null, null]);
  expect(markers[0]!.querySelector("wt-icon")!.getAttribute("size")).toBe("lg");
});

test("draws nothing with no shares", async () => {
  const el = await list([]);
  expect(el.shadowRoot!.querySelector("ol")).toBeNull();
});

function paint(el: HTMLElement) {
  const tokens: Record<string, string> = {
    "--wt-color-surface": "rgb(1, 1, 1)",
    "--wt-color-border": "rgb(2, 2, 2)",
    "--wt-color-text": "rgb(3, 3, 3)",
    "--wt-color-text-muted": "rgb(4, 4, 4)",
    "--wt-color-primary": "rgb(5, 5, 5)",
    "--wt-color-primary-text": "rgb(6, 6, 6)",
    "--wt-color-surface-lifted": "rgb(7, 7, 7)",
    "--wt-radius-md": "9px",
    "--wt-space-1": "8px",
    "--wt-space-2": "10px",
    "--wt-space-3": "20px",
    "--wt-space-5": "40px",
    "--wt-font-size-md": "17px",
    "--wt-font-size-sm": "11px",
    "--wt-font-weight-normal": "300",
    "--wt-font-weight-medium": "500",
    "--wt-font-weight-bold": "700",
    "--wt-field-line-width": "1px",
    "--wt-field-line-width-active": "3px",
  };
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
}

test("paints the card and its rows from the tokens", async () => {
  const el = await list();
  paint(el);
  const ol = getComputedStyle(el.shadowRoot!.querySelector("ol")!);
  expect(ol.backgroundColor).toBe("rgb(1, 1, 1)");
  expect(ol.borderTopWidth).toBe("1px");
  expect(ol.borderTopColor).toBe("rgb(2, 2, 2)");
  expect(ol.borderTopLeftRadius).toBe("9px");
  expect(ol.marginLeft).toBe("20px");
  expect(ol.marginRight).toBe("20px");
  const [first, , last] = rows(el);
  const row = getComputedStyle(first!.li);
  // calc(space-2 + space-1 * 0.75) by calc(space-3 + space-1 / 2).
  expect(row.paddingTop).toBe("16px");
  expect(row.paddingBottom).toBe("16px");
  expect(row.paddingLeft).toBe("24px");
  expect(row.paddingRight).toBe("24px");
  expect(row.borderBottomWidth).toBe("1px");
  expect(row.borderBottomColor).toBe("rgb(2, 2, 2)");
  expect(getComputedStyle(last!.li).borderBottomStyle).toBe("none");
  const marker = first!.marker.getBoundingClientRect();
  expect([marker.width, marker.height]).toEqual([36, 36]);
  expect(getComputedStyle(first!.name).fontSize).toBe("17px");
  expect(getComputedStyle(first!.detail).fontSize).toBe("11px");
  expect(getComputedStyle(first!.detail).color).toBe("rgb(4, 4, 4)");
  const amount = getComputedStyle(last!.amount);
  expect(amount.fontWeight).toBe("700");
  expect(amount.fontVariantNumeric).toBe("tabular-nums");
  // The amount sits at the row's end.
  expect(last!.amount.getBoundingClientRect().right).toBe(
    last!.li.getBoundingClientRect().right - 24,
  );
});

test("a due share: a ring in the border colour on no fill, in the text colour", async () => {
  const el = await list();
  paint(el);
  const due = rows(el)[2]!;
  const marker = getComputedStyle(due.marker);
  expect(marker.borderTopWidth).toBe("3px");
  expect(marker.borderTopColor).toBe("rgb(2, 2, 2)");
  expect(marker.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(marker.borderTopLeftRadius).toBe("50%");
  expect(getComputedStyle(due.li).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(due.name).color).toBe("rgb(3, 3, 3)");
  expect(getComputedStyle(due.name).fontWeight).toBe("300");
});

test("the current share: ring and fill in the brand colour, on the lifted surface, in bold", async () => {
  const el = await list();
  paint(el);
  const current = rows(el)[1]!;
  const marker = getComputedStyle(current.marker);
  expect(marker.borderTopWidth).toBe("3px");
  expect(marker.borderTopColor).toBe("rgb(5, 5, 5)");
  expect(marker.backgroundColor).toBe("rgb(5, 5, 5)");
  expect(getComputedStyle(current.li).backgroundColor).toBe("rgb(7, 7, 7)");
  expect(getComputedStyle(current.name).fontWeight).toBe("700");
  expect(getComputedStyle(current.detail).fontWeight).toBe("700");
  expect(getComputedStyle(current.name).color).toBe("rgb(3, 3, 3)");
});

test("a paid share: a brand-coloured ring holding a check in the brand text colour, muted text, a medium amount", async () => {
  const el = await list();
  paint(el);
  const paid = rows(el)[0]!;
  const marker = getComputedStyle(paid.marker);
  expect(marker.borderTopWidth).toBe("3px");
  expect(marker.borderTopColor).toBe("rgb(5, 5, 5)");
  expect(marker.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(paid.marker.querySelector("wt-icon")!).color).toBe("rgb(6, 6, 6)");
  expect(getComputedStyle(paid.name).color).toBe("rgb(4, 4, 4)");
  expect(getComputedStyle(paid.amount).color).toBe("rgb(4, 4, 4)");
  expect(getComputedStyle(paid.amount).fontWeight).toBe("500");
  expect(getComputedStyle(paid.li).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

test("a card in progress is a due share whose detail says so", async () => {
  const el = await list([
    { name: "Guest 1", detail: "card in progress", amount: "€24.44", state: "due" },
  ]);
  const [row] = rows(el);
  expect(row!.li.getAttribute("aria-current")).toBeNull();
  expect(row!.detail.textContent?.trim()).toBe("card in progress");
  expect(row!.marker.querySelector("wt-icon")).toBeNull();
});
