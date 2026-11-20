import { afterEach, describe, expect, it, vi } from "vitest";
import type { TillProduct } from "../api/client.js";
import { DraftStore } from "../state/draft-sync.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { SERVER_WAIT_NOTE_DELAY_MS, type TillBasket } from "./basket.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

const product: TillProduct = {
  id: "wait-burger",
  name: "Burger",
  unitPrice: "9.50",
  vatClass: "general",
  category: null,
  allergens: null,
  offeredModifiers: [],
};

const initialLocale = currentLocale();

afterEach(() => {
  cleanupWidgets();
  vi.useRealTimers();
  setLocale(initialLocale);
});

function note(el: TillBasket): string | null {
  return el.shadowRoot!.querySelector(".waiting")?.textContent?.trim() ?? null;
}

async function mounted(store: WorkingOrderStore) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  return el;
}

describe("the basket's waiting-for-the-server note", () => {
  it("appears only once an edit lock has lasted the delay, and goes when it ends", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(product, "1");
    const el = await mounted(store);
    const unlock = store.lockEdits();
    await el.updateComplete;
    vi.advanceTimersByTime(SERVER_WAIT_NOTE_DELAY_MS - 1);
    await el.updateComplete;
    expect(note(el)).toBeNull();
    vi.advanceTimersByTime(1);
    await el.updateComplete;
    expect(note(el)).toBe("Waiting for the server");
    expect(el.shadowRoot!.querySelector(".waiting")!.getAttribute("role")).toBe("status");
    unlock();
    await el.updateComplete;
    expect(note(el)).toBeNull();
  });

  it("shows on an empty basket, in Spanish", async () => {
    setLocale("es");
    const store = new WorkingOrderStore();
    const el = await mounted(store);
    store.lockEdits();
    vi.advanceTimersByTime(SERVER_WAIT_NOTE_DELAY_MS);
    await el.updateComplete;
    expect(note(el)).toBe("Esperando al servidor");
    expect(el.shadowRoot!.querySelector(".empty")).not.toBeNull();
  });

  it("does not restart the delay when the store changes while still locked", async () => {
    const store = new WorkingOrderStore();
    const el = await mounted(store);
    store.lockEdits();
    vi.advanceTimersByTime(SERVER_WAIT_NOTE_DELAY_MS - 100);
    store.sending = false;
    vi.advanceTimersByTime(100);
    await el.updateComplete;
    expect(note(el)).toBe("Waiting for the server");
  });

  it("stays away for a table locked only by another till or by its bill", async () => {
    const store = new DraftStore();
    store.addProduct(product, "1");
    const el = await mounted(store);
    store.ownershipLocked = true;
    store.billStatus = "placed";
    expect(store.editsLocked).toBe(true);
    vi.advanceTimersByTime(SERVER_WAIT_NOTE_DELAY_MS * 4);
    await el.updateComplete;
    expect(note(el)).toBeNull();
  });
});
