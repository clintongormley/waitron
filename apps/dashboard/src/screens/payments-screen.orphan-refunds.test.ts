import { afterEach, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import "./payments-screen.js";
import type { PaymentsScreen } from "./payments-screen.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it.each(["en", "es"] as const)(
  "shows confirmed and unconfirmed refunds in %s and refreshes passively",
  async (locale) => {
    setLocale(locale);
    const rows = ["confirmed", "unconfirmed"].map((outcome) => ({
      paymentRef: `lost-${outcome}`,
      workingOrderId: "order-1",
      externalRef: `charge-${outcome}`,
      amount: "10.00",
      claimedAt: "2026-07-01T12:00:00.000Z",
      outcome,
    }));
    const liveData = new LiveData();
    const read = vi.fn().mockResolvedValue(rows);
    const api = {
      liveData,
      background: { listAbandonedRefunds: read },
      listPaymentProviders: async () => [],
      listReaders: async () => [],
      listReaderHolders: async () => [],
      listStuckPayments: async () => [],
      listStuckBillPayments: async () => [],
      listStuckTenderRefunds: async () => [],
      listStuckBillRefunds: async () => [],
      listHeldPayments: async () => [],
      listAbandonedRefunds: vi.fn(() => {
        throw new Error("active read");
      }),
    } as unknown as DashboardApi;
    const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
      api,
      panels: [],
    });
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector('[data-test="abandoned-refunds"]')?.textContent,
      ).toContain("charge-unconfirmed"),
    );
    const section = el.shadowRoot!.querySelector('[data-test="abandoned-refunds"]')!;
    expect(section.textContent).toContain("lost-confirmed");
    expect(section.textContent).toContain(
      locale === "en" ? "Refund confirmed" : "Devolución confirmada",
    );
    expect(section.textContent).toContain(
      locale === "en" ? "Check SumUp before refunding" : "Comprueba SumUp antes de devolver",
    );
    expect(section.querySelectorAll("button, wt-button")).toHaveLength(0);
    read.mockResolvedValue([]);
    liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="abandoned-refunds"]')).toBeNull(),
    );
  },
);
