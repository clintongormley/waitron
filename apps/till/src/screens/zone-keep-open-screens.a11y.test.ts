import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { TillApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { WorkingOrderStore } from "../state/working-order.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { TillCounterScreen } from "./till-counter-screen.js";
import { TillTableOrderScreen } from "./till-table-order-screen.js";
import { TillFloorScreen } from "./till-floor-screen.js";
import type { TillKeepOpen } from "../widgets/keep-open.js";
afterEach(cleanupWidgets);
for (const locale of ["en", "es"] as const)
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      describe(`${locale} ${theme} ${width}px zone recovery`, () => {
        for (const kind of ["counter", "table", "floor"] as const)
          it(`${kind} stays accessible when open, closing, closed and extended`, async () => {
            const previous = currentLocale();
            try {
              setLocale(locale);
              await page.viewport(width, 900);
              expect(window.innerWidth).toBe(width);
              for (const state of ["open", "closing", "closed", "extended"] as const) {
                const name = locale === "en" ? "Terrace" : "Terraza";
                const closesAt = state === "extended" ? "22:30" : "22:00";
                const closed = state === "closed";
                const zone = {
                  id: "terrace",
                  name,
                  endsAt: closesAt,
                  running: !closed,
                  extendedUntil: state === "extended" ? "22:30" : null,
                  dayEndsAt: "05:00",
                  choices: ["22:45", "23:00"],
                  next: null,
                };
                const api = new TillApi(
                  "",
                  vi.fn(
                    async () =>
                      new Response(JSON.stringify({ period: null, zone }), {
                        headers: { "content-type": "application/json" },
                      }),
                  ),
                );
                const service = {
                  open: true,
                  zoneOpen: !closed,
                  periodName: locale === "en" ? "Dinner" : "Cena",
                  keepOpen: null,
                  zoneKeepOpen:
                    state === "open"
                      ? null
                      : {
                          zoneId: "terrace",
                          zoneName: name,
                          closesAt,
                          running: !closed,
                          extendedUntil: zone.extendedUntil,
                        },
                };
                const shared = {
                  api,
                  service,
                  zoneName: name,
                  departmentName: locale === "en" ? "Restaurant" : "Restaurante",
                };
                const { el, host } =
                  kind === "counter"
                    ? await mountWidget<TillCounterScreen>(
                        "till-counter-screen",
                        {
                          ...shared,
                          embedded: true,
                          selectedServiceZoneId: "terrace",
                          store: new WorkingOrderStore(),
                          counterTab: {
                            key: "counter",
                            title: "Counter",
                            columns: 4,
                            cards: [{ type: "basket", colSpan: 4, rowSpan: 2, config: {} }],
                          },
                        },
                        theme,
                      )
                    : kind === "table"
                      ? await mountWidget<TillTableOrderScreen>(
                          "till-table-order-screen",
                          { ...shared, zoneId: "terrace", draftStore: new WorkingOrderStore() },
                          theme,
                        )
                      : await mountWidget<TillFloorScreen>(
                          "till-floor-screen",
                          {
                            api,
                            zones: [
                              {
                                id: "terrace",
                                name,
                                displayOrder: 0,
                                active: true,
                                closed,
                                closesAt: state === "open" ? null : closesAt,
                              },
                            ],
                            tables: [],
                          },
                          theme,
                        );
                const widget = el.shadowRoot!.querySelector<TillKeepOpen>(
                  'till-keep-open[subject="zone"]',
                );
                if (state === "open") expect(widget).toBeNull();
                else {
                  expect(widget).not.toBeNull();
                  await widget!.updateComplete;
                  const button = widget!.shadowRoot!.querySelector<HTMLElement>("[data-action]")!;
                  expect(button.textContent!.trim()).toBe(
                    locale === "en" ? "Keep Terrace open later" : "Ampliar el horario de Terraza",
                  );
                  const bounds = button.getBoundingClientRect();
                  expect(bounds.width).toBeGreaterThan(0);
                  expect(bounds.left).toBeGreaterThanOrEqual(0);
                  expect(bounds.right).toBeLessThanOrEqual(width);
                }
                await expectNoA11yViolations(host);
                await page.screenshot({
                  path: `__screenshots__/a366-zone-keep-open/${kind}-${locale}-${theme}-${width}-${state}.png`,
                });
                if (state === "closed") {
                  widget!.shadowRoot!.querySelector<HTMLElement>("[data-action]")!.click();
                  await expect
                    .poll(() => widget!.shadowRoot!.querySelector("till-keep-open-dialog"))
                    .not.toBeNull();
                  const d = widget!.shadowRoot!.querySelector("till-keep-open-dialog")!;
                  await d.updateComplete;
                  await d.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
                  expect(d.shadowRoot!.querySelector("[data-ends]")!.textContent!.trim()).toBe(
                    locale === "en" ? "Terrace is closed now." : "Terraza está cerrada ahora.",
                  );
                  await expectNoA11yViolations(host);
                  await page.screenshot({
                    path: `__screenshots__/a366-zone-keep-open/${kind}-${locale}-${theme}-${width}-dialog.png`,
                  });
                }
                cleanupWidgets();
              }
            } finally {
              setLocale(previous);
              await page.viewport(1280, 768);
            }
          });
      });
    }
