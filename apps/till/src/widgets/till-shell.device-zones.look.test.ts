import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { TillShell } from "./till-shell.js";
import type { TillFloorScreen } from "../screens/till-floor-screen.js";
import type { TableState } from "../api/floor-api.js";
import { table } from "../../test/allergy-app-fixture.js";
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
              layoutSetName: null,
              layoutDue: null,
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
              layoutSetName: null,
              layoutDue: null,
              serviceMode: "table_tab",
            },
          ],
          tables: [
            {
              id: "table",
              label: "1",
              shortName: "1",
              zoneId: "room",
              state: "free",
              condition: "free",
              hasOpenTab: false,
              pendingDeliveries: 0,
              pendingToServe: 0,
              readyToServe: 0,
              timingBand: "fresh",
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
                zoneRevision: 0,
              },
            } satisfies TableState,
          ],
        });
        el.appendChild(floor);
        await floor.updateComplete;
        const narrow = width === 390;
        const footer = () => el.shadowRoot!.querySelector<HTMLElement>("[data-floor-bar]");
        await vi.waitFor(() => expect(footer() !== null).toBe(narrow));
        const zoneMenu = floor.shadowRoot!.querySelector("till-floor-zone-menu")!;
        const actions = narrow
          ? footer()!.querySelector('wt-row-actions[data-test="more-menu"]')!
          : zoneMenu.shadowRoot!.querySelector("wt-row-actions")!;
        const view = (narrow ? footer()! : floor.shadowRoot!).querySelector<HTMLElement>(
          "[data-view-toggle]",
        )!;
        const pressView = async () => {
          await userEvent.click(view);
          await floor.updateComplete;
        };
        await pressView();
        expect(floor.shadowRoot!.querySelector("wt-floor-map")).toBeNull();
        await pressView();
        expect(floor.shadowRoot!.querySelector("wt-floor-map")).not.toBeNull();
        await userEvent.click(actions.shadowRoot!.querySelector("button")!);
        const popupOpen = () =>
          actions.shadowRoot!.querySelector("[popover]")!.matches(":popover-open");
        expect(popupOpen()).toBe(true);
        await userEvent.keyboard("{Escape}");
        expect(popupOpen()).toBe(false);
        const zoneControl = narrow
          ? footer()!.querySelector("[data-floor-zone-chooser]")!
          : floor.shadowRoot!.querySelector(".tabs wt-button")!;
        const controlRow = narrow ? footer()! : floor.shadowRoot!.querySelector(".actions")!;
        expect(controlRow.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        const mid = (element: Element) => {
          const { top, height } = element.getBoundingClientRect();
          return top + height / 2;
        };
        expect(Math.abs(mid(view) - mid(zoneControl))).toBeLessThan(1);
        await page.screenshot({
          path: `__screenshots__/a740-zones/floor-${locale}-${theme}-${width}.png`,
        });
        const menu = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
          narrow ? "[data-floor-zone-chooser]" : "[data-counter-zones]",
        )!;
        await menu.updateComplete;
        await userEvent.click(menu.shadowRoot!.querySelector("button")!);
        expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
        const counterRow = narrow ? "data-floor-counter-zone" : "data-counter-zone";
        expect(
          [...menu.querySelectorAll(`[${counterRow}]`)].map((row) => row.getAttribute(counterRow)),
        ).toEqual(["bar", "shop"]);
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

it("keeps at least six full table targets and a one-line Spanish hint on the landscape floor", async () => {
  setLocale("es-ES");
  await page.viewport(700, 390);
  const { el } = await mountWidget<TillShell>("till-shell", {
    activeScreen: "floor",
    formFactor: "phone-portrait",
    operatorName: "Ana",
  });
  el.style.position = "fixed";
  el.style.inset = "24px";
  el.style.height = "auto";
  el.style.setProperty("--wt-page-padding", "24px");
  const floor = document.createElement("till-floor-screen");
  floor.zones = [
    {
      id: "z1",
      name: "Dining room",
      displayOrder: 0,
      active: true,
      closed: false,
      hasPlan: true,
      layoutSetName: "Dinner",
      serviceMode: "table_tab",
      closesAt: null,
      layoutDue: null,
    },
  ];
  floor.tables = Array.from({ length: 8 }, (_, index) => ({
    ...table(`t${index + 1}`, String(index + 1), null),
    today: {
      placement: {
        x: (index % 2) * 4,
        y: index < 6 ? Math.floor(index / 2) * 3 : 13,
        width: 2,
        height: 2,
        shape: index === 0 ? "round" : "rect",
        rotation: 0,
      },
      seats: 4,
      fixed: false,
      takenOff: false,
      joinId: null,
      joinSeats: null,
      zoneRevision: 0,
    },
  }));
  el.append(floor);
  await vi.waitFor(() => {
    const map = floor.shadowRoot!.querySelector("wt-floor-map")!.shadowRoot!;
    const plan = map.querySelector(".plan")!.getBoundingClientRect();
    const hint = map.querySelector(".pan-hint");
    expect(hint).not.toBeNull();
    const hintBox = hint!.getBoundingClientRect();
    const visible = Array.from(map.querySelectorAll('[part="shape"]'), (shape) =>
      shape.getBoundingClientRect(),
    ).filter(
      (box) =>
        box.left >= plan.left &&
        box.right <= plan.right &&
        box.top >= plan.top &&
        box.bottom <= plan.bottom,
    );
    expect(visible.length).toBeGreaterThanOrEqual(6);
    for (const box of visible) {
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      expect(
        hintBox.right <= box.left ||
          hintBox.left >= box.right ||
          hintBox.bottom <= box.top ||
          hintBox.top >= box.bottom,
      ).toBe(true);
    }
    const text = document.createRange();
    text.selectNodeContents(hint!);
    expect(text.getClientRects()).toHaveLength(1);
    expect(hint!.textContent!.trim().length).toBeLessThanOrEqual(23);
  });
});
