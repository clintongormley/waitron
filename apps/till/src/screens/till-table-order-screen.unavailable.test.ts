import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { OrderLine } from "../state/working-order.js";
import type { SubmitDraftDetail, TillTableOrderScreen } from "./till-table-order-screen.js";
import { beer, flan, mount, resized, rows, store } from "./till-table-order-screen.test-helpers.js";

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

/** A dish the table's menu no longer offers, rebuilt from the server with no name and no unit. */
const standIn = (quantity: string): OrderLine => ({
  product: {
    ...beer,
    id: "gone",
    menuItemId: "offer-gone",
    name: "",
    available: false,
    unit: { id: "", name: {}, abbreviation: {}, precision: 3, hardwareUnit: null },
  },
  quantity,
  notOffered: true,
  blocked: "removed",
});

/** A 1280 px screen whose draft holds `lines`. */
async function holding(lines: OrderLine[], over: Partial<TillTableOrderScreen> = {}) {
  const mounted = await mount(over);
  mounted.host.style.width = "1280px";
  await resized(mounted.el);
  store(mounted.el).loadFrom(store(mounted.el).id, lines);
  await settled(mounted.el);
  return mounted;
}

async function settled(el: TillTableOrderScreen): Promise<void> {
  await el.updateComplete;
  for (const basket of el.shadowRoot!.querySelectorAll<
    HTMLElement & { updateComplete: Promise<unknown> }
  >("till-basket"))
    await basket.updateComplete;
}

/** The text of each shown draft row, as its basket renders it. */
const rowTexts = (el: TillTableOrderScreen) =>
  [...el.shadowRoot!.querySelectorAll("till-basket")].flatMap((basket) =>
    [...basket.shadowRoot!.querySelectorAll(".line .name")].map((name) => {
      const lead = name.querySelector("slot")!.assignedElements()[0];
      const markers = [...name.querySelectorAll(".not-offered")].map((each) => each.textContent);
      const shown = lead?.querySelector(".draft-line-name")?.textContent;
      return [shown?.replace(/\s+/g, " ").trim(), ...markers].join(" | ");
    }),
  );
const removeButton = (el: TillTableOrderScreen, index: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-flag-remove="${index}"]`);
const keepButton = (el: TillTableOrderScreen, index: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-flag-keep="${index}"]`);
const previewDialog = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("[data-draft-preview]")!;
const previewText = (el: TillTableOrderScreen) =>
  previewDialog(el).querySelector("[data-preview-body]")!.textContent!.replace(/\s+/g, " ").trim();

async function press(el: TillTableOrderScreen, action: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-draft-action="${action}"]`)!.click();
  await settled(el);
}

/** Confirms the open preview and answers with what it sent. */
async function confirmed(el: TillTableOrderScreen): Promise<SubmitDraftDetail> {
  let detail: SubmitDraftDetail | undefined;
  el.addEventListener(
    "submit-draft",
    (event) => (detail = (event as CustomEvent<SubmitDraftDetail>).detail),
    { once: true },
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-draft-confirm]")!.click();
  await settled(el);
  return detail!;
}

describe("till-table-order-screen: a draft line that cannot be sold now", () => {
  it("flags a line the server alone says cannot be sold, in words, and offers Remove and Keep", async () => {
    const { el } = await holding([
      { product: beer, quantity: "2", unavailableOnServer: true },
      { product: flan, quantity: "1" },
    ]);

    expect(rowTexts(el)).toEqual([`Beer ×2 | ${t("basket.blocked.server")}`, "Flan ×1"]);
    expect(removeButton(el, 0)!.textContent!.trim()).toBe(t("action.remove"));
    expect(removeButton(el, 0)!.getAttribute("aria-label")).toBe(`${t("action.remove")} · Beer`);
    expect(keepButton(el, 0)!.getAttribute("aria-label")).toBe(`${t("table.flag_keep")} · Beer`);
    expect(removeButton(el, 1)).toBeNull();
    expect(keepButton(el, 1)).toBeNull();
  });

  it("flags a line the till's own check marks, with the reason it knows", async () => {
    const { el } = await holding([
      { product: beer, quantity: "1" },
      { product: flan, quantity: "1", blocked: "unavailable" },
    ]);

    expect(rowTexts(el)).toEqual(["Beer ×1", `Flan ×1 | ${t("basket.blocked.unavailable")}`]);
    expect(removeButton(el, 1)).not.toBeNull();
    expect(keepButton(el, 1)).not.toBeNull();
  });

  it("gives Remove and Keep a tap target of 44 px each way", async () => {
    const { el } = await holding([{ product: beer, quantity: "1", unavailableOnServer: true }]);
    for (const button of [removeButton(el, 0)!, keepButton(el, 0)!]) {
      const box = button.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  it("takes the line out of the draft on Remove", async () => {
    const { el } = await holding([
      { product: beer, quantity: "1" },
      { product: flan, quantity: "1", blocked: "unavailable" },
    ]);

    removeButton(el, 1)!.click();
    await settled(el);

    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(store(el).dirty).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("#draft-title"));
  });

  it("keeps the line in the draft, still flagged, on Keep, and says it stays", async () => {
    const { el } = await holding([{ product: beer, quantity: "1", unavailableOnServer: true }]);

    keepButton(el, 0)!.click();
    await settled(el);

    expect(rows(el)).toEqual(["Beer ×1"]);
    expect(rowTexts(el)).toEqual([`Beer ×1 | ${t("basket.blocked.server")}`]);
    expect(removeButton(el, 0)).toBeNull();
    expect(keepButton(el, 0)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-flag-kept]")!.textContent!.trim()).toBe(
      t("table.flag_kept"),
    );
    expect(el.shadowRoot!.activeElement).toBe(
      el.shadowRoot!.querySelector('[data-draft-select="0"]'),
    );
  });

  it("keeps Remove and Keep off while a send is out", async () => {
    const { el } = await holding([{ product: beer, quantity: "1", unavailableOnServer: true }]);
    const off = () =>
      [removeButton(el, 0)!, keepButton(el, 0)!].map(
        (button) => (button as HTMLElement & { disabled: boolean }).disabled,
      );
    expect(off()).toEqual([false, false]);

    store(el).sending = true;
    await settled(el);

    expect(off()).toEqual([true, true]);
  });

  it("keeps Remove and Keep off while a take-over is out", async () => {
    const { el } = await holding([{ product: beer, quantity: "1", unavailableOnServer: true }], {
      otherDrafts: [
        {
          id: "draft-alex",
          revision: 1,
          ownerName: "Alex",
          takenFromYou: false,
          lines: [{ product: flan, quantity: "1" }],
        },
      ],
    });
    el.shadowRoot!.querySelector<HTMLElement>("[data-take-over]")!.click();
    await settled(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-take-over-confirm]")!.click();
    await settled(el);

    for (const button of [removeButton(el, 0)!, keepButton(el, 0)!])
      expect((button as HTMLElement & { disabled: boolean }).disabled).toBe(true);
  });

  it("drops the flag, and the choice, once the line can be sold again", async () => {
    const { el } = await holding([{ product: flan, quantity: "1", blocked: "unavailable" }]);

    store(el).setBlocked([undefined]);
    await settled(el);

    expect(rowTexts(el)).toEqual(["Flan ×1"]);
    expect(removeButton(el, 0)).toBeNull();
  });
});

describe("till-table-order-screen: sending a draft with a flagged line", () => {
  it("leaves the flagged line out of Send all, and its preview names it before anything is sent", async () => {
    const { el } = await holding([
      { product: beer, quantity: "2", unavailableOnServer: true },
      { product: flan, quantity: "1" },
    ]);

    await press(el, "send-all");

    expect(previewDialog(el).open).toBe(true);
    expect(previewText(el)).toContain(t("table.left_out_one").replace("{names}", "Beer ×2"));
    const sent = await confirmed(el);
    expect(sent.sent.map((line) => line.product.name)).toEqual(["Flan"]);
    expect(sent.groups).toEqual([{ release: "hold", lineIndexes: [0] }]);
  });

  it("leaves it out of Fire all now the same way", async () => {
    const { el } = await holding([
      { product: beer, quantity: "1" },
      { product: flan, quantity: "1", blocked: "unavailable" },
    ]);

    await press(el, "fire-all");

    expect(previewText(el)).toContain(t("table.left_out_one").replace("{names}", "Flan ×1"));
    expect((await confirmed(el)).sent.map((line) => line.product.name)).toEqual(["Beer"]);
  });

  it("leaves a ticked flagged line out of Send selected", async () => {
    const { el } = await holding([
      { product: beer, quantity: "1", unavailableOnServer: true },
      { product: flan, quantity: "1" },
    ]);
    for (const index of [0, 1])
      el.shadowRoot!.querySelector<HTMLElement>(`[data-draft-select="${index}"]`)!.click();
    await settled(el);

    await press(el, "send-selected");

    expect(previewText(el)).toContain(t("table.left_out_one").replace("{names}", "Beer ×1"));
    expect((await confirmed(el)).sent.map((line) => line.product.name)).toEqual(["Flan"]);
  });

  it("keeps each named line's name and count together, so a narrow screen never breaks between them", async () => {
    const { el } = await holding([
      { product: beer, quantity: "2", unavailableOnServer: true },
      { product: flan, quantity: "1" },
    ]);

    await press(el, "send-all");

    expect(el.shadowRoot!.querySelector("[data-preview-left-out]")!.textContent).toContain(
      "Beer\u00a0×2",
    );
  });

  it("names how many, and not which, when more than three are left out", async () => {
    const { el } = await holding([
      ...["1", "2", "3", "4"].map((quantity) => ({
        product: beer,
        quantity,
        noMerge: true as const,
        unavailableOnServer: true as const,
      })),
      { product: flan, quantity: "1" },
    ]);

    await press(el, "fire-all");

    expect(previewText(el)).toContain(t("table.left_out_unnamed").replace("{n}", "4"));
    expect(previewText(el)).not.toContain("Beer");
  });

  it("sends nothing when every line is flagged, and says why, with no Confirm", async () => {
    const { el } = await holding([
      { product: beer, quantity: "1", unavailableOnServer: true },
      { product: flan, quantity: "1", blocked: "unavailable" },
    ]);

    await press(el, "send-all");

    expect(previewText(el)).toBe(
      `${t("table.nothing_sent")} ${t("table.left_out").replace("{n}", "2").replace("{names}", "Beer ×1, Flan ×1")}`,
    );
    expect(el.shadowRoot!.querySelector("[data-draft-confirm]")).toBeNull();
  });
});

describe("till-table-order-screen: a dish no longer offered at all", () => {
  it("shows its quantity as the server holds it, and counts a whole quantity on Review by its count", async () => {
    const { el, host } = await mount();
    host.style.width = "390px";
    await resized(el);
    store(el).loadFrom(store(el).id, [{ product: beer, quantity: "1" }, standIn("2")]);
    await settled(el);

    expect(el.shadowRoot!.querySelector("[data-review-open]")!.textContent!.trim()).toBe(
      t("table.review").replace("{n}", "3"),
    );
    const quantities = [...el.shadowRoot!.querySelectorAll("till-basket")].flatMap((basket) =>
      [...basket.shadowRoot!.querySelectorAll(".qty")].map((qty) => qty.textContent),
    );
    expect(quantities.at(-1)).toBe("2");
  });
});
