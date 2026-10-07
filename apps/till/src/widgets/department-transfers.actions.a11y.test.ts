import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillApi } from "../api/client.js";
import type { DepartmentTransferDetail, TableState } from "../api/client.js";
import { TillDepartmentTransfers } from "./department-transfers.js";
const request = {
  id: "one",
  tabId: "tab",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "ana",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending" as const,
  reason: null,
  createdAt: "2026-10-07T09:00:00Z",
  resolvedAt: null,
  revision: 0,
};
const detail: DepartmentTransferDetail = {
  request,
  tab: {
    id: "tab",
    revision: 7,
    status: "placed",
    label: "Lunch / Almuerzo",
    orderNumber: 12,
    deliveryTableId: null,
  },
  lines: [
    {
      id: "line",
      name: "Soup / Sopa",
      variantName: null,
      quantity: "1.000",
      unitPriceGross: "2.80",
      note: "No salt / Sin sal",
      parentLineId: null,
    },
  ],
  outstandingWork: [
    {
      id: "work",
      lineId: "line",
      stationId: "kitchen",
      stationName: "Kitchen / Cocina",
      state: "preparing",
      note: "No salt / Sin sal",
      firedAt: null,
      awayAt: null,
      courseId: null,
    },
  ],
};
const table: TableState = {
  id: "table-one",
  label: "1",
  zoneId: "terrace",
  capacity: 4,
  state: "free",
  hasOpenTab: false,
  condition: "free",
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  enRoute: 0,
  timingBand: "fresh",
  status: null,
  nextReservation: null,
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
  party: null,
  signals: [],
};
afterEach(cleanupWidgets);
for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`receiving forms render accessibly in ${locale} ${theme} at ${width}`, async () => {
        const previous = currentLocale();
        await page.viewport(width, 900);
        try {
          setLocale(locale);
          const api = new TillApi(
            "",
            async (url, init) =>
              new Response(
                JSON.stringify(
                  init?.method === "POST"
                    ? {
                        error: {
                          code: "department_transfer.destination_invalid",
                          params: { field: "zoneId" },
                        },
                      }
                    : String(url).endsWith("/tables/state")
                      ? [table]
                      : detail,
                ),
                {
                  status: init?.method === "POST" ? 409 : 200,
                  headers: { "content-type": "application/json" },
                },
              ),
          );
          const { el, host } = await mountWidget<TillDepartmentTransfers>(
            "till-department-transfers",
            {
              api,
              open: true,
              serviceZones: [
                {
                  id: "terrace",
                  name: locale === "en-GB" ? "Restaurant terrace" : "Terraza del restaurante",
                  departmentId: "restaurant",
                  departmentName: "Restaurant",
                  serviceMode: "table_tab",
                },
              ],
              snapshot: {
                incoming: [request],
                receivingAllowed: true,
                sent: [],
                notifications: [],
                error: undefined,
              },
            },
            theme,
          );
          const click = (selector: string) =>
            el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
          click("[data-view]");
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-current-tab]")).not.toBeNull(),
          );
          click("[data-accept]");
          await vi.waitFor(() =>
            expect(
              el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
                "[data-save-transfer]",
              )?.disabled,
            ).toBe(false),
          );
          expect(window.innerWidth).toBe(width);
          await expectNoA11yViolations(host);
          click("[data-save-transfer]");
          await el.updateComplete;
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/w101-transfer-actions/${locale}-${theme}-${width}-accept.png`,
          });
          el.shadowRoot!.querySelector("[name=zoneId]")!.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "terrace" },
              bubbles: true,
              composed: true,
            }),
          );
          await el.updateComplete;
          click("[data-save-transfer]");
          await vi.waitFor(() =>
            expect(
              el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
                "[data-save-transfer]",
              )!.disabled,
            ).toBe(false),
          );
          await expectNoA11yViolations(host);
          click("[data-cancel-transfer]");
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-decline]")).not.toBeNull(),
          );
          click("[data-decline]");
          await el.updateComplete;
          await expectNoA11yViolations(host);
          click("[data-save-transfer]");
          await el.updateComplete;
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/w101-transfer-actions/${locale}-${theme}-${width}-decline.png`,
          });
          const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
          expect(
            dialog.shadowRoot!.querySelector("dialog")!.getBoundingClientRect().width,
          ).toBeLessThanOrEqual(width);
        } finally {
          setLocale(previous);
          await page.viewport(1280, 768);
        }
      });
    }
