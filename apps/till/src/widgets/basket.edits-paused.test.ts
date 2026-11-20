import { afterEach, describe, expect, it, vi } from "vitest";
import type { TillProduct } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

const product: TillProduct = {
  id: "paused-burger",
  name: "Burger",
  unitPrice: "9.50",
  vatClass: "general",
  category: null,
  allergens: null,
  offeredModifiers: [],
};

const PAUSED = "This order can't be changed right now";

const initialLocale = currentLocale();

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  setLocale(initialLocale);
});

function note(el: TillBasket): string | null {
  return el.shadowRoot!.querySelector(".edits-paused")?.textContent?.trim() ?? null;
}

async function mounted(store: WorkingOrderStore) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  return el;
}

async function after(el: TillBasket, ms: number): Promise<string | null> {
  vi.advanceTimersByTime(ms);
  await el.updateComplete;
  return note(el);
}

async function swap(el: TillBasket, store: WorkingOrderStore): Promise<void> {
  el.store = store;
  await el.updateComplete;
}

describe("the basket's edits-paused note", () => {
  it("appears only once an edit lock has lasted half a second, and goes when it ends", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(product, "1");
    const el = await mounted(store);
    const unlock = store.lockEdits();
    await el.updateComplete;
    expect(await after(el, 499)).toBeNull();
    expect(await after(el, 1)).toBe(PAUSED);
    expect(el.shadowRoot!.querySelector(".edits-paused")!.getAttribute("role")).toBe("status");
    unlock();
    await el.updateComplete;
    expect(note(el)).toBeNull();
  });

  it("shows on an empty basket, in Spanish", async () => {
    setLocale("es");
    const store = new WorkingOrderStore();
    const el = await mounted(store);
    store.lockEdits();
    expect(await after(el, 500)).toBe(t("basket.edits_paused", "es"));
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
  });

  it("does not restart the delay when the store changes while still locked", async () => {
    const store = new WorkingOrderStore();
    const el = await mounted(store);
    store.lockEdits();
    vi.advanceTimersByTime(400);
    store.sending = false;
    expect(await after(el, 100)).toBe(PAUSED);
  });

  it("stays away for a table locked only by another till or by its bill", async () => {
    const store = new DraftStore();
    store.addProduct(product, "1");
    const el = await mounted(store);
    store.ownershipLocked = true;
    store.billStatus = "placed";
    expect(store.editsLocked).toBe(true);
    expect(await after(el, 2000)).toBeNull();
  });

  describe("when the basket is handed another store", () => {
    it("drops a shown note for an unlocked store", async () => {
      const locked = new WorkingOrderStore();
      const el = await mounted(locked);
      locked.lockEdits();
      expect(await after(el, 500)).toBe(PAUSED);
      await swap(el, new WorkingOrderStore());
      expect(note(el)).toBeNull();
      expect(await after(el, 2000)).toBeNull();
    });

    it("drops a pending delay for an unlocked store", async () => {
      const locked = new WorkingOrderStore();
      const el = await mounted(locked);
      locked.lockEdits();
      vi.advanceTimersByTime(300);
      await swap(el, new WorkingOrderStore());
      expect(await after(el, 2000)).toBeNull();
    });

    it("counts the delay from the swap for a store that is already locked", async () => {
      const el = await mounted(new WorkingOrderStore());
      const locked = new WorkingOrderStore();
      locked.lockEdits();
      await swap(el, locked);
      expect(await after(el, 499)).toBeNull();
      expect(await after(el, 1)).toBe(PAUSED);
    });

    it("restarts the delay when both stores are locked", async () => {
      const first = new WorkingOrderStore();
      const el = await mounted(first);
      first.lockEdits();
      vi.advanceTimersByTime(300);
      const second = new WorkingOrderStore();
      second.lockEdits();
      await swap(el, second);
      expect(await after(el, 200)).toBeNull();
      expect(await after(el, 299)).toBeNull();
      expect(await after(el, 1)).toBe(PAUSED);
    });

    it("hears a lock the new store takes after the swap, and not the old store's", async () => {
      const first = new WorkingOrderStore();
      const el = await mounted(first);
      const second = new WorkingOrderStore();
      await swap(el, second);
      first.lockEdits();
      expect(await after(el, 2000)).toBeNull();
      const unlock = second.lockEdits();
      expect(await after(el, 499)).toBeNull();
      expect(await after(el, 1)).toBe(PAUSED);
      unlock();
      await el.updateComplete;
      expect(note(el)).toBeNull();
    });

    it("times a store handed over while off the page from when the basket returns", async () => {
      const el = await mounted(new WorkingOrderStore());
      const parent = el.parentElement!;
      el.remove();
      const locked = new WorkingOrderStore();
      locked.lockEdits();
      await swap(el, locked);
      vi.advanceTimersByTime(2000);
      parent.appendChild(el);
      await el.updateComplete;
      expect(note(el)).toBeNull();
      expect(await after(el, 499)).toBeNull();
      expect(await after(el, 1)).toBe(PAUSED);
    });
  });
});
