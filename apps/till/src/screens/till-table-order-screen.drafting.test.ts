import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillProduct } from "../api/client.js";
import {
  beer,
  browser,
  flan,
  jamon,
  menuOf,
  mount,
  rows,
  store,
  tap,
} from "./till-table-order-screen.test-helpers.js";

const bar = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-last-added]");
const barText = (el: TillTableOrderScreen) => bar(el)!.textContent!.replace(/\s+/g, " ").trim();

async function step(el: TillTableOrderScreen, by: "-1" | "1"): Promise<void> {
  bar(el)!.querySelector<HTMLElement>(`[data-last-added-step="${by}"]`)!.click();
  await el.updateComplete;
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-table-order-screen: the last-added bar", () => {
  it("shows three taps on Beer as Beer ×3, and +1 makes it 4", async () => {
    const { el } = await mount();
    expect(bar(el)).toBeNull();
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(barText(el)).toContain("Beer ×3");

    await step(el, "1");

    expect(barText(el)).toContain("Beer ×4");
    expect(rows(el)).toEqual(["Beer ×4"]);
  });

  it("shows the line the latest tap grew, not the one tapped before it", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    await tap(el, "Flan");
    expect(barText(el)).toContain("Flan ×1");
    await tap(el, "Beer");
    expect(barText(el)).toContain("Beer ×2");
    expect(barText(el)).not.toContain("Flan");
  });

  it("takes one off with −1, and at 1 removes the line and shows nothing", async () => {
    const { el } = await mount();
    await tap(el, "Flan");
    await tap(el, "Beer");
    await tap(el, "Beer");
    await step(el, "-1");
    expect(barText(el)).toContain("Beer ×1");
    expect(rows(el)).toEqual(["Flan ×1", "Beer ×1"]);

    await step(el, "-1");

    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(bar(el)).toBeNull();
  });

  it("gives its −1 and +1 a tap target of 44 px each way, and names the dish they change", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    for (const by of ["-1", "1"]) {
      const control = bar(el)!.querySelector<HTMLElement>(`[data-last-added-step="${by}"]`)!;
      const inner = control.shadowRoot!.querySelector("button")!;
      const box = inner.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(inner.getAttribute("aria-label")).toContain("Beer");
    }
  });

  it("opens a dish with choices in its customisation first, and shows what was chosen once it is added", async () => {
    const { el } = await mount();
    await tap(el, "Burger");
    expect(rows(el)).toEqual([]);
    const picker = browser(el).shadowRoot!.querySelector<HTMLElement>("till-modifier-picker")!;
    await (picker as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
    await el.updateComplete;

    expect(rows(el)).toEqual(["Burger ×1"]);
    expect(barText(el)).toContain("Burger ×1");
    expect(barText(el)).toContain("Medium");
    expect(barText(el)).toContain("Bacon");
  });

  it("shows a line's note", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    store(el).setLineExtras(0, { note: "no glass" });
    await el.updateComplete;
    expect(barText(el)).toContain("no glass");
  });

  it("asks a weighed dish's weight and adds what is entered, with no ±1", async () => {
    const { el } = await mount();
    await tap(el, "Jamón");
    expect(rows(el)).toEqual([]);
    const weigh = browser(el).shadowRoot!.querySelector<HTMLElement>("till-tender-pay")!;
    await (weigh as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const pad = weigh.shadowRoot!.querySelector<HTMLElement>("till-numeric-pad")!;
    pad.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "0.25" } }));
    await (weigh as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

    weigh.shadowRoot!.querySelector<HTMLElement>("wt-button.add")!.click();
    await el.updateComplete;

    expect(rows(el)).toEqual(["Jamón ×0.25"]);
    expect(barText(el)).toContain("Jamón");
    expect(bar(el)!.querySelector("[data-last-added-step]")).toBeNull();
  });

  it("shows no weighing prompt until a weighed dish is tapped", async () => {
    const { el } = await mount();
    const weigh = browser(el).shadowRoot!.querySelector<HTMLElement>("till-tender-pay");
    expect(weigh?.shadowRoot?.textContent?.trim() ?? "").toBe("");
  });
});

describe("till-table-order-screen: one view of the draft", () => {
  it("shows each line once, in its course section, with its quantity, note and remove", async () => {
    const byCourse = [
      { ...beer, courseId: "drinks" },
      { ...flan, courseId: "desserts" },
    ];
    const { el } = await mount({
      products: byCourse,
      menus: menuOf(byCourse),
      courses: [
        { id: "drinks", name: "Drinks", displayOrder: 0 },
        { id: "desserts", name: "Desserts", displayOrder: 1 },
      ],
    });
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Flan");
    const baskets = [...el.shadowRoot!.querySelectorAll("till-basket")];
    const shownLines = baskets.flatMap((basket) => [
      ...basket.shadowRoot!.querySelectorAll(".line"),
    ]);
    expect(baskets.length).toBe(2);
    expect(shownLines.length).toBe(2);
    expect(baskets.map((basket) => basket.closest("[data-draft-section]") !== null)).toEqual(
      baskets.map(() => true),
    );
    const first = baskets[0]!.shadowRoot!;
    expect(first.querySelector(".step-inc")).not.toBeNull();
    expect(first.querySelector(".note-toggle")).not.toBeNull();
    expect(first.querySelector(".remove")).not.toBeNull();

    first.querySelector<HTMLElement>(".step-inc")!.click();
    await el.updateComplete;
    expect(rows(el)).toEqual(["Beer ×3", "Flan ×1"]);
    first.querySelector<HTMLElement>(".remove")!.click();
    await el.updateComplete;
    expect(rows(el)).toEqual(["Flan ×1"]);
  });
});

describe("till-table-order-screen: Split quantity on a draft line", () => {
  const split = (el: TillTableOrderScreen, index: number) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-split-draft-line="${index}"]`);

  it("turns Beer ×3 into three rows that a further tap does not regroup", async () => {
    const { el } = await mount();
    await tap(el, "Beer");
    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(split(el, 0)!.getAttribute("aria-label")).toBe(`${t("table.split_group_line")} · Beer`);

    split(el, 0)!.click();
    await el.updateComplete;
    expect(rows(el)).toEqual(["Beer ×1 apart", "Beer ×1 apart", "Beer ×1 apart"]);
    expect(el.shadowRoot!.querySelectorAll("[data-draft-select]").length).toBe(3);

    await tap(el, "Beer");
    await tap(el, "Beer");
    expect(rows(el)).toEqual(["Beer ×1 apart", "Beer ×1 apart", "Beer ×1 apart", "Beer ×2"]);
  });

  it("is offered only on a line of more than one whole unit", async () => {
    const { el } = await mount();
    await tap(el, "Flan");
    store(el).addProduct(jamon, "2");
    await el.updateComplete;
    expect(split(el, 0)).toBeNull();
    expect(split(el, 1)).toBeNull();
  });
});

describe("till-table-order-screen: a note being written while other lines move", () => {
  const cola: TillProduct = {
    ...beer,
    id: "cola",
    menuItemId: "offer-cola",
    name: "Cola",
    courseId: "drinks",
  };
  const byCourse = [{ ...flan, courseId: "desserts" }, cola, { ...beer, courseId: "drinks" }];
  const courses = [
    { id: "drinks", name: "Drinks", displayOrder: 0 },
    { id: "desserts", name: "Desserts", displayOrder: 1 },
  ];

  /** Flan, Cola, Beer, and Cola's note editor open, holding "no ice". */
  async function writingColasNote(): Promise<TillTableOrderScreen> {
    const { el } = await mount({ products: byCourse, menus: menuOf(byCourse), courses });
    await tap(el, "Flan");
    await tap(el, "Cola");
    await tap(el, "Beer");
    store(el).setLineExtras(1, { note: "no ice" });
    await el.updateComplete;
    noteButton(el, "Cola").click();
    await settle(el);
    expect(openNote(el)).toEqual({ dish: "Cola", note: "no ice" });
    return el;
  }

  function noteButton(el: TillTableOrderScreen, dish: string): HTMLElement {
    return [...el.shadowRoot!.querySelectorAll("till-basket")]
      .flatMap((basket) => [...basket.shadowRoot!.querySelectorAll<HTMLElement>(".note-toggle")])
      .find((button) => button.getAttribute("aria-label")!.endsWith(dish))!;
  }

  /** The dish whose row the open note editor sits under, and what the editor holds. */
  function openNote(el: TillTableOrderScreen): { dish: string; note: string } | null {
    for (const basket of el.shadowRoot!.querySelectorAll("till-basket")) {
      const editor =
        basket.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-test="line-note"]');
      if (editor === null) continue;
      const open = basket.shadowRoot!.querySelector('.note-toggle[aria-expanded="true"]')!;
      return {
        dish: open.getAttribute("aria-label")!.split(" ").at(-1)!,
        note: editor.value,
      };
    }
    return null;
  }

  async function settle(el: TillTableOrderScreen): Promise<void> {
    for (const basket of el.shadowRoot!.querySelectorAll<
      HTMLElement & { updateComplete: Promise<unknown> }
    >("till-basket"))
      await basket.updateComplete;
    await el.updateComplete;
  }

  it("stays under its dish when a line in another section is removed", async () => {
    const el = await writingColasNote();
    const flanRemove = [...el.shadowRoot!.querySelectorAll("till-basket")]
      .flatMap((basket) => [...basket.shadowRoot!.querySelectorAll<HTMLElement>(".remove")])
      .find((button) => button.getAttribute("aria-label")!.endsWith("Flan"))!;

    flanRemove.click();
    await settle(el);

    expect(rows(el)).toEqual(["Cola ×1", "Beer ×1"]);
    expect(openNote(el)).toEqual({ dish: "Cola", note: "no ice" });
  });

  it("stays open under its dish when the section above it empties", async () => {
    const { el } = await mount({ products: byCourse, menus: menuOf(byCourse), courses });
    await tap(el, "Flan");
    await tap(el, "Cola");
    store(el).setLineExtras(0, { note: "no cream" });
    await el.updateComplete;
    noteButton(el, "Flan").click();
    await settle(el);
    expect(openNote(el)).toEqual({ dish: "Flan", note: "no cream" });

    store(el).removeLine(1);
    await settle(el);

    expect(rows(el)).toEqual(["Flan ×1"]);
    expect(openNote(el)).toEqual({ dish: "Flan", note: "no cream" });
  });

  it("stays under its dish when the last-added bar's −1 takes an earlier line out", async () => {
    const el = await writingColasNote();
    await tap(el, "Flan");
    await settle(el);
    expect(openNote(el)).toEqual({ dish: "Cola", note: "no ice" });

    for (let press = 0; press < 2; press++) {
      el.shadowRoot!.querySelector<HTMLElement>('[data-last-added-step="-1"]')!.click();
      await settle(el);
    }

    expect(rows(el)).toEqual(["Cola ×1", "Beer ×1"]);
    expect(openNote(el)).toEqual({ dish: "Cola", note: "no ice" });
  });
});
