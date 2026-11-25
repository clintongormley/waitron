import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { DishMove } from "@waitron/shared";
import { es } from "../i18n/strings.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { bill, courses, seaBass } from "../../test/set-menu-widgets.js";

import { TillSetMenuSummary } from "./set-menu-summary.js";

afterEach(cleanupWidgets);

async function mount(removeMenu = vi.fn(), moveDish = vi.fn(), draft = [seaBass], state = bill) {
  return mountWidget<TillSetMenuSummary>("till-set-menu-summary", {
    bill: state,
    draft,
    courseNames: courses,
    dishNames: new Map([
      ["sent-sirloin", "Sirloin"],
      ["sent-soup", "Soup"],
    ]),
    removeMenu,
    moveDish,
  });
}

it("folds to type and open-place counts, then shows sent and unsent dishes in their places", async () => {
  const { el } = await mount();
  const toggle = el.shadowRoot?.querySelector("summary");
  expect(toggle?.textContent).toContain("3 set menus");
  expect(toggle?.textContent).toContain("2 Daily menu + 1 Special menu");
  expect(toggle?.textContent).toContain("4 Starter · 1 Main or Starter · 2 Drink");
  const preview = el.shadowRoot!.querySelector("details")!;
  expect(preview.open).toBe(false);
  await userEvent.click(toggle!);
  expect(preview.open).toBe(true);
  const rows = Array.from(preview.querySelectorAll("article"), (row) => row.textContent);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("Sirloin");
  expect(rows[0]).toContain("+€5.00");
  expect(rows[1]).toContain("Open");
  expect(rows[2]).toContain("Sea bass");
  expect(rows[2]).toContain("Not sent");
});

it("cancels an empty menu but names the dishes that keep another menu on the bill", async () => {
  const { el: without } = await mount(undefined);
  without.removeMenu = undefined;
  await without.updateComplete;
  await userEvent.click(without.shadowRoot!.querySelector("summary")!);
  expect(
    Array.from(without.shadowRoot!.querySelectorAll("wt-button"), (button) =>
      button.textContent!.trim(),
    ).filter((text) => text === "Cancel"),
  ).toEqual([]);
  cleanupWidgets();

  const remove = vi.fn(async (id: string) =>
    id === "daily-1" ? "Daily menu holds Sirloin. Cancel those dishes or use Move." : undefined,
  );
  const { el } = await mount(remove);
  const toggle = el.shadowRoot?.querySelector("summary");
  expect(toggle).toBeTruthy();
  await userEvent.click(toggle!);
  const cancel = Array.from(el.shadowRoot!.querySelectorAll("wt-button")).filter((button) =>
    button.textContent!.includes("Cancel"),
  );
  await userEvent.click(cancel[1]!);
  expect(remove).toHaveBeenCalledExactlyOnceWith("daily-2");
  await userEvent.click(cancel[0]!);
  expect(el.shadowRoot!.textContent).toContain("Daily menu holds Sirloin");
  await userEvent.click(cancel[2]!);
  expect(el.shadowRoot!.textContent).toContain("Only Special menu has a place for Sea bass");
  expect(remove.mock.calls).toEqual([["daily-2"], ["daily-1"]]);
});

it("offers only open compatible move targets and shows the destination price before saving", async () => {
  const move = vi.fn<(move: DishMove) => Promise<undefined>>(async () => undefined);
  const { el } = await mount(vi.fn(), move, []);
  const root = el.shadowRoot;
  const toggle = root?.querySelector("summary");
  expect(toggle).toBeTruthy();
  await userEvent.click(toggle!);
  const moveButton = Array.from(root!.querySelectorAll("wt-button")).find((button) =>
    button.textContent!.includes("Move"),
  );
  await userEvent.click(moveButton!);
  const choices = Array.from(root!.querySelectorAll("[data-move-options] wt-button"));
  expect(choices.map((button) => button.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Daily menu 2 · Main or Starter · +€5.00",
    "Special menu 1 · Main · Included",
  ]);
  await userEvent.click(choices[1]!);
  expect(move).toHaveBeenCalledExactlyOnceWith({
    lineId: "sent-sirloin",
    to: { setMenuLineId: "special-1", place: 0 },
  });
  el.draft = [seaBass];
  await el.updateComplete;
  await userEvent.click(moveButton!);
  expect(
    Array.from(root!.querySelectorAll("[data-move-options] wt-button"), (button) =>
      button.textContent!.replace(/\s+/g, " ").trim(),
    ),
  ).toEqual(["Daily menu 2 · Main or Starter · +€5.00"]);
});

it("omits the place a dish already occupies even when it has spare capacity", async () => {
  const { el } = await mount(vi.fn(), vi.fn(), [], {
    ...bill,
    dishes: [
      {
        ...bill.dishes[0]!,
        productId: "product-soup",
        lineId: "sent-soup",
        place: 0,
        priceCents: 0,
        countsAsCourseId: "starter",
      },
    ],
  });
  const root = el.shadowRoot!;
  await userEvent.click(root.querySelector("summary")!);
  const moveButton = Array.from(root.querySelectorAll("wt-button")).find((button) =>
    button.textContent!.includes("Move"),
  );
  await userEvent.click(moveButton!);
  const labels = Array.from(root.querySelectorAll("[data-move-options] wt-button"), (button) =>
    button.textContent!.trim(),
  );
  expect(labels).toEqual([
    "Daily menu 1 · Main or Starter · Included",
    "Daily menu 2 · Starter · Included",
    "Daily menu 2 · Main or Starter · Included",
  ]);
});

it("uses the Spanish fixed-price count and the included dish tag", async () => {
  const originalLocale = currentLocale();
  try {
    setLocale("es-ES");
    const { el } = await mount();
    const root = el.shadowRoot!;
    expect(root.querySelector("summary")?.textContent).toContain(
      fill(es["set_menu.many"], { n: "3" }),
    );
    expect(root.querySelectorAll("article")[2]?.textContent).toContain(
      `Sea bass ${es["set_menu.tag"]}`,
    );
  } finally {
    setLocale(originalLocale);
  }
});

it("offers Comp on each set menu only when comping is allowed, and names that menu's line", async () => {
  const { el } = await mount();
  const root = el.shadowRoot!;
  await userEvent.click(root.querySelector("summary")!);
  expect(root.querySelector("[data-comp-menu]")).toBeNull();

  const compMenu = vi.fn();
  el.compMenu = compMenu;
  await el.updateComplete;
  const comps = Array.from(root.querySelectorAll<HTMLElement>("[data-comp-menu]"));
  expect(comps.map((button) => button.textContent!.trim())).toEqual([
    t("comp.title"),
    t("comp.title"),
    t("comp.title"),
  ]);
  expect(comps[1]!.getAttribute("aria-label")).toBe(`${t("comp.title")} · Daily menu 2`);
  await userEvent.click(comps[1]!);
  expect(compMenu).toHaveBeenCalledExactlyOnceWith("daily-2", "Daily menu 2");

  el.busy = true;
  await el.updateComplete;
  expect(
    Array.from(
      root.querySelectorAll<HTMLElement & { disabled: boolean }>("[data-comp-menu]"),
      (b) => b.disabled,
    ),
  ).toEqual([true, true, true]);
});

it.each([
  ["en-GB", "These set menus may not be the cheapest for this bill."],
  ["es-ES", es["set_menu.not_cheapest"]],
] as const)(
  "says once in %s when the bill's set menus may not be the cheapest",
  async (locale, text) => {
    const originalLocale = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mount(vi.fn(), vi.fn(), [], { ...bill, exact: false });
      const notes = Array.from(el.shadowRoot!.querySelectorAll("[data-not-cheapest]"), (note) =>
        note.textContent!.trim(),
      );
      expect(notes).toEqual([text]);
      el.bill = bill;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeNull();
      expect(el.shadowRoot!.textContent).not.toContain(text);
    } finally {
      setLocale(originalLocale);
    }
  },
);

it.each([
  ["en-GB", "Set menus might make this bill cheaper."],
  ["es-ES", es["set_menu.none_maybe_cheaper"]],
] as const)(
  "still says in %s that the bill may not be at its cheapest when the answer holds no set menus",
  async (locale, text) => {
    const originalLocale = currentLocale();
    try {
      setLocale(locale);
      const empty = { ...bill, setMenus: [], dishes: [] };
      const { el } = await mount(vi.fn(), vi.fn(), [], { ...empty, exact: false });
      const notes = Array.from(el.shadowRoot!.querySelectorAll("[data-not-cheapest]"), (note) =>
        note.textContent!.trim(),
      );
      expect(notes).toEqual([text]);
      el.bill = { ...empty, exact: true };
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeNull();
      expect(el.shadowRoot!.textContent!.trim()).toBe("");
    } finally {
      setLocale(originalLocale);
    }
  },
);
