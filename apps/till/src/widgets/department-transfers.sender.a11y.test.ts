import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { TillApi, type DepartmentTransfer } from "../api/client.js";
import { TillDepartmentTransfers } from "./department-transfers.js";
afterEach(cleanupWidgets);
for (const locale of ["en-GB", "es-ES"])
  for (const theme of ["light", "dark"] as const)
    for (const width of [390, 1280]) {
      it(`sender controls render accessibly in ${locale} ${theme} at ${width}`, async () => {
        const previous = currentLocale();
        await page.viewport(width, 900);
        try {
          setLocale(locale);
          const request: DepartmentTransfer = {
            id: "sent-one",
            tabId: "tab-one",
            sourceDepartmentId: "deli",
            destinationDepartmentId: "restaurant",
            senderId: "ana",
            resolvedBy: null,
            destinationZoneId: null,
            status: "pending",
            reason: null,
            createdAt: "2026-10-07T09:00:00Z",
            resolvedAt: null,
            revision: 0,
          };
          const json = (value: unknown, status = 200) =>
            new Response(JSON.stringify(value), {
              status,
              headers: { "content-type": "application/json" },
            });
          const { el, host } = await mountWidget<TillDepartmentTransfers>(
            "till-department-transfers",
            {
              api: new TillApi("", async (_, init) =>
                init?.method === "POST"
                  ? json(
                      {
                        error: {
                          code: "management.request_invalid",
                          params: { field: "destinationDepartmentId" },
                        },
                      },
                      409,
                    )
                  : json({
                      destinations: [
                        {
                          id: "restaurant",
                          name: locale === "en-GB" ? "Restaurant" : "Restaurante",
                        },
                      ],
                    }),
              ),
              open: true,
              currentTabId: "tab-one",
              currentTabLabel: locale === "en-GB" ? "Tab 12 — Lunch" : "Cuenta 12 — Almuerzo",
              snapshot: {
                incoming: [],
                sent: [],
                notifications: [],
                receivingAllowed: false,
                error: undefined,
              },
            },
            theme,
          );
          const click = (selector: string) =>
            el.shadowRoot!.querySelector<HTMLElement>(selector)!.click();
          expect(el.shadowRoot!.querySelector("[data-request-transfer]")!.textContent?.trim()).toBe(
            locale === "en-GB" ? "Request transfer" : "Solicitar traspaso",
          );
          click("[data-request-transfer]");
          await vi.waitFor(() =>
            expect(
              el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
                "[data-save-transfer]",
              )?.disabled,
            ).toBe(false),
          );
          await expectNoA11yViolations(host);
          click("[data-save-transfer]");
          await el.updateComplete;
          await expectNoA11yViolations(host);
          const field = el.shadowRoot!.querySelector("[name=destinationDepartmentId]")!;
          field.dispatchEvent(
            new CustomEvent("wt-change", {
              detail: { value: "restaurant" },
              bubbles: true,
              composed: true,
            }),
          );
          await el.updateComplete;
          click("[data-save-transfer]");
          await vi.waitFor(() =>
            expect((field as HTMLElement & { error: string }).error).not.toBe(""),
          );
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/w101-transfer-sender/${locale}-${theme}-${width}-request.png`,
          });
          expect(
            el
              .shadowRoot!.querySelector("wt-dialog")!
              .shadowRoot!.querySelector("dialog")!
              .getBoundingClientRect().width,
          ).toBeLessThanOrEqual(width);
          click("[data-cancel-transfer]");
          await vi.waitFor(() =>
            expect(el.shadowRoot!.querySelector("[name=destinationDepartmentId]")).toBeNull(),
          );
          el.snapshot = { ...el.snapshot, sent: [request] };
          await el.updateComplete;
          expect(
            el.shadowRoot!.querySelector("[data-withdraw-transfer]")!.textContent?.trim(),
          ).toBe(locale === "en-GB" ? "Withdraw request" : "Retirar solicitud");
          await expectNoA11yViolations(host);
          await page.screenshot({
            path: `../../__screenshots__/w101-transfer-sender/${locale}-${theme}-${width}-pending.png`,
          });
        } finally {
          setLocale(previous);
          await page.viewport(1280, 768);
        }
      });
    }
