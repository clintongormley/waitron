import { afterEach, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import type { TillProduct } from "../api/client.js";
import type { TillCounterScreen } from "./till-counter-screen.js";
import type { LitElement } from "lit";
import { cleanupWidgets, mountWidget, servedMenus } from "../widgets/test-helpers.js";
import "./till-counter-screen.js";

const originalLocale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(414, 896);
});
const dish: TillProduct = {
  id: "soup",
  name: "Staff soup",
  menuItemId: "mi-soup",
  catalogueId: "lunch",
  available: true,
  unitPrice: "5.00",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: null,
};

it("A738 Counter last-added opens the same line without changing its quantity", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(dish, "2");
  const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store,
    products: [dish],
    menus: servedMenus(
      [{ id: "lunch", name: "Lunch", isDefault: true, versionId: "v1" }],
      [{ id: "mi-soup", menuId: "lunch", productId: "soup" }],
    ),
  });
  const strip = el.shadowRoot!.querySelector<LitElement>("till-last-added");
  expect(strip, "Counter must allocate a shared last-added strip").not.toBeNull();
  await strip!.updateComplete;
  const detail = strip!.shadowRoot!.querySelector<HTMLElement>("[data-last-added-detail]")!;
  await userEvent.click(detail, { delay: 650 });
  const basket = el.shadowRoot!.querySelector<LitElement>("till-basket")!;
  await basket.updateComplete;
  const picker = basket.shadowRoot!.querySelector<LitElement>("till-modifier-picker");
  expect(picker).not.toBeNull();
  expect(store.lines[0]!.quantity).toBe("2");
});

it.each([390, 1280])(
  "A738 table last-added opens its matching line from browsing at %s",
  async (width) => {
    await page.viewport(width, 844);
    const {
      mount,
      resized,
      store: draftOf,
      beer,
    } = await import("./till-table-order-screen.test-helpers.js");
    const { el, host } = await mount();
    host.style.width = "100%";
    await resized(el);
    const draft = draftOf(el);
    draft.addProduct(beer, "2");
    await el.updateComplete;
    const strip = el.shadowRoot!.querySelector<LitElement>("till-last-added");
    expect(strip, "table Order must share the last-added widget").not.toBeNull();
    await strip!.updateComplete;
    const before = draft.lines[0]!;
    await userEvent.click(
      strip!.shadowRoot!.querySelector<HTMLElement>("[data-last-added-detail]")!,
      { delay: 650 },
    );
    await expect
      .poll(() =>
        [...el.shadowRoot!.querySelectorAll<LitElement>("till-basket")].some((basket) =>
          basket.shadowRoot?.querySelector("till-modifier-picker"),
        ),
      )
      .toBe(true);
    expect(draft.lines[0]).toBe(before);
    expect(before.quantity).toBe("2");
    expect(el.shadowRoot!.querySelector("[data-draft-pane]")?.checkVisibility()).toBe(true);
  },
);

it("A738 adding and merging reveal the exact Counter row while unrelated edits preserve scroll", async () => {
  await page.viewport(1280, 800);
  const store = new WorkingOrderStore();
  const products = Array.from({ length: 30 }, (_, n) => ({
    ...dish,
    id: `dish-${n}`,
    menuItemId: `mi-${n}`,
    name: `Staff dish ${n}`,
  }));
  const { el, host } = await mountWidget<TillCounterScreen>("till-counter-screen", {
    store,
    embedded: true,
    products,
    menus: servedMenus(
      [{ id: "lunch", name: "Lunch", isDefault: true, versionId: "v1" }],
      products.map((p) => ({ id: p.menuItemId!, menuId: "lunch", productId: p.id })),
    ),
  });
  host.style.height = "720px";
  el.style.height = "100%";
  for (const product of products) store.addMerging(product, "1");
  await el.updateComplete;
  const basket = el.shadowRoot!.querySelector<LitElement>("till-basket")!;
  await basket.updateComplete;
  const scroller = basket.parentElement!;
  await expect
    .poll(() => scroller.scrollTop, { message: "new dish must be revealed in the basket scroller" })
    .toBeGreaterThan(0);
  const last = basket.shadowRoot!.querySelector<HTMLElement>('[data-line-detail="29"]')!;
  await expect
    .poll(() => last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom)
    .toBe(true);
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  try {
    store.kitchenNote = "Separate sauce";
    await el.updateComplete;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(scroll).not.toHaveBeenCalled();
    store.addMerging(products[0]!, "1");
    await el.updateComplete;
    await expect
      .poll(
        () =>
          basket
            .shadowRoot!.querySelector<HTMLElement>('[data-line-detail="0"]')!
            .getBoundingClientRect().top >= scroller.getBoundingClientRect().top,
      )
      .toBe(true);
    expect(store.lines[0]!.quantity).toBe("2");
    const calls = scroll.mock.calls.length;
    store.emit("changed");
    await el.updateComplete;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(scroll).toHaveBeenCalledTimes(calls);
  } finally {
    scroll.mockRestore();
  }
});

for (const kind of ["counter", "table"] as const) {
  it(`A738 ${kind} status uses the service text as its keep-open action and updates equipment`, async () => {
    const shared = {
      service: {
        open: true,
        zoneOpen: true,
        periodName: "Late service",
        periodOccurrenceKey: "night",
        zoneKeepOpen: null,
        keepOpen: {
          periodId: "late",
          periodName: "Late service",
          endsAt: "02:00",
          running: true,
          extendedUntil: null,
        },
      },
      zoneName: "Garden",
      departmentName: "Restaurant",
    };
    const { el } =
      kind === "counter"
        ? await mountWidget<TillCounterScreen>("till-counter-screen", {
            ...shared,
            store: new WorkingOrderStore(),
          })
        : await (await import("./till-table-order-screen.test-helpers.js")).mount(shared);
    const control = el.shadowRoot!.querySelector<LitElement>("till-keep-open")!;
    await control.updateComplete;
    expect(control.shadowRoot!.querySelector("[data-action]")!.textContent!.trim()).toBe(
      "Open · until 02:00",
    );
    expect(el.shadowRoot!.querySelector("[data-service-zone]")?.textContent).toContain("Garden");
    expect(el.shadowRoot!.querySelector("[data-receipt-status]")?.textContent).toContain(
      "Receipt printer status unknown",
    );
    const screen = el as typeof el & {
      receiptEquipment: { id: string; name: string; available: boolean } | null | undefined;
    };
    for (const [equipment, expected] of [
      [null, "No receipt printer"],
      [
        { id: "receipt", name: "Front printer", available: false },
        "Receipt printer unavailable: Front printer",
      ],
      [
        { id: "receipt", name: "Front printer", available: true },
        "Receipt printer available: Front printer",
      ],
    ] as const) {
      screen.receiptEquipment = equipment;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-receipt-status]")?.textContent?.trim()).toBe(
        expected,
      );
    }
    el.service = {
      ...shared.service,
      keepOpen: { ...shared.service.keepOpen, extendedUntil: "03:00" },
    };
    await el.updateComplete;
    await control.updateComplete;
    expect(control.shadowRoot!.querySelector("[data-action]")!.textContent!.trim()).toBe(
      "Open · kept open until 03:00",
    );
    el.service = { ...shared.service, open: false };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-service-closed]")?.textContent).toContain(
      "Restaurant",
    );
  });
}

it.each([390, 1280])(
  "A738 table last-added occupies flow space after the final product row at %s",
  async (width) => {
    await page.viewport(width, width === 390 ? 844 : 800);
    const {
      mount,
      resized,
      store: draftOf,
      beer,
      browser,
    } = await import("./till-table-order-screen.test-helpers.js");
    const products = Array.from({ length: 50 }, (_, n) => ({
      ...beer,
      id: `dish-${n}`,
      menuItemId: `mi-${n}`,
      name: `Long staff dish name ${n}`,
    }));
    const { el, host } = await mount({ products });
    host.style.width = "100%";
    await resized(el);
    draftOf(el).addProduct(products[0]!, "1");
    await el.updateComplete;
    await browser(el).updateComplete;
    const strip = el.shadowRoot!.querySelector<LitElement>("till-last-added")!;
    await strip.updateComplete;
    const tiles = [...browser(el).shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")];
    expect(tiles).toHaveLength(50);
    const finalRow = tiles.at(-1)!.getBoundingClientRect();
    expect(
      finalRow.bottom,
      "the strip must reserve space after every product button",
    ).toBeLessThanOrEqual(strip.getBoundingClientRect().top);
  },
);

for (const width of [390, 1280])
  it.each(["light", "dark"] as const)(
    `A738 Counter order has its theme surface and a heavier divider at ${width} in %s`,
    async (theme) => {
      await page.viewport(width, 844);
      const store = new WorkingOrderStore();
      store.addProduct(dish, "1");
      const { el, host } = await mountWidget<TillCounterScreen>(
        "till-counter-screen",
        { store },
        theme,
      );
      const panel = el.shadowRoot!.querySelector<HTMLElement>(".basket-cell")!;
      const reference = document.createElement("div");
      reference.style.background = "var(--wt-color-surface)";
      host.append(reference);
      expect(getComputedStyle(panel).backgroundColor).toBe(
        getComputedStyle(reference).backgroundColor,
      );
      expect(
        parseFloat(
          width === 390
            ? getComputedStyle(panel).borderBlockStartWidth
            : getComputedStyle(panel).borderInlineStartWidth,
        ),
      ).toBeGreaterThan(1);
    },
  );

it.each([390, 1280])(
  "A738 adding a table dish reveals its order row even after opening Review at %s",
  async (width) => {
    await page.viewport(width, 844);
    const {
      mount,
      resized,
      store: draftOf,
      beer,
    } = await import("./till-table-order-screen.test-helpers.js");
    const { el, host } = await mount();
    host.style.width = "100%";
    host.style.height = "700px";
    host.style.overflow = "auto";
    await resized(el);
    const draft = draftOf(el);
    for (let n = 0; n < 25; n++)
      draft.addProduct(
        { ...beer, id: `dish-${n}`, menuItemId: `mi-${n}`, name: `Staff dish ${n}` },
        "1",
      );
    await el.updateComplete;
    if (width === 390) {
      await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-review-open]")!);
      await el.updateComplete;
    }
    const basket = [...el.shadowRoot!.querySelectorAll<LitElement>("till-basket")].at(-1)!;
    await basket.updateComplete;
    const last = basket.shadowRoot!.querySelector<HTMLElement>('[data-line-detail="24"]')!;
    await expect
      .poll(() => last.getBoundingClientRect().bottom <= host.getBoundingClientRect().bottom)
      .toBe(true);
    expect(draft.lines).toHaveLength(25);
    expect(draft.lines[24]!.quantity).toBe("1");
  },
);
it("A738 reduced-motion additions scroll instantly and refreshes never scroll again", async () => {
  await commands.emulateReducedMotion(true);
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
  try {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", { store });
    store.addProduct(dish, "2");
    await el.updateComplete;
    await expect.poll(() => scroll.mock.calls.length).toBe(1);
    expect(scroll.mock.calls[0]).toEqual([
      { block: "nearest", inline: "nearest", behavior: "instant" },
    ]);
    store.loadFrom(
      store.id,
      store.lines.map((line) => structuredClone(line)),
      undefined,
      2,
    );
    await el.updateComplete;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally {
    scroll.mockRestore();
    await commands.emulateReducedMotion(false);
  }
});

it.each(["parked", "waiting"] as const)(
  "A738 Counter keeps service and equipment status above the %s view",
  async (orderList) => {
    const { el } = await mountWidget<TillCounterScreen>("till-counter-screen", {
      store: new WorkingOrderStore(),
      orderList,
      zoneName: "Garden",
      receiptEquipment: null,
    });
    expect(el.shadowRoot!.querySelector("[data-receipt-status]")?.textContent).toContain(
      "No receipt printer",
    );
    const status = el.shadowRoot!.querySelector<HTMLElement>(".service-period");
    expect(status?.parentElement?.classList.contains("body")).toBe(true);
    expect(el.shadowRoot!.querySelector("[data-service-zone]")?.textContent).toContain("Garden");
  },
);
