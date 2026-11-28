import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtStepper } from "@waitron/ui";
import { DraftStore, DraftSync } from "../state/draft-sync.js";
import type { TillBasket } from "../widgets/basket.js";
import type { TillModifierPicker } from "../widgets/modifier-picker.js";
import { cleanupWidgets, draftServer } from "../widgets/test-helpers.js";
import { en, es } from "../i18n/strings.js";
import { fill, setLocale } from "../i18n/t.js";
import {
  beer,
  burger,
  flan,
  ham,
  menuOf,
  mount,
  resized,
  scrollSettled,
  showView,
  shownView,
} from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";
import type { OrderLine } from "../state/working-order.js";

beforeEach(async () => {
  setLocale("en");
  await page.viewport(1280, 1800);
});
afterEach(() => {
  vi.useRealTimers();
  cleanupWidgets();
});

async function open(lines: OrderLine[] = []) {
  const draft = new DraftStore();
  draft.loadFrom(
    "draft",
    lines.length > 0
      ? lines
      : [
          { product: beer, quantity: "2", place: { kind: "fire" } },
          { product: flan, quantity: "1", place: { kind: "new", slot: 1 } },
        ],
  );
  const { el } = await mount({ draftStore: draft });
  el.style.width = "1280px";
  await resized(el);
  await settled(el);
  return { el, draft };
}

async function settled(el: TillTableOrderScreen) {
  await el.updateComplete;
  for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket"))
    await basket.updateComplete;
}

const basketOf = (el: TillTableOrderScreen, index: number) =>
  [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find((basket) =>
    basket.lineIndexes?.includes(index),
  )!;
const row = (el: TillTableOrderScreen, index: number) =>
  basketOf(el, index).shadowRoot!.querySelector<HTMLButtonElement>(`[data-draft-row="${index}"]`)!;
const controls = (el: TillTableOrderScreen, index: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-draft-open="${index}"]`);
const stepper = (el: TillTableOrderScreen, index: number) =>
  controls(el, index)?.querySelector<WtStepper>("wt-stepper") ?? null;
const step = (el: TillTableOrderScreen, index: number, delta: -1 | 1) =>
  stepper(el, index)!.shadowRoot!.querySelector<HTMLButtonElement>(`[data-step="${delta}"]`)!;
const bin = (el: TillTableOrderScreen, index: number) =>
  stepper(el, index)!.shadowRoot!.querySelector<HTMLButtonElement>("[data-remove]");
const options = (el: TillTableOrderScreen, index: number) =>
  controls(el, index)!.querySelector<HTMLButtonElement>("[data-draft-open-options]")!;
const note = (el: TillTableOrderScreen, index: number) =>
  controls(el, index)!.querySelector<HTMLButtonElement>("[data-draft-open-note]")!;
const picker = (el: TillTableOrderScreen, index: number) =>
  basketOf(el, index).shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");

async function tapRow(el: TillTableOrderScreen, index: number) {
  await userEvent.click(row(el, index));
  await settled(el);
  await stepper(el, index)?.updateComplete;
}

it("a tap opens the row in place with a stepper, Options and Note, and a second tap closes it", async () => {
  const { el } = await open();
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("false");
  expect(controls(el, 0)).toBeNull();
  await tapRow(el, 0);
  const entry = row(el, 0).closest(".entry")!;
  expect(entry.hasAttribute("data-open")).toBe(true);
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("true");
  expect(controls(el, 0)!.slot).toBe("opened-0");
  expect(controls(el, 0)!.assignedSlot?.name).toBe("opened-0");
  expect(stepper(el, 0)!.value).toBe(2);
  expect(options(el, 0).textContent!.trim()).toBe("Options");
  expect(note(el, 0).textContent!.trim()).toBe("Note");
  expect(picker(el, 0)).toBeNull();
  await tapRow(el, 0);
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("false");
  expect(row(el, 0).closest(".entry")!.hasAttribute("data-open")).toBe(false);
  expect(controls(el, 0)).toBeNull();
  expect(picker(el, 0)).toBeNull();
});

it("opening another row closes the first", async () => {
  const { el } = await open();
  await tapRow(el, 0);
  await tapRow(el, 1);
  expect(controls(el, 0)).toBeNull();
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("false");
  expect(controls(el, 1)).not.toBeNull();
  expect(row(el, 1).getAttribute("aria-expanded")).toBe("true");
});

it("+ and − change the dish's count, its row's price and the order total at once, leaving the draft unsaved", async () => {
  const { el, draft } = await open();
  const total = () =>
    el.shadowRoot!.querySelector("[data-order-total]")!.textContent!.replace(/\s/g, "");
  const price = () => row(el, 0).querySelector(".row-price")!.textContent!.trim();
  expect(price()).toBe("€6.00");
  expect(total()).toBe("€9.00");
  await tapRow(el, 0);
  expect(draft.dirty).toBe(false);
  await userEvent.click(step(el, 0, 1));
  await settled(el);
  expect(draft.lines[0]!.quantity).toBe("3");
  expect(draft.dirty).toBe(true);
  expect(price()).toBe("€9.00");
  expect(total()).toBe("€12.00");
  expect(stepper(el, 0)!.value).toBe(3);
  await userEvent.click(step(el, 0, -1));
  await userEvent.click(step(el, 0, -1));
  await settled(el);
  await stepper(el, 0)!.updateComplete;
  expect(draft.lines[0]!.quantity).toBe("1");
  expect(price()).toBe("€3.00");
  expect(total()).toBe("€6.00");
  expect(stepper(el, 0)!.shadowRoot!.querySelector('[data-step="-1"]')).toBeNull();
  expect(bin(el, 0)!.disabled).toBe(false);
  expect(step(el, 0, 1).disabled).toBe(false);
  expect(controls(el, 0)).not.toBeNull();
});

describe("the bin in −'s place at a count of 1", () => {
  it("is named Remove <dish>; a row of 2 has − instead", async () => {
    const { el } = await open();
    await tapRow(el, 1);
    expect(bin(el, 1)!.getAttribute("aria-label")).toBe("Remove Flan");
    await tapRow(el, 0);
    expect(bin(el, 0)).toBeNull();
    expect(step(el, 0, -1).disabled).toBe(false);
    expect(step(el, 0, -1).getAttribute("aria-label")).toBe("Decrease Beer");
  });

  it("is named in Spanish", async () => {
    setLocale("es");
    const { el } = await open();
    await tapRow(el, 1);
    expect(es["action.remove_named"]).not.toBe(en["action.remove_named"]);
    expect(bin(el, 1)!.getAttribute("aria-label")).toBe(
      fill(es["action.remove_named"], { label: "Flan" }),
    );
  });

  it("removes the dish as the draft bar's Remove does: its tick goes and focus moves to the order's heading", async () => {
    const { el, draft } = await open();
    const select = el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="1"]')!;
    await userEvent.click(select);
    await settled(el);
    const remove = () => el.shadowRoot!.querySelector<HTMLElement>("[data-draft-remove]")!;
    expect(remove().hasAttribute("disabled")).toBe(false);
    await tapRow(el, 1);
    await userEvent.click(bin(el, 1)!);
    await settled(el);
    expect(draft.lines.map((line) => line.product.id)).toEqual(["beer"]);
    expect(draft.dirty).toBe(true);
    expect(controls(el, 1)).toBeNull();
    expect(remove().hasAttribute("disabled")).toBe(true);
    expect(el.shadowRoot!.activeElement?.id).toBe("draft-title");
  });

  it("a bin pressed after the count rose to 2, before the redraw, leaves the dish", async () => {
    const { el, draft } = await open();
    await tapRow(el, 1);
    const shown = bin(el, 1)!;
    draft.setLineQuantity(1, "2");
    shown.click();
    await settled(el);
    expect(draft.lines.map((line) => [line.product.id, line.quantity])).toEqual([
      ["beer", "2"],
      ["flan", "2"],
    ]);
    expect(controls(el, 1)).not.toBeNull();
  });

  it("is not offered while Remove would refuse, and a press Remove refuses leaves the dish", async () => {
    const { el, draft } = await open();
    await tapRow(el, 1);
    const shown = stepper(el, 1)!;
    el.draftActionsAllowed = false;
    shown.dispatchEvent(
      new CustomEvent("wt-remove", { detail: { value: 1 }, bubbles: true, composed: true }),
    );
    await settled(el);
    await shown.updateComplete;
    expect(draft.lines.map((line) => line.product.id)).toEqual(["beer", "flan"]);
    expect(bin(el, 1)).toBeNull();
    expect(step(el, 1, -1).disabled).toBe(true);
  });
});

it("a dish's name reaches the stepper's button names unchanged", async () => {
  const { el } = await open([
    { product: { ...beer, name: "Fish $& chips $'" }, quantity: "2", place: { kind: "fire" } },
  ]);
  await tapRow(el, 0);
  expect(step(el, 0, 1).getAttribute("aria-label")).toBe("Increase Fish $& chips $'");
  expect(step(el, 0, -1).getAttribute("aria-label")).toBe("Decrease Fish $& chips $'");
});

it("a step pressed while the draft is saving reaches the server in the next save", async () => {
  const server = draftServer();
  const sync = new DraftSync({
    api: server,
    partyId: "v1",
    billId: "wo-4",
    personId: "p1",
    rebuild: (lines) =>
      lines.map((line) => ({ product: beer, quantity: line.quantity.replace(/\.0+$/, "") })),
    onRefused: () => {},
    requestLimitMs: 5_000,
  });
  await sync.load();
  const save = server.saveDraft.getMockImplementation()!;
  let release!: () => void;
  server.saveDraft.mockImplementationOnce(async (...args) => {
    const answer = await save(...args);
    await new Promise<void>((resolve) => (release = resolve));
    return answer;
  });
  sync.store.addProduct(beer, "2");
  await vi.waitFor(() => expect(server.saveDraft).toHaveBeenCalledOnce());
  const { el } = await mount({ draftStore: sync.store });
  el.style.width = "1280px";
  await resized(el);
  await settled(el);
  await tapRow(el, 0);
  await userEvent.click(step(el, 0, 1));
  await settled(el);
  expect(sync.store.lines[0]!.quantity).toBe("3");
  expect(controls(el, 0)).not.toBeNull();
  release();
  await vi.waitFor(() => expect(server.saveDraft).toHaveBeenCalledTimes(2));
  expect(server.saveDraft.mock.calls[0]![1].lines[0]!.quantity).toBe("2");
  expect(server.saveDraft.mock.calls[1]![1].lines[0]!.quantity).toBe("3");
});

it("+ is disabled when the dish cannot be added", async () => {
  const { el } = await open();
  el.productSelectable = (product) => product.id !== "beer";
  await settled(el);
  await tapRow(el, 0);
  expect(step(el, 0, 1).disabled).toBe(true);
  expect(step(el, 0, -1).disabled).toBe(false);
  await tapRow(el, 1);
  expect(step(el, 1, 1).disabled).toBe(false);
});

it("+ is disabled on a dish holding a pick the menu no longer offers", async () => {
  const { el } = await open([
    {
      product: burger,
      quantity: "1",
      place: { kind: "fire" },
      notOfferedExtras: [
        { listId: "list-gone", productId: "p-gone", name: "Gone", quantity: 1, price: "1.00" },
      ],
    } as OrderLine,
  ]);
  await tapRow(el, 0);
  expect(step(el, 0, 1).disabled).toBe(true);
});

it("a weighed dish and a set-menu dish get Options and Note but no stepper", async () => {
  const { el } = await open([
    { product: ham, quantity: "0.250", place: { kind: "fire" } },
    { product: flan, quantity: "1", place: { kind: "fire" }, setMenuId: "daily" },
  ]);
  for (const index of [0, 1]) {
    await tapRow(el, index);
    expect(controls(el, index)).not.toBeNull();
    expect(stepper(el, index)).toBeNull();
    expect(options(el, index)).not.toBeNull();
    expect(note(el, index)).not.toBeNull();
  }
});

it("Options opens the dish's details, and Note opens them with focus in the note field", async () => {
  const { el } = await open();
  await tapRow(el, 0);
  await userEvent.click(options(el, 0));
  await settled(el);
  let details = picker(el, 0)!;
  expect(details).not.toBeNull();
  await details.updateComplete;
  expect(details.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Beer");
  expect(details.shadowRoot!.activeElement?.localName).not.toBe("wt-textarea");
  await userEvent.click(details.shadowRoot!.querySelector<HTMLElement>(".cancel")!);
  await settled(el);
  expect(picker(el, 0)).toBeNull();
  await userEvent.click(note(el, 0));
  await settled(el);
  details = picker(el, 0)!;
  await vi.waitFor(() => expect(details.shadowRoot!.activeElement?.localName).toBe("wt-textarea"));
});

it.each(["sending", "locked", "in flight"] as const)(
  "the opened row closes while %s",
  async (state) => {
    const { el, draft } = await open();
    await tapRow(el, 0);
    expect(controls(el, 0)).not.toBeNull();
    if (state === "sending") draft.sending = true;
    if (state === "locked") draft.lockEdits();
    if (state === "in flight") el.groupCommandBusy = true;
    await settled(el);
    expect(controls(el, 0)).toBeNull();
    if (state !== "locked") {
      expect(row(el, 0).disabled).toBe(true);
      expect(row(el, 0).getAttribute("aria-expanded")).toBe("false");
    }
  },
);

it("the opened row closes when its dish leaves the order or the order is read again", async () => {
  const { el, draft } = await open();
  await tapRow(el, 1);
  draft.removeLine(1);
  await settled(el);
  expect(el.shadowRoot!.querySelector("[data-draft-open]")).toBeNull();
  await tapRow(el, 0);
  draft.loadFrom("draft", [{ product: beer, quantity: "2", place: { kind: "fire" } }]);
  await settled(el);
  expect(controls(el, 0)).toBeNull();
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("false");
});

it("the opened row closes when the screen moves to another bill's order", async () => {
  const { el } = await open();
  await tapRow(el, 0);
  const other = new DraftStore();
  other.loadFrom("other", [{ product: beer, quantity: "2", place: { kind: "fire" } }]);
  el.draftStore = other;
  await settled(el);
  expect(controls(el, 0)).toBeNull();
});

function point(target: HTMLElement) {
  const box = target.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
function pointer(target: EventTarget, type: string, at: { x: number; y: number }) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 71,
      pointerType: "touch",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}

it("holding a row opens its details without opening it in place", async () => {
  const { el } = await open();
  const at = point(row(el, 0));
  vi.useFakeTimers();
  pointer(row(el, 0), "pointerdown", at);
  await vi.advanceTimersByTimeAsync(500);
  pointer(window, "pointerup", at);
  vi.useRealTimers();
  await settled(el);
  const details = picker(el, 0)!;
  expect(details).not.toBeNull();
  await details.updateComplete;
  expect(details.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Beer");
  expect(controls(el, 0)).toBeNull();
});

it("holding an open row opens its details and closes the row", async () => {
  const { el } = await open();
  await tapRow(el, 0);
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("true");
  const at = point(row(el, 0));
  vi.useFakeTimers();
  pointer(row(el, 0), "pointerdown", at);
  await vi.advanceTimersByTimeAsync(500);
  pointer(window, "pointerup", at);
  vi.useRealTimers();
  await settled(el);
  expect(picker(el, 0)).not.toBeNull();
  expect(row(el, 0).getAttribute("aria-expanded")).toBe("false");
  expect(controls(el, 0)).toBeNull();
});

it("dragging a row to another group opens nothing", async () => {
  const { el, draft } = await open();
  const at = point(row(el, 0));
  vi.useFakeTimers();
  pointer(row(el, 0), "pointerdown", at);
  await vi.advanceTimersByTimeAsync(500);
  const to = point(el.shadowRoot!.querySelector<HTMLElement>('[data-draft-group="new:1"] h3')!);
  pointer(window, "pointermove", to);
  await el.updateComplete;
  pointer(window, "pointerup", to);
  vi.useRealTimers();
  await settled(el);
  expect(draft.lines[0]!.place).toEqual({ kind: "new", slot: 1 });
  expect(el.shadowRoot!.querySelector("[data-draft-open]")).toBeNull();
  for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket"))
    expect(basket.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
});

it("a step, Options or Note pressed after an order goes in flight, before the row redraws closed, does nothing", async () => {
  const { el, draft } = await open();
  await tapRow(el, 0);
  const plus = step(el, 0, 1);
  const buttons = [options(el, 0), note(el, 0)];
  el.groupCommandBusy = true;
  plus.click();
  for (const button of buttons) button.click();
  await settled(el);
  expect(draft.lines[0]!.quantity).toBe("2");
  expect(picker(el, 0)).toBeNull();
  expect(controls(el, 0)).toBeNull();
});

it("a step, Options or Note pressed after the screen moves to another order, before the redraw, does nothing", async () => {
  const { el, draft } = await open();
  await tapRow(el, 0);
  const plus = step(el, 0, 1);
  const buttons = [options(el, 0), note(el, 0)];
  const quantity = vi.spyOn(draft, "setLineQuantity");
  const details = vi.spyOn(basketOf(el, 0), "openLineDetails");
  const other = new DraftStore();
  other.loadFrom("other", [{ product: beer, quantity: "2", place: { kind: "fire" } }]);
  el.draftStore = other;
  plus.click();
  for (const button of buttons) button.click();
  await settled(el);
  expect(quantity).not.toHaveBeenCalled();
  expect(details).not.toHaveBeenCalled();
  expect(draft.lines[0]!.quantity).toBe("2");
});

it("a step pressed after its dish leaves the order, before the redraw, does nothing", async () => {
  const { el, draft } = await open();
  await tapRow(el, 0);
  const plus = step(el, 0, 1);
  const quantity = vi.spyOn(draft, "setLineQuantity");
  draft.removeLine(0);
  plus.click();
  await settled(el);
  expect(quantity).not.toHaveBeenCalled();
  expect(draft.lines.map((line) => line.quantity)).toEqual(["1"]);
});

describe("opening a row near the window's foot", () => {
  const many = Array.from({ length: 20 }, (_, n) => ({
    ...beer,
    id: `dish-${n}`,
    menuItemId: `offer-dish-${n}`,
    name: `Dish ${n}`,
  }));

  async function inWindow(width: number, height: number) {
    const draft = new DraftStore();
    draft.loadFrom(
      "draft",
      many.map((product) => ({ product, quantity: "2", place: { kind: "fire" } })),
    );
    const { el, host } = await mount({
      products: many,
      menus: menuOf(many),
      draftStore: draft,
    });
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    host.style.overflowY = "auto";
    await resized(el);
    await showView(el, "order", { ifShown: true, scripted: true });
    await settled(el);
    await resized(el);
    host.scrollTop = 0;
    await scrollSettled(host);
    return { el, host };
  }

  const barTop = (el: TillTableOrderScreen) =>
    el.shadowRoot!.querySelector(".draft-bar")!.getBoundingClientRect().top;

  /** The box's foot stops --wt-space-2 above the bar's top, within a pixel's rounding. */
  function expectGapAboveBar(el: TillTableOrderScreen, box: DOMRect, top: number) {
    const gap = Number.parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-2"));
    expect(gap).toBeGreaterThan(0);
    expect(top - box.bottom).toBeGreaterThanOrEqual(gap - 0.5);
    expect(top - box.bottom).toBeLessThanOrEqual(gap + 1.5);
  }

  /** Scrolls the list so the row's line ends just above the bar, as the last one showing. */
  async function lastShowing(el: TillTableOrderScreen, host: HTMLElement, index: number) {
    // The bar's top moved after a first scroll here, so a second pass measures it again.
    for (let pass = 0; pass < 2; pass++) {
      host.scrollTop += row(el, index).getBoundingClientRect().bottom - barTop(el) + 1;
      await scrollSettled(host);
    }
    expect(row(el, index).getBoundingClientRect().bottom).toBeLessThanOrEqual(barTop(el));
    expect(row(el, index + 1).getBoundingClientRect().top).toBeGreaterThan(barTop(el) - 2);
  }

  it.each([
    [1024, 768],
    [390, 700],
    [844, 390],
  ])(
    "at %i × %i the opened box's foot, Note included, stops a space above the bar",
    async (width, height) => {
      const { el, host } = await inWindow(width, height);
      const index = 8;
      await lastShowing(el, host, index);
      const before = host.scrollTop;
      await tapRow(el, index);
      await scrollSettled(host);
      const box = row(el, index).closest(".entry")!.getBoundingClientRect();
      const top = barTop(el);
      expect(host.scrollTop).toBeGreaterThan(before);
      expectGapAboveBar(el, box, top);
      expect(note(el, index).getBoundingClientRect().bottom).toBeLessThanOrEqual(top);
    },
  );

  it("where the box is taller than the list shows, its foot wins over its line", async () => {
    setLocale("es");
    const { el, host } = await inWindow(844, 240);
    await lastShowing(el, host, 8);
    await tapRow(el, 8);
    await scrollSettled(host);
    const box = row(el, 8).closest(".entry")!.getBoundingClientRect();
    const top = barTop(el);
    expect(box.height).toBeGreaterThan(top - host.getBoundingClientRect().top);
    expect(box.top).toBeLessThan(host.getBoundingClientRect().top);
    expectGapAboveBar(el, box, top);
    expect(note(el, 8).getBoundingClientRect().bottom).toBeLessThanOrEqual(top);
  });

  it.each([
    [390, 844, 844, 390],
    [844, 390, 390, 844],
  ])(
    "on a handheld turned from %i × %i to %i × %i, the opened box's foot stops a space above the bar",
    async (fromWidth, fromHeight, toWidth, toHeight) => {
      await page.viewport(fromWidth, fromHeight);
      const draft = new DraftStore();
      draft.loadFrom(
        "draft",
        many.map((product) => ({ product, quantity: "2", place: { kind: "fire" } })),
      );
      const { el, host } = await mount({
        products: many,
        menus: menuOf(many),
        draftStore: draft,
        handheld: true,
      });
      host.style.width = "100vw";
      host.style.height = "100vh";
      host.style.overflowY = "auto";
      await resized(el);
      await showView(el, "order", { ifShown: true, scripted: true });
      await settled(el);
      await resized(el);
      await page.viewport(toWidth, toHeight);
      await resized(el);
      await showView(el, "order", { ifShown: true, scripted: true });
      await settled(el);
      await resized(el);
      const docked = el.shadowRoot!.querySelector(".draft-bar")!.closest("[data-order-dock]");
      expect(docked !== null).toBe(toWidth < toHeight);
      host.scrollTop = 0;
      await scrollSettled(host);
      await lastShowing(el, host, 8);
      await tapRow(el, 8);
      await scrollSettled(host);
      const box = row(el, 8).closest(".entry")!.getBoundingClientRect();
      const top = barTop(el);
      expectGapAboveBar(el, box, top);
    },
  );

  // Turned upright the other way, the till shows the menu, and Order opens at its top.
  it("a box opened upright is brought back above the bar when the handheld turns sideways", async () => {
    await page.viewport(390, 844);
    const draft = new DraftStore();
    draft.loadFrom(
      "draft",
      many.map((product) => ({ product, quantity: "2", place: { kind: "fire" } })),
    );
    const { el, host } = await mount({
      products: many,
      menus: menuOf(many),
      draftStore: draft,
      handheld: true,
    });
    host.style.width = "100vw";
    host.style.height = "100vh";
    host.style.overflowY = "auto";
    await resized(el);
    await showView(el, "order", { scripted: true });
    await settled(el);
    await resized(el);
    host.scrollTop = 0;
    await scrollSettled(host);
    await lastShowing(el, host, 8);
    await tapRow(el, 8);
    await scrollSettled(host);
    expect(note(el, 8).getBoundingClientRect().bottom).toBeLessThanOrEqual(barTop(el));
    await page.viewport(844, 390);
    await resized(el);
    await settled(el);
    await resized(el);
    await scrollSettled(host);
    expect(controls(el, 8)).not.toBeNull();
    const box = row(el, 8).closest(".entry")!.getBoundingClientRect();
    const top = barTop(el);
    expectGapAboveBar(el, box, top);
    expect(note(el, 8).getBoundingClientRect().bottom).toBeLessThanOrEqual(top);
  });

  it("a box opened upright, turned sideways and back upright, is on Order with the box above the bar", async () => {
    await page.viewport(390, 844);
    try {
      const draft = new DraftStore();
      draft.loadFrom(
        "draft",
        many.map((product) => ({ product, quantity: "2", place: { kind: "fire" } })),
      );
      const { el, host } = await mount({
        products: many,
        menus: menuOf(many),
        draftStore: draft,
        handheld: true,
      });
      host.style.width = "100vw";
      host.style.height = "100vh";
      host.style.overflowY = "auto";
      await resized(el);
      await showView(el, "order", { scripted: true });
      await settled(el);
      await resized(el);
      host.scrollTop = 0;
      await scrollSettled(host);
      await lastShowing(el, host, 8);
      await tapRow(el, 8);
      await scrollSettled(host);
      expect(note(el, 8).getBoundingClientRect().bottom).toBeLessThanOrEqual(barTop(el));
      for (const [width, height] of [
        [844, 390],
        [390, 844],
      ] as const) {
        await page.viewport(width, height);
        await resized(el);
        await settled(el);
        await resized(el);
        await scrollSettled(host);
      }
      expect(shownView(el)).toBe("order");
      expect(controls(el, 8)).not.toBeNull();
      expectGapAboveBar(el, row(el, 8).closest(".entry")!.getBoundingClientRect(), barTop(el));
    } finally {
      await page.viewport(1280, 1800);
    }
  });

  it("a row whose opened box already shows whole does not move the list", async () => {
    const { el, host } = await inWindow(1024, 768);
    await tapRow(el, 0);
    await scrollSettled(host);
    expect(host.scrollTop).toBe(0);
  });
});

it("an opened new row's quantity and name stay where a closed row's are, moved by the border alone, its selection box still a full tap wide", async () => {
  const { el } = await open([
    { product: beer, quantity: "2", place: { kind: "fire" } },
    { product: flan, quantity: "1", place: { kind: "fire" } },
  ]);
  await tapRow(el, 0);
  const entry = row(el, 0).closest(".entry")!;
  expect(entry.hasAttribute("data-open")).toBe(true);
  const border = Number.parseFloat(getComputedStyle(entry).borderLeftWidth);
  expect(border).toBeGreaterThan(0);
  for (const cell of [".row-qty", ".row-name"]) {
    const moved =
      row(el, 0).querySelector(cell)!.getBoundingClientRect().left -
      row(el, 1).querySelector(cell)!.getBoundingClientRect().left;
    expect(moved, cell).toBeGreaterThanOrEqual(border - 0.5);
    expect(moved, cell).toBeLessThanOrEqual(border + 0.5);
  }
  const select = el.shadowRoot!.querySelector<HTMLElement>('[data-draft-select="0"]')!;
  const tap = Number.parseFloat(getComputedStyle(el).getPropertyValue("--wt-tap-min"));
  expect(tap).toBeGreaterThan(0);
  expect(select.getBoundingClientRect().width).toBeGreaterThanOrEqual(tap);
  expect(select.getBoundingClientRect().right).toBeLessThanOrEqual(
    row(el, 0).getBoundingClientRect().left + 0.5,
  );
});

it("on a phone, an opened new row draws its tick box inside the box's edge, its tap area, quantity and name staying put, and a closed row's tick box does not move", async () => {
  await page.viewport(390, 844);
  const draft = new DraftStore();
  draft.loadFrom("draft", [
    { product: beer, quantity: "2", place: { kind: "fire" } },
    { product: flan, quantity: "1", place: { kind: "fire" } },
  ]);
  const { el, host } = await mount({ draftStore: draft });
  host.style.width = "390px";
  await resized(el);
  await showView(el, "order", { ifShown: true, scripted: true });
  await settled(el);
  await resized(el);
  const select = (index: number) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-draft-select="${index}"]`)!;
  const square = (index: number) =>
    select(index).querySelector(".draft-select-box")!.getBoundingClientRect();
  const closedSquare = square(1).left;
  const token = (name: string) => {
    const value = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
    expect(value, name).toBeGreaterThan(0);
    return value;
  };
  const tap = token("--wt-tap-min");
  const nudge = token("--wt-space-1");
  const margin = token("--wt-space-2");
  // A closed row centres its tick box in the tap area.
  const centred = (tap - square(1).width) / 2;
  expect(closedSquare - select(1).getBoundingClientRect().left).toBeCloseTo(centred, 0);

  await tapRow(el, 0);
  const entry = row(el, 0).closest(".entry")!;
  expect(entry.hasAttribute("data-open")).toBe(true);
  const inner = entry.getBoundingClientRect().left + entry.clientLeft;
  expect(square(0).left - inner).toBeGreaterThanOrEqual(nudge);
  const area = select(0).getBoundingClientRect();
  expect(area.width).toBeGreaterThanOrEqual(tap - 0.5);
  expect(area.width).toBeLessThanOrEqual(tap + 0.5);
  expect(area.left).toBeCloseTo(inner - margin, 1);
  expect(square(0).left - area.left).toBeCloseTo(centred + nudge, 0);
  for (const cell of [".row-qty", ".row-name"]) {
    const moved =
      row(el, 0).querySelector(cell)!.getBoundingClientRect().left -
      row(el, 1).querySelector(cell)!.getBoundingClientRect().left;
    expect(moved, cell).toBeGreaterThanOrEqual(entry.clientLeft - 0.5);
    expect(moved, cell).toBeLessThanOrEqual(entry.clientLeft + 0.5);
  }
  expect(square(1).left).toBe(closedSquare);
});
