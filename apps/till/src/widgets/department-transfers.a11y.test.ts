import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillApi, type DepartmentTransferDetail } from "../api/client.js";
import type { TransferSnapshot } from "../state/department-transfer-monitor.js";
import { TillDepartmentTransfers } from "./department-transfers.js";

const request = {
  id: "incoming-1",
  tabId: "tab-1",
  sourceDepartmentId: "deli",
  destinationDepartmentId: "restaurant",
  senderId: "ana",
  resolvedBy: null,
  destinationZoneId: null,
  status: "pending" as const,
  reason: null,
  createdAt: "2026-10-07T09:00:00.000Z",
  resolvedAt: null,
  revision: 0,
};
const detail: DepartmentTransferDetail = {
  request,
  tab: {
    id: "tab-1",
    revision: 9,
    status: "placed",
    label: "Lunch / Almuerzo",
    orderNumber: 12,
    deliveryTableId: null,
  },
  lines: [
    {
      id: "line-1",
      name: "Soup / Sopa",
      variantName: "Small / Pequeña",
      quantity: "0.500",
      unitPriceGross: "2.80",
      note: "No salt / Sin sal",
      parentLineId: null,
    },
  ],
  outstandingWork: [
    {
      id: "work-1",
      lineId: "line-1",
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
afterEach(cleanupWidgets);

for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"]) {
    describe(`${locale}, ${theme}`, () => {
      for (const width of [390, 1280]) {
        it(`renders notices, queue, current work, refusal and empty states accessibly at ${width}`, async () => {
          const previousLocale = currentLocale();
          await page.viewport(width, 900);
          try {
            setLocale(locale);
            let respond!: (value: Response) => void;
            const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
              () =>
                new Promise((resolve) => {
                  respond = resolve;
                }),
            );
            const snapshot: TransferSnapshot = {
              incoming: [request],
              receivingAllowed: true,
              sent: [
                {
                  ...request,
                  id: "sent-1",
                  status: "declined",
                  reason: "Closing soon / Cerramos pronto",
                },
              ],
              notifications: [request],
              error: undefined,
            };
            const { el, host } = await mountWidget<TillDepartmentTransfers>(
              "till-department-transfers",
              {
                api: new TillApi("", fetchImpl),
                snapshot,
              },
            );
            host.setAttribute("data-theme", theme);
            expect(window.innerWidth).toBe(width);
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `../../__screenshots__/w101-transfer-notices/${locale}-${theme}-${width}-notices.png`,
            });
            el.open = true;
            await el.updateComplete;
            await expectNoA11yViolations(host);
            el.shadowRoot!.querySelector<HTMLElement>("[data-view]")!.click();
            await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
            await expectNoA11yViolations(host);
            respond(
              new Response(JSON.stringify(detail), {
                headers: { "content-type": "application/json" },
              }),
            );
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[data-current-tab]")?.textContent).toContain(
                "Lunch",
              ),
            );
            await expectNoA11yViolations(host);
            await page.screenshot({
              path: `../../__screenshots__/w101-transfer-notices/${locale}-${theme}-${width}-detail.png`,
            });
            el.shadowRoot!.querySelector<HTMLElement>("[data-refresh-detail]")!.click();
            await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
            respond(
              new Response(
                JSON.stringify({
                  error: { code: "department_transfer.tab_unavailable", params: {} },
                }),
                { status: 409, headers: { "content-type": "application/json" } },
              ),
            );
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull(),
            );
            expect(el.shadowRoot!.querySelector("[data-current-tab]")).toBeNull();
            expect(
              el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
                "[data-refresh-detail]",
              )!.disabled,
            ).toBe(false);
            await expectNoA11yViolations(host);
            el.snapshot = {
              ...snapshot,
              incoming: [],
              sent: [],
              notifications: [],
              error: undefined,
            };
            await el.updateComplete;
            expect(el.shadowRoot!.querySelector("[data-refresh-detail]")).toBeNull();
            await expectNoA11yViolations(host);
            el.open = false;
            await el.updateComplete;
            expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
          } finally {
            setLocale(previousLocale);
            await page.viewport(1280, 768);
          }
        });
      }
    });
  }
}
