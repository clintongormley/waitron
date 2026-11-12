import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { OfferedModifier, TillProduct } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { TillBasket } from "./basket.js";
import type { TillModifierPicker } from "./modifier-picker.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";

const options: OfferedModifier = {
  kind: "options",
  id: "doneness",
  name: "Doneness",
  customerName: { en: "Customer doneness" },
  kitchenName: "Kitchen doneness",
  defaultLabelId: null,
  labels: ["Rare", "Medium"].map((name) => ({
    id: name.toLowerCase(),
    name,
    customerName: { en: `Customer ${name}` },
    kitchenName: `Kitchen ${name}`,
    available: true,
  })),
};
const product: TillProduct = {
  id: "draft-burger",
  name: "Recorded burger",
  unitPrice: "17.25",
  vatClass: "general",
  category: null,
  allergens: null,
  offeredModifiers: [options],
};
function storeWith() {
  const store = new WorkingOrderStore();
  store.addProduct(product, "1");
  return store;
}
async function openPicker(store: WorkingOrderStore, lineDetails = false) {
  const { el } = await mountWidget<TillBasket>("till-basket", {
    store,
    lineDetails,
    courses: [{ id: "mains", name: "Mains", displayOrder: 1, heldUntilFired: true }],
  });
  const edit = el.shadowRoot!.querySelector<HTMLElement>(
    lineDetails ? "[data-line-detail]" : ".edit-modifiers",
  );
  expect(edit).not.toBeNull();
  await userEvent.click(edit!);
  await el.updateComplete;
  const picker = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
  await picker.updateComplete;
  return { el, picker };
}

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
});

describe("table line windows after editing authority changes", () => {
  async function opening() {
    const store = new DraftStore();
    store.addProduct(product, "1", {
      note: "Saved note",
      options: [{ listId: "doneness", labelId: "rare" }],
    });
    const mounted = await openPicker(store, true);
    const note = mounted.picker
      .shadowRoot!.querySelector("wt-textarea")!
      .shadowRoot!.querySelector("textarea")!;
    await userEvent.fill(note, "Unconfirmed note");
    await mounted.picker.updateComplete;
    return { ...mounted, store };
  }

  it("A738 a counter line saves quantity and note in one change", async () => {
    const store = new WorkingOrderStore();
    store.addProduct({ ...product, unitPrice: "7.50" }, "2", {
      options: [{ listId: "doneness", labelId: "rare" }],
    });
    const { el, picker } = await openPicker(store, true);
    const field = picker.shadowRoot!.querySelector('[name="quantity"]');
    expect(field).not.toBeNull();
    field!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "1" } }));
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".add-note")!);
    await picker.updateComplete;
    picker
      .shadowRoot!.querySelector("wt-textarea")!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "No salt" } }));
    await picker.updateComplete;
    const states: unknown[] = [];
    store.on("changed", () =>
      states.push({ quantity: store.lines[0]!.quantity, note: store.lines[0]!.note }),
    );
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(states).toEqual([{ quantity: "1", note: "No salt" }]);
    expect(store.lines[0]!.product.unitPrice).toBe("7.50");
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  });

  it("keeps an unconfirmed window through an ordinary availability refresh", async () => {
    const { el, store, picker } = await opening();
    store.setUnavailableOnServer([true]);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBe(picker);
    await userEvent.click(picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(store.lines[0]!.note).toBe("Unconfirmed note");
    expect(store.total).toBe("17.25");
  });

  it("leaves a counter's choice-only window disabled during its temporary read lock", async () => {
    const store = storeWith();
    const { el, picker } = await openPicker(store);
    const unlock = store.lockEdits();
    await el.updateComplete;
    await picker.updateComplete;
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBe(picker);
    expect(picker.disabled).toBe(true);
    unlock();
    await el.updateComplete;
    await picker.updateComplete;
    expect(picker.disabled).toBe(false);
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBe(picker);
  });

  for (const locale of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      it.each([390, 1280])(
        `keeps the draft editor and read-only recovery usable (${locale}, ${theme}, %s px)`,
        async (width) => {
          const priorLocale = currentLocale();
          const priorWidth = window.innerWidth;
          const priorHeight = window.innerHeight;
          setLocale(locale);
          await page.viewport(width, 900);
          try {
            const { el, store, picker } = await opening();
            el.parentElement!.setAttribute("data-theme", theme);
            el.parentElement!.style.width = "100%";
            const modal = picker.shadowRoot!.querySelector("wt-modal")!;
            await modal.updateComplete;
            const dialog = modal.shadowRoot!.querySelector("dialog")!;
            expect(window.innerWidth).toBe(width);
            expect(dialog.open).toBe(true);
            expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
            expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
            await expectNoA11yViolations(el.parentElement!);
            await page.screenshot({
              element: dialog,
              path: `__screenshots__/r3-draft-editor-${locale}-${theme}-${width}.png`,
            });
            store.ownershipLocked = true;
            await el.updateComplete;
            expect(picker.isConnected).toBe(false);
            expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
            const detail =
              el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
                "[data-line-detail]",
              )!;
            await detail.updateComplete;
            expect(detail.shadowRoot!.querySelector("button")!.disabled).toBe(true);
            expect(el.shadowRoot!.textContent).toContain("Recorded burger");
            expect(el.shadowRoot!.textContent).toContain("Saved note");
            await expectNoA11yViolations(el.parentElement!);
            await page.screenshot({
              element: el,
              path: `__screenshots__/r3-draft-readonly-${locale}-${theme}-${width}.png`,
            });
          } finally {
            cleanupWidgets();
            setLocale(priorLocale);
            await page.viewport(priorWidth, priorHeight);
          }
        },
      );

  it("closes the draft line window when ownership becomes read-only", async () => {
    const { el, store } = await opening();
    store.ownershipLocked = true;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
    expect(store.lines[0]!.note).toBe("Saved note");
    expect(store.editsLocked).toBe(true);
  });

  it("does not revive the old draft confirmation after taking the bill back", async () => {
    const { el, store, picker } = await opening();
    const oldConfirm = picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!;
    store.ownershipLocked = true;
    await el.updateComplete;
    store.ownershipLocked = false;
    await el.updateComplete;
    oldConfirm.click();
    await el.updateComplete;
    expect(store.lines[0]!.note).toBe("Saved note");
    expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-line-detail]")!);
    await el.updateComplete;
    const reopened = el.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker")!;
    await reopened.updateComplete;
    const note = reopened
      .shadowRoot!.querySelector("wt-textarea")!
      .shadowRoot!.querySelector("textarea")!;
    expect(note.value).toBe("Saved note");
    await userEvent.fill(note, "Reviewed note");
    await reopened.updateComplete;
    await userEvent.click(reopened.shadowRoot!.querySelector<HTMLElement>(".confirm")!);
    await el.updateComplete;
    expect(store.lines[0]!.note).toBe("Reviewed note");
  });
});
