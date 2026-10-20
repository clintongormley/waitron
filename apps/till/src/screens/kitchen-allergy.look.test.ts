import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { TillApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillStationQueue } from "../widgets/station-queue.js";
import { TillExpoScreen } from "./till-expo-screen.js";
import { allergyNotice, allergyOrder, allergyQueue } from "../../test/kitchen-allergy-fixtures.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

describe("A669 kitchen blocks LOOK", () => {
  for (const language of ["en", "es"] as const)
    for (const theme of ["light", "dark"] as const)
      for (const width of [390, 1280])
        it(`${language} ${theme} ${width}`, async () => {
          await page.viewport(width, 900);
          setLocale(language);
          for (const surface of ["rail", "kanban", "all", "pass", "monitor"] as const) {
            cleanupWidgets();
            let el: TillStationQueue | TillExpoScreen;
            if (surface === "rail" || surface === "kanban") {
              const group = allergyQueue();
              group.items[0]!.allergy = {
                ...group.items[0]!.allergy!,
                note: "A separate pan and separate tools. " + "longinstruction".repeat(15),
              };
              ({ el } = await mountWidget<TillStationQueue>(
                "till-station-queue",
                {
                  groups: [group],
                  view: surface,
                  notices: [allergyNotice("changed"), allergyNotice("removed")],
                },
                theme,
              ));
            } else {
              const orders = [allergyOrder()];
              const board = () => ({
                orders: orders.map((order) => ({
                  ...order,
                  courses: order.courses.map((course) => ({ ...course, allReady: false })),
                  groups: [],
                })),
                stations: [],
                zones: null,
              });
              const api = {
                getExpoQueue: vi.fn(async () => orders),
                getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
                getDevicePassScreen: vi.fn(async () => board()),
                getDevicePassMonitor: vi.fn(async () => board()),
              } as unknown as TillApi;
              ({ el } = await mountWidget<TillExpoScreen>(
                "till-expo-screen",
                {
                  api,
                  deviceName: "Kitchen pass",
                  deviceMode: surface === "pass",
                  monitor: surface === "monitor",
                  ...(surface === "pass" ? { initialDevicePass: board() } : {}),
                  ...(surface === "monitor" ? { initialDevicePassMonitor: board() } : {}),
                },
                theme,
              ));
              await vi.waitFor(() =>
                expect(el.shadowRoot!.querySelector('[data-item="ticked"]')).not.toBeNull(),
              );
            }
            await document.fonts.ready;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const blocks = el.shadowRoot!.querySelectorAll<HTMLElement>("[data-kitchen-allergy]");
            expect(blocks.length).toBeGreaterThan(0);
            for (const block of blocks) {
              expect(block.getBoundingClientRect().right).toBeLessThanOrEqual(width);
              expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth + 1);
            }
            await page.screenshot({
              path: `../../__screenshots__/a669-kitchen-blocks/${surface}-${language}-${theme}-${width}.png`,
            });
          }
        });
});
