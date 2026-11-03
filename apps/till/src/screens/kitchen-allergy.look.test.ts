import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { TillApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { TillStationQueue } from "../widgets/station-queue.js";
import type { TillPassBoard } from "../widgets/pass-board.js";
import { TillPassScreen } from "./till-pass-screen.js";
import { allergyBoard, allergyNotice, allergyQueue } from "../../test/kitchen-allergy-fixtures.js";

const locale = currentLocale();
const passRoot = (el: TillPassScreen) =>
  el.shadowRoot!.querySelector<TillPassBoard>("till-pass-board")!.shadowRoot!;
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
          for (const surface of ["board", "all", "pass", "monitor"] as const) {
            cleanupWidgets();
            let el: TillStationQueue | TillPassScreen;
            if (surface === "board") {
              const group = allergyQueue();
              group.items[0]!.allergy = {
                ...group.items[0]!.allergy!,
                note: "A separate pan and separate tools. " + "longinstruction".repeat(15),
              };
              ({ el } = await mountWidget<TillStationQueue>(
                "till-station-queue",
                {
                  groups: [group],
                  notices: [allergyNotice("changed"), allergyNotice("removed")],
                },
                theme,
              ));
            } else {
              const board = () => ({ board: allergyBoard(), stations: [], zones: null });
              const api = {
                getExpoBoard: vi.fn(async () => ({ board: allergyBoard() })),
                getDeviceIdentity: vi.fn(async () => ({ kitchenScreens: [] })),
                getDevicePassBoard: vi.fn(async () => board()),
                getDevicePassMonitorBoard: vi.fn(async () => board()),
              } as unknown as TillApi;
              const { el: pass } = await mountWidget<TillPassScreen>(
                "till-pass-screen",
                {
                  api,
                  deviceName: "Kitchen pass",
                  deviceMode: surface === "pass",
                  monitor: surface === "monitor",
                  ...(surface === "pass" || surface === "monitor" ? { initialBoard: board() } : {}),
                },
                theme,
              );
              el = pass;
              await vi.waitFor(() =>
                expect(passRoot(pass).querySelector('[data-item="ticked"]')).not.toBeNull(),
              );
            }
            await document.fonts.ready;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const root = el instanceof TillPassScreen ? passRoot(el) : el.shadowRoot!;
            const blocks = root.querySelectorAll<HTMLElement>("[data-kitchen-allergy]");
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
