import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillApi } from "../api/client.js";
import { TillDepartmentTransfers } from "./department-transfers.js";

const incoming = {
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
  summary: {
    orderNumber: 12,
    tabLabel: "Ana's lunch / Almuerzo de Ana",
    sourceDepartmentName: "Deli counter / Mostrador",
    destinationDepartmentName: "Restaurant desk / Restaurante",
  },
};
const sent = {
  ...incoming,
  id: "sent-1",
  status: "declined" as const,
  reason: "Closing soon / Cerramos pronto",
  summary: { ...incoming.summary, orderNumber: 34, tabLabel: "Pablo's dinner / Cena de Pablo" },
};
const detail = {
  request: incoming,
  tab: {
    id: "tab-1",
    revision: 9,
    status: "placed",
    label: incoming.summary.tabLabel,
    orderNumber: 12,
    deliveryTableId: null,
  },
  lines: [
    {
      id: "line-1",
      name: "Soup / Sopa",
      variantName: null,
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
      stationId: "kitchen-uuid",
      stationName: "Deli grill / Plancha",
      state: "preparing",
      note: "Collect at deli / Recoger en mostrador",
      firedAt: null,
      awayAt: null,
      courseId: null,
    },
  ],
};
afterEach(cleanupWidgets);
for (const locale of ["en-GB", "es-ES"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      it(`identifies incoming and resolved tabs and their recorded station in ${locale}/${theme}/${width}`, async () => {
        const previous = currentLocale();
        await page.viewport(width, 900);
        try {
          setLocale(locale);
          const api = new TillApi(
            "",
            async () =>
              new Response(JSON.stringify(detail), {
                headers: { "content-type": "application/json" },
              }),
          );
          const { el, host } = await mountWidget<TillDepartmentTransfers>(
            "till-department-transfers",
            {
              api,
              snapshot: {
                incoming: [incoming],
                sent: [sent],
                receivingAllowed: true,
                notifications: [incoming, sent],
                error: undefined,
              },
            },
            theme,
          );
          const check = (selector: string, number: number, label: string) => {
            const text = el.shadowRoot!.querySelector(selector)?.textContent;
            expect(text).toContain(`${locale === "es-ES" ? "Cuenta" : "Tab"} ${number}`);
            expect(text).toContain(label);
            expect(text).toContain("Deli counter / Mostrador");
            expect(text).toContain("Restaurant desk / Restaurante");
          };
          check("[data-notification=incoming-1]", 12, incoming.summary.tabLabel);
          check("[data-notification=sent-1]", 34, sent.summary.tabLabel);
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/w101-transfer-summaries/${locale}-${theme}-${width}-notices.png`,
          });
          el.open = true;
          await el.updateComplete;
          check("[data-incoming=incoming-1]", 12, incoming.summary.tabLabel);
          check("[data-sent=sent-1]", 34, sent.summary.tabLabel);
          expect(el.shadowRoot!.querySelector("[data-sent=sent-1]")?.textContent).toContain(
            sent.reason,
          );
          el.shadowRoot!.querySelector<HTMLElement>("[data-view]")!.click();
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[data-current-work]")?.textContent).toContain(
              "Deli grill / Plancha",
            ),
          );
          expect(el.shadowRoot!.querySelector("[data-current-work]")?.textContent).toContain(
            "Soup / Sopa",
          );
          expect(el.shadowRoot!.querySelector("[data-current-work]")?.textContent).toContain(
            "Collect at deli / Recoger en mostrador",
          );
          expect(el.shadowRoot!.querySelector("[data-current-work]")?.textContent).not.toContain(
            "kitchen-uuid",
          );
          await expectNoA11yViolations(host);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
          await page.screenshot({
            path: `../../__screenshots__/w101-transfer-summaries/${locale}-${theme}-${width}-detail.png`,
          });
        } finally {
          setLocale(previous);
          await page.viewport(1280, 768);
        }
      });
    }
  }
}
