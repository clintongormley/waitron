import { afterEach, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import type { LitElement } from "lit";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import {
  cleanupWidgets,
  mountWidget,
  servedMenus,
  expectNoA11yViolations,
} from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillShell } from "../widgets/till-shell.js";
import { mount as mountTable, resized, beer } from "./till-table-order-screen.test-helpers.js";
import type { TillProduct, HeldOrderSummary, CounterWaitingOrder } from "../api/client.js";
import "../till-app.js";

function within(root: Element | ShadowRoot, selector: string): HTMLElement | null {
  const match = root.querySelector<HTMLElement>(selector);
  if (match) return match;
  if (root instanceof Element && root.shadowRoot) {
    const nested = within(root.shadowRoot, selector);
    if (nested) return nested;
  }
  for (const child of root.querySelectorAll("*")) {
    const nested = child.shadowRoot && within(child.shadowRoot, selector);
    if (nested) return nested;
  }
  return null;
}

async function tapButtons(root: ShadowRoot) {
  for (const button of root.querySelectorAll("wt-button")) {
    await button.updateComplete;
    const native = button.shadowRoot!.querySelector("button")!;
    if (!native.checkVisibility()) continue;
    const box = native.getBoundingClientRect();
    const minimum = parseFloat(getComputedStyle(button).getPropertyValue("--wt-tap-min"));
    expect(
      box.width,
      native.getAttribute("aria-label") ?? native.textContent!,
    ).toBeGreaterThanOrEqual(minimum);
    expect(
      box.height,
      native.getAttribute("aria-label") ?? native.textContent!,
    ).toBeGreaterThanOrEqual(minimum);
  }
}

const previewItems = [
  {
    lineId: "recorded-dish",
    name: "Recorded roasted pumpkin soup",
    quantity: "1.000",
    note: "Serve the dressing separately, please.",
    extras: [{ lineId: "recorded-extra", name: "Recorded mature cheese", quantity: "2.000" }],
  },
];
const parked: HeldOrderSummary = {
  id: "parked",
  orderNumber: 41,
  label: "Alex Morgan Smith Jones, covered garden terrace",
  itemCount: 1,
  total: "125.95",
  outstanding: "125.95",
  hasPayments: false,
  partyId: null,
  openedAt: "2026-10-20T10:00:00Z",
  signals: [],
  items: previewItems,
};
const waiting: CounterWaitingOrder = {
  id: "waiting",
  orderNumber: 42,
  label: "Garden terrace guests",
  status: "placed",
  total: "125.95",
  openedAt: "2026-10-20T10:00:00Z",
  settledAt: null,
  collectedAt: null,
  canHandOver: true,
  serviceMode: "ticket_then_pay",
  movableDishes: [],
  items: previewItems,
};
const priorLocale = currentLocale();
afterEach(async () => {
  cleanupWidgets();
  setLocale(priorLocale);
  await page.viewport(414, 896);
  await commands.emulateReducedMotion(false);
});
for (const kind of ["counter", "table"] as const)
  for (const locale of ["en-GB", "es-ES"])
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280]) {
        it(`A738 ${kind} last-added and status fit ${locale} ${theme} ${width}`, async () => {
          await commands.emulateReducedMotion(true);
          setLocale(locale);
          await page.viewport(width, width === 390 ? 844 : 800);
          expect(innerWidth).toBe(width);
          const products: TillProduct[] = Array.from({ length: 12 }, (_, n) => ({
            ...beer,
            id: `dish-${n}`,
            menuItemId: `mi-${n}`,
            name: `Seasonal roasted vegetables and garden herbs ${n}`,
            unitPrice: "123.45",
            allergens: { nuts: { kinds: ["walnuts" as const] }, milk: {} },
            dietaryDeclarations: ["vegetarian" as const],
            offeredModifiers: [
              {
                kind: "extras",
                id: "sides",
                name: "Staff sides",
                customerName: { en: "Customer sides" },
                kitchenName: "Kitchen sides",
                minPicks: 0,
                maxPicks: 3,
                items: [
                  {
                    productId: "cheese",
                    name: "Mature farmhouse sheep cheese",
                    customerName: { en: "Customer cheese" },
                    kitchenName: "Kitchen cheese",
                    price: "1.25",
                    vatClass: "general",
                    portion: "1",
                    unit: {
                      id: "each",
                      name: { en: "Each" },
                      abbreviation: { en: "ea" },
                      precision: 0,
                      hardwareUnit: null,
                    },
                    maxQuantity: 3,
                    preselected: false,
                    addAllergens: { milk: {} },
                    suitableFor: ["vegetarian"],
                  },
                ],
              },
            ],
          }));
          const shared = {
            embedded: true,
            products,
            zoneName: "Garden terrace",
            departmentName: "Restaurant",
            receiptEquipment: { id: "printer", name: "Front receipt printer", available: false },
            service: {
              open: true,
              zoneOpen: true,
              periodName: "Late service",
              periodOccurrenceKey: "night",
              zoneKeepOpen: null,
              keepOpen: {
                periodId: "night",
                periodName: "Late service",
                endsAt: "02:00",
                extendedUntil: null,
                running: true,
              },
            },
          };
          const store = new WorkingOrderStore();
          const mounted =
            kind === "counter"
              ? await mountWidget<TillCounterScreen>(
                  "till-counter-screen",
                  {
                    ...shared,
                    store,
                    orderFlow: "ticket_then_pay",
                    menus: servedMenus(
                      [
                        {
                          id: "menu-table",
                          name: "Seasonal menu",
                          isDefault: true,
                          versionId: "v1",
                        },
                      ],
                      products.map((p) => ({
                        id: p.menuItemId!,
                        menuId: "menu-table",
                        productId: p.id,
                      })),
                    ),
                  },
                  theme,
                )
              : await mountTable(shared);
          const screen = mounted.el;
          const { el: shell, host } = await mountWidget<TillShell>(
            "till-shell",
            {
              formFactor: "till",
              activeScreen: kind === "counter" ? "counter" : "order",
              operatorName: "Alex Morgan Smith Jones",
              parkedCount: 12,
              waitingCount: 3,
              transferAvailable: true,
              transferCount: 2,
              affordances: ["expo", "find-bill"],
            },
            theme,
          );
          host.style.width = "100%";
          shell.append(screen);
          screen.style.width = "100%";
          if (kind === "table") await resized(screen as Parameters<typeof resized>[0]);
          const draft = screen instanceof TillCounterScreen ? screen.store : screen.draftStore!;
          for (const product of products)
            draft.addMerging(product, "1", {
              note: "Serve the dressing separately, please.",
              extras: [
                {
                  listId: "sides",
                  productId: "cheese",
                  name: "Mature farmhouse sheep cheese",
                  price: "1.25",
                  quantity: 2,
                },
              ],
            });
          await screen.updateComplete;
          const strip = screen.shadowRoot!.querySelector<LitElement>("till-last-added")!;
          await strip.updateComplete;
          const status = screen.shadowRoot!.querySelector<LitElement>("till-keep-open")!;
          await status.updateComplete;
          const bounds = strip.getBoundingClientRect();
          expect(bounds.width).toBeGreaterThan(0);
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(width);
          for (const button of strip.shadowRoot!.querySelectorAll<HTMLElement>(
            "button, wt-button",
          )) {
            if (button.tagName === "WT-BUTTON") await (button as LitElement).updateComplete;
            const rect = button.getBoundingClientRect();
            expect(rect.width).toBeGreaterThanOrEqual(44);
            expect(rect.height).toBeGreaterThanOrEqual(44);
          }
          const menu = screen.shadowRoot!.querySelector<LitElement>("till-menu-browser")!;
          await menu.updateComplete;
          const tile = [...menu.shadowRoot!.querySelectorAll<HTMLElement>("wt-button.tile")].at(
            -1,
          )!;
          tile.scrollIntoView({ block: "nearest" });
          expect(tile.getBoundingClientRect().bottom).toBeLessThanOrEqual(bounds.top);
          await expectNoA11yViolations(host);
          for (const basket of screen.shadowRoot!.querySelectorAll<LitElement>("till-basket"))
            await basket.updateComplete;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          shell
            .shadowRoot!.querySelector<HTMLElement>(".body")!
            .scrollTo({ top: 0, behavior: "instant" });
          document.scrollingElement!.scrollTo({ top: 0, behavior: "instant" });
          await expect
            .poll(() => {
              const status = screen
                .shadowRoot!.querySelector<HTMLElement>(".service-period")!
                .getBoundingClientRect();
              return status.top >= 0 && status.bottom <= innerHeight;
            })
            .toBe(true);
          const more =
            shell.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
              '[data-test="more-menu"]',
            )!;
          await more.updateComplete;
          const menuIcon = more.shadowRoot!.querySelector("wt-icon")!;
          await menuIcon.updateComplete;
          expect(
            menuIcon.shadowRoot!.querySelector("path"),
            "the actual app's More icon must be painted",
          ).not.toBeNull();
          const moreBox = more.shadowRoot!.querySelector("button")!.getBoundingClientRect();
          expect(moreBox.left).toBeGreaterThanOrEqual(0);
          expect(moreBox.right).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: `__screenshots__/a738-last-added/${kind}-${locale}-${theme}-${width}.png`,
            element: host,
          });
          for (const basket of screen.shadowRoot!.querySelectorAll("till-basket")) {
            await tapButtons(basket.shadowRoot!);
          }
          const capture = async (scene: string) => {
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `__screenshots__/a738-acceptance/${kind}-${locale}-${theme}-${width}-${scene}.png`,
              element: host,
            });
          };
          await userEvent.click(more.shadowRoot!.querySelector("button")!);
          expect(more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
          await capture("more");
          await userEvent.keyboard("{Escape}");
          await expect
            .poll(() => more.shadowRoot!.querySelector("[popover]")!.matches(":popover-open"))
            .toBe(false);

          const filter =
            screen.shadowRoot!.querySelector<HTMLElementTagNameMap["till-diet-filter"]>(
              "till-diet-filter",
            )!;
          await filter.updateComplete;
          await userEvent.click(
            filter.shadowRoot!.querySelector<HTMLElement>("[data-filter-open]")!,
          );
          await filter.updateComplete;
          const filterDialog = filter.shadowRoot!.querySelector("wt-dialog")!;
          await filterDialog.updateComplete;
          await capture("filter");
          await userEvent.click(
            filter.shadowRoot!.querySelector<HTMLElement>('[data-allergen="nuts"]')!,
          );
          await filter.updateComplete;
          await capture("filter-nuts");
          const filterClosed = new Promise((resolve) =>
            filterDialog.addEventListener("wt-close", resolve, { once: true }),
          );
          await userEvent.keyboard("{Escape}");
          await filterClosed;

          await userEvent.click(
            strip.shadowRoot!.querySelector<HTMLElement>("[data-last-added-detail]")!,
            { delay: 650 },
          );
          await expect.poll(() => within(screen, "till-modifier-picker")).not.toBeNull();
          const picker = within(
            screen,
            "till-modifier-picker",
          ) as HTMLElementTagNameMap["till-modifier-picker"];
          await picker.updateComplete;
          const modal = picker.shadowRoot!.querySelector("wt-modal")!;
          await modal.updateComplete;
          expect(modal.open).toBe(true);
          expect(picker.shadowRoot!.textContent).toContain("Mature farmhouse sheep cheese");
          await tapButtons(picker.shadowRoot!);
          await capture("line-window");
          const lineClosed = new Promise((resolve) =>
            modal.addEventListener("wt-close", resolve, { once: true }),
          );
          await userEvent.keyboard("{Escape}");
          await lineClosed;

          if (screen instanceof TillCounterScreen) {
            const tender = screen.shadowRoot!.querySelector("till-tender-pay")!;
            await tender.updateComplete;
            await userEvent.click(tender.shadowRoot!.querySelector<HTMLElement>(".hold")!);
            await tender.updateComplete;
            const parkDialog = tender.shadowRoot!.querySelector("wt-dialog")!;
            await parkDialog.updateComplete;
            await capture("park");
            const parkClosed = new Promise((resolve) =>
              parkDialog.addEventListener("wt-close", resolve, { once: true }),
            );
            await userEvent.keyboard("{Escape}");
            await parkClosed;
            for (const list of ["parked", "waiting"] as const) {
              screen.orderList = list;
              shell.activeOrderList = list;
              screen.heldOrders = [parked];
              screen.counterWaiting = [waiting];
              shell.parkedCount = 1;
              shell.waitingCount = 1;
              await screen.updateComplete;
              const widget = screen.shadowRoot!.querySelector(
                list === "parked" ? "till-held-orders" : "till-counter-waiting",
              )!;
              await widget.updateComplete;
              await userEvent.click(
                widget.shadowRoot!.querySelector<HTMLButtonElement>("button.summary")!,
              );
              await widget.updateComplete;
              expect(widget.shadowRoot!.querySelector(".order-preview")!.textContent).toContain(
                "Recorded roasted pumpkin soup",
              );
              await capture(list);
              screen.heldOrders = [];
              screen.counterWaiting = [];
              shell.parkedCount = 0;
              shell.waitingCount = 0;
              await screen.updateComplete;
              await capture(`${list}-empty`);
            }
          }
        }, 30_000);
      }
