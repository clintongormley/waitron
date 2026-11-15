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
    listAbandonedRefunds: vi.fn().mockResolvedValue([]),
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
      expect(
        [...el.shadowRoot!.querySelectorAll("h2")].map((heading) => heading.textContent),
      ).toEqual(["Providers", "Card readers"]);
      expect(el.shadowRoot!.querySelector("[data-test=refresh-readers]")).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector("[data-test=configure-providers]")?.getAttribute("href"),
      ).toBe("/manage/modules/view/card-providers/state/all");
    },
  );
});

const readerReads = ["listPaymentProviders", "listReaders", "listReaderHolders", "readerStatus"] as const;
const recoveryReads = [
  "listStuckPayments",
  "listStuckBillPayments",
  "listStuckTenderRefunds",
  "listStuckBillRefunds",
  "listAbandonedRefunds",
  "listHeldPayments",
] as const;

it.each(["readers", "checks"] as const)(
  "loads only the initial reads owned by the %s page",
  async (surface) => {
    const client = api();
    const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
      api: client,
      panels: [],
      surface,
    });
    const allowed = surface === "readers" ? readerReads : recoveryReads;
    const excluded = surface === "readers" ? recoveryReads : readerReads;
    await vi.waitFor(() => {
      for (const name of allowed) expect(client[name]).toHaveBeenCalledTimes(1);
    });
    await Promise.all(allowed.map((name) => vi.mocked(client[name]).mock.results[0]!.value));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    for (const name of excluded) expect(client[name]).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("h1")?.textContent?.trim()).toBe(
      surface === "checks" ? "Check card payments" : "Card payments",
    );
    expect(el.shadowRoot!.querySelector("[data-test=readers-section]") !== null).toBe(
      surface === "readers",
    );
    expect(el.shadowRoot!.querySelector("wt-button[aria-expanded]") !== null).toBe(
      surface === "checks",
    );
  },
);
