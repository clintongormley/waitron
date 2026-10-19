import { afterEach, expect, it } from "vitest";
import { commands, page } from "vitest/browser";
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
          const products = [0, 1, 2].map((n) => ({
            ...beer,
            id: `dish-${n}`,
            menuItemId: `mi-${n}`,
            name: `Seasonal roasted vegetables and garden herbs ${n}`,
            unitPrice: "123.45",
            allergens: { nuts: { kinds: ["walnuts" as const] }, milk: {} },
            dietaryDeclarations: ["vegetarian" as const],
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
            draft.addMerging(product, "1", { note: "Serve the dressing separately, please." });
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
          await page.screenshot({
            path: `__screenshots__/a738-last-added/${kind}-${locale}-${theme}-${width}.png`,
            element: host,
          });
        });
      }
