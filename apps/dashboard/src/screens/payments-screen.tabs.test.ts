import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, ReaderRow } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { PaymentsScreen } from "./payments-screen.js";
import "./payments-screen.js";

const reader: ReaderRow = {
  printsOwnSlipAutomatically: false,
  id: "counter",
  provider: "acme",
  name: "Counter",
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
};

function api(readers: ReaderRow[] = [reader], overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listPaymentProviders: vi.fn().mockResolvedValue([]),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    readerStatus: vi.fn().mockResolvedValue({ online: false }),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckTenderRefunds: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    listHeldPayments: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
}

beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/payments");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Card payments reader tools", () => {
  it.each([{ readers: [] }, { readers: [reader] }])(
    "keeps reader controls and the Modules link available with $readers",
    async ({ readers }) => {
      const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
        api: api(readers),
        panels: [],
      });
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
      expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=refresh-readers]")).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector("[data-test=configure-providers]")?.getAttribute("href"),
      ).toBe("/manage/modules/view/card-providers/state/all");
    },
  );
});
