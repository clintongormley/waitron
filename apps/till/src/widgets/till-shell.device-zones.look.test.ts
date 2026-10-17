import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillShell } from "./till-shell.js";
import type { TillFloorScreen } from "../screens/till-floor-screen.js";
import type { TableState } from "../api/client.js";
import "../till-app.js";
import "./till-shell.js";
import "../screens/till-floor-screen.js";

const originalLocale = currentLocale();
const originalWidth = innerWidth,
  originalHeight = innerHeight;
afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  await page.viewport(originalWidth, originalHeight);
});

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`Counter list and Floor toolbar fit ${locale}/${theme}/${width}`, async () => {
        setLocale(locale);
        await page.viewport(width, 844);
        expect(innerWidth).toBe(width);
        const { el } = await mountWidget<TillShell>(
          "till-shell",
          {
            activeScreen: "floor",
            operatorName: "Ana",
            counterZones: [
              { id: "bar", name: locale === "en-GB" ? "Bar" : "Barra" },
              { id: "shop", name: "Deli" },
            ],
            selectedCounterZoneId: "bar",
          },
          theme,
        );
        const floor = document.createElement("till-floor-screen") as TillFloorScreen;
        Object.assign(floor, {
          embedded: true,
          canChangeToday: true,
          zones: [
            {
              id: "room",
              name: locale === "en-GB" ? "Dining room" : "Comedor",
              displayOrder: 0,
              active: true,
              closed: false,
              closesAt: null,
              hasPlan: true,
              serviceMode: "table_tab",
            },
            {
              id: "garden",
              name: locale === "en-GB" ? "Outside terrace" : "Terraza exterior",
              displayOrder: 1,
              active: true,
              closed: false,
              closesAt: null,
              hasPlan: true,
              serviceMode: "table_tab",
            },
          ],
          tables: [
            {
              id: "table",
              label: "1",
              zoneId: "room",
              state: "free",
              condition: "free",
              hasOpenTab: false,
              pendingDeliveries: 0,
              pendingToServe: 0,
              readyToServe: 0,
              enRoute: 0,
              timingBand: "fresh",
              status: null,
              nextReservation: null,
              signals: [],
              party: null,
              today: {
                placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
                seats: 4,
                fixed: false,
                takenOff: false,
                joinId: null,
                joinSeats: null,
                inJoinedTable: null,
                joined: null,
                splitOffFrom: null,
                zoneRevision: 0,
              },
            } satisfies TableState,
          ],
        });
        el.appendChild(floor);
        await floor.updateComplete;
        const view = floor.shadowRoot!.querySelector<HTMLElement>("[data-view-toggle]")!;
        await (view as TillShell).updateComplete;
        await userEvent.click(view);
        await floor.updateComplete;
        expect(floor.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
        await userEvent.click(view);
        await floor.updateComplete;
        expect(floor.shadowRoot!.querySelector("wt-floor-map")).not.toBeNull();
        const zoneMenu = floor.shadowRoot!.querySelector("till-floor-zone-menu")!;
        await zoneMenu.updateComplete;
        const zoneActions = zoneMenu.shadowRoot!.querySelector("wt-row-actions")!;
        await zoneActions.updateComplete;
        await userEvent.click(zoneActions.shadowRoot!.querySelector("button")!);
        expect(zoneActions.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(
          true,
        );
        await userEvent.keyboard("{Escape}");
        expect(zoneActions.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(
          false,
        );
        const actions = floor.shadowRoot!.querySelector<HTMLElement>(".actions")!;
        const pills = floor.shadowRoot!.querySelector<HTMLElement>(".tabs")!;
        expect(actions.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(
          Math.abs(actions.getBoundingClientRect().top - pills.getBoundingClientRect().top),
        ).toBeLessThan(1);
        await page.screenshot({
          path: `__screenshots__/a740-zones/floor-${locale}-${theme}-${width}.png`,
        });
        const menu = el.shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]")!;
        await (menu as TillShell).updateComplete;
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
        const popup = menu
          .shadowRoot!.querySelector<HTMLElement>("[popover]")!
          .getBoundingClientRect();
        expect(popup.left).toBeGreaterThanOrEqual(0);
        expect(popup.right).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `__screenshots__/a740-zones/counters-${locale}-${theme}-${width}.png`,
        });
      });
    }
  }
}
