import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { beer, browser, mount, resized, store } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { TillTenderPay } from "../widgets/tender-pay.js";

afterEach(async () => {
  cleanupWidgets();
  setLocale("en");
  await page.viewport(1280, 900);
});

const bar = (el: TillTableOrderScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-last-added]");

async function mounted(width = 390) {
  await page.viewport(width, 900);
  const result = await mount();
  result.host.style.width = "100%";
  await resized(result.el);
  return result;
}

describe("till-table-order-screen: last-added saved-line identity", () => {
  for (const locale of ["en", "es"] as const)
    for (const width of [390, 1280]) {
      it(`retains the weighed dish after a saved refresh in ${locale} at ${width}px`, async () => {
        setLocale(locale);
        const { el } = await mounted(width);
        const menu = browser(el);
        const tile = [...menu.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")].find(
          (entry) => entry.querySelector(".name")?.textContent === "Jamón",
        )!;
        await userEvent.click(tile);
        await menu.updateComplete;
        const weigh = menu.shadowRoot!.querySelector<TillTenderPay>("till-tender-pay")!;
        await weigh.updateComplete;
        weigh
          .shadowRoot!.querySelector("till-numeric-pad")!
          .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "0.375" } }));
        await weigh.updateComplete;
        await userEvent.click(weigh.shadowRoot!.querySelector<HTMLElement>("wt-button.add")!);
        await el.updateComplete;
        const draft = store(el);
        const original = draft.lines[0]!;
        original.draftLineId = "weighed-line";
        original.product = { ...original.product, name: "Jamón 1.5, 2 small" };
        expect(bar(el)?.checkVisibility()).toBe(true);
        const replacement = structuredClone(original);

        draft.loadFrom(draft.id, [replacement], undefined, 2);
        await el.updateComplete;

        expect(draft.lines[0]).not.toBe(original);
        expect(draft.lastAdded).toBe(replacement);
        expect(bar(el)?.checkVisibility()).toBe(true);
        expect(bar(el)?.textContent).toContain(locale === "es" ? "×0,375" : "×0.375");
        expect(bar(el)?.textContent).toContain("Jamón 1.5, 2 small");
        expect(bar(el)?.querySelector("[data-last-added-step]")).toBeNull();
        expect(draft.lines[0]!.quantity).toBe("0.375");
        expect(draft.lines).toEqual([replacement]);
        expect(draft.dirty).toBe(false);
      });
    }

  it("follows the saved id past a matching dish and steps only that line", async () => {
    const { el } = await mounted();
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.lines[0]!.draftLineId = "earlier-beer";
    draft.lines[0]!.noMerge = true;
    draft.addProduct(beer, "3");
    delete draft.lines[0]!.noMerge;
    draft.lines[1]!.draftLineId = "latest-beer";
    const replacement = draft.lines.map((line) => structuredClone(line));
    draft.loadFrom(draft.id, replacement);
    await el.updateComplete;

    expect(bar(el)?.textContent).toContain("Beer ×3");
    expect(draft.lastAdded).toBe(replacement[1]);
    await userEvent.click(bar(el)!.querySelector<HTMLElement>('[data-last-added-step="1"]')!);
    await el.updateComplete;
    expect(draft.lines.map((line) => [line.draftLineId, line.quantity])).toEqual([
      ["earlier-beer", "1"],
      ["latest-beer", "4"],
    ]);
    expect(bar(el)?.textContent).toContain("Beer ×4");
  });

  it("does not substitute a similar dish when the saved last-added line disappears", async () => {
    const { el } = await mounted();
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.lines[0]!.draftLineId = "removed-beer";
    draft.loadFrom(draft.id, [{ product: beer, quantity: "2", draftLineId: "other-beer" }]);
    await el.updateComplete;

    expect(draft.lastAdded).toBeUndefined();
    expect(bar(el)).toBeNull();
    expect(draft.lines.map((line) => [line.draftLineId, line.quantity])).toEqual([
      ["other-beer", "2"],
    ]);
  });

  it("keeps a saved separate line in the strip after its quantity changes", async () => {
    const { el } = await mounted();
    const draft = store(el);
    draft.addProduct(beer, "2");
    draft.lines[0]!.draftLineId = "separate-beer";
    draft.lines[0]!.noMerge = true;
    const replacement = { ...draft.lines[0]!, quantity: "3" };
    draft.loadFrom(draft.id, [replacement]);
    await el.updateComplete;

    expect(draft.lastAdded).toBe(replacement);
    expect(bar(el)?.textContent).toContain("Beer ×3");
    expect(draft.lines[0]!.noMerge).toBe(true);
  });

  it("does not invent a last tap when a draft is first read", async () => {
    const { el } = await mounted();
    const draft = store(el);
    draft.loadFrom(draft.id, [{ product: beer, quantity: "2", draftLineId: "saved-beer" }]);
    await el.updateComplete;
    expect(draft.lastAdded).toBeUndefined();
    expect(bar(el)).toBeNull();
    expect(draft.lines[0]!.quantity).toBe("2");
  });

  it("clears the last tap when another order happens to carry the same line id", async () => {
    const { el } = await mounted();
    const draft = store(el);
    draft.addProduct(beer, "1");
    draft.lines[0]!.draftLineId = "saved-beer";
    draft.loadFrom("another-order", [structuredClone(draft.lines[0]!)]);
    await el.updateComplete;
    expect(draft.lastAdded).toBeUndefined();
    expect(bar(el)).toBeNull();
    expect(draft.lines[0]!.quantity).toBe("1");
  });
});
