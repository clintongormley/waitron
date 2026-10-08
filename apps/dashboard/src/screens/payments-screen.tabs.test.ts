import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { WtTabs } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, ReaderRow } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { PaymentsScreen } from "./payments-screen.js";
import "./payments-screen.js";

const reader: ReaderRow = {
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
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as DashboardApi;
}

async function mount(client = api()) {
  const { el, host } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: client,
    panels: [],
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull());
  await el.updateComplete;
  const tabs = el.shadowRoot!.querySelector<WtTabs>("wt-tabs")!;
  await tabs.updateComplete;
  return { el, host, tabs };
}

function selected(tabs: WtTabs): string | undefined {
  return tabs.shadowRoot!.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.dataset.key;
}

async function choose(tabs: WtTabs, key: string) {
  tabs.shadowRoot!.querySelector<HTMLElement>(`[data-key=${key}]`)!.click();
  await tabs.updateComplete;
}

beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/payments");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Card payments tabs", () => {
  it.each([
    { label: "no stored readers", readers: [], want: "providers" },
    { label: "an offline reader", readers: [reader], want: "readers" },
    { label: "a disabled reader", readers: [{ ...reader, active: false }], want: "readers" },
  ])("opens on $want with $label", async ({ readers, want }) => {
    const { tabs } = await mount(api(readers));
    await vi.waitFor(() => expect(selected(tabs)).toBe(want));
    expect(tabs.shadowRoot!.querySelectorAll("[role=tabpanel]:not([hidden])")).toHaveLength(1);
    expect(location.pathname).toBe(`/manage/payments/view/${want}`);
  });

  it("chooses from the reader list once it answers without hiding the available controls", async () => {
    let answer!: (rows: ReaderRow[]) => void;
    const pending = new Promise<ReaderRow[]>((resolve) => {
      answer = resolve;
    });
    const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
      api: api([], { listReaders: vi.fn().mockReturnValue(pending) }),
      panels: [],
    });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector<WtTabs>("wt-tabs")?.value).toBe("providers");
    answer([reader]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector<WtTabs>("wt-tabs")?.value).toBe("readers"),
    );
  });

  it.each(["providers", "readers"])("honours a direct link to %s", async (view) => {
    history.replaceState(null, "", `/manage/payments/view/${view}`);
    const { tabs } = await mount(api(view === "providers" ? [reader] : []));
    expect(selected(tabs)).toBe(view);
  });

  it("falls back to the reader-based default for an unknown linked tab", async () => {
    history.replaceState(null, "", "/manage/payments/view/missing");
    const { tabs } = await mount();
    expect(selected(tabs)).toBe("readers");
    expect(location.pathname).toBe("/manage/payments/view/readers");
  });

  it("switches the visible panel and keeps the reader filter and table mounted", async () => {
    const { el, tabs } = await mount();
    const table = el.shadowRoot!.querySelector("wt-data-table");
    const filter = el.shadowRoot!.querySelector("wt-combobox")!;
    filter.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "disabled" } }));
    await el.updateComplete;
    await page.getByRole("tab", { name: "Providers", exact: true }).click();
    await el.updateComplete;
    expect(selected(tabs)).toBe("providers");
    expect(location.pathname).toBe("/manage/payments/view/providers");
    await page.getByRole("tab", { name: "Card readers", exact: true }).click();
    await el.updateComplete;
    expect(selected(tabs)).toBe("readers");
    expect(el.shadowRoot!.querySelector("wt-data-table")).toBe(table);
    expect(el.shadowRoot!.querySelector("wt-combobox")).toBe(filter);
    expect(filter.getAttribute("name")).toBe("reader-status-filter");
    expect((filter as HTMLElement & { value: string }).value).toBe("disabled");
  });

  it("does not replace a chosen tab when live data adds or removes readers", async () => {
    const liveData = new LiveData();
    const client = Object.assign(
      api([], {
        listReaders: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([reader]),
      }),
      { liveData },
    );
    const { tabs, el } = await mount(client);
    await choose(tabs, "readers");
    await choose(tabs, "providers");
    await el.updateComplete;
    liveData.refresh();
    await vi.waitFor(() => expect(client.listReaders).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    expect(selected(tabs)).toBe("providers");
    await choose(tabs, "readers");
    vi.mocked(client.listReaders).mockResolvedValue([]);
    liveData.refresh();
    await vi.waitFor(() => expect(client.listReaders).toHaveBeenCalledTimes(3));
    await el.updateComplete;
    expect(selected(tabs)).toBe("readers");
  });

  it("chooses the initial tab when a failed opening read recovers", async () => {
    const liveData = new LiveData();
    const client = Object.assign(
      api([], {
        listReaders: vi
          .fn()
          .mockRejectedValueOnce({ code: "connection.failed" })
          .mockResolvedValue([reader]),
      }),
      { liveData },
    );
    const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
      api: client,
      panels: [],
    });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
    expect(el.shadowRoot!.querySelector<WtTabs>("wt-tabs")?.value).toBe("providers");
    liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector<WtTabs>("wt-tabs")?.value).toBe("readers"),
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  });

  it("restores tab selection on browser navigation", async () => {
    const { tabs, el } = await mount();
    await choose(tabs, "providers");
    history.replaceState(null, "", "/manage/payments/view/readers");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await el.updateComplete;
    await tabs.updateComplete;
    expect(selected(tabs)).toBe("readers");
  });
});
