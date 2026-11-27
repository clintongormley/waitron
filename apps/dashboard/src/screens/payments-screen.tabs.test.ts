import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../api/client.js";
import type { PaymentProviderRow, ReaderRow } from "../api/payments-api.js";
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
    getPaymentSettings: vi.fn().mockResolvedValue({
      tipsEnabled: false,
      testProviders: false,
      testProvidersAvailable: false,
      revision: 0,
    }),
    listPaymentProviders: vi.fn().mockResolvedValue([]),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    readerStatus: vi.fn().mockResolvedValue({ online: false }),
    availableReaders: vi.fn().mockResolvedValue([]),
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
  history.replaceState(null, "", "/payments");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Card readers tools", () => {
  it.each([
    { readers: [], providers: [] },
    {
      readers: [reader],
      providers: [{ providerId: "acme", state: "not_connected", canUnpair: false }],
    },
  ])(
    "keeps reader controls and provider setup available without connected providers ($readers)",
    async ({ readers, providers }) => {
      const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
        api: api(readers, { listPaymentProviders: vi.fn().mockResolvedValue(providers) }),
        panels: [],
      });
      await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-data-table")).not.toBeNull());
      expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
      const settings = el.shadowRoot!.querySelector("dashboard-payments-settings");
      expect(settings).not.toBeNull();
      const section = el.shadowRoot!.querySelector("[data-test=readers-section]")!;
      expect(section.querySelector("wt-data-table")?.getAttribute("aria-label")).toBe(
        "Card readers",
      );
      expect(section.nextElementSibling).toBe(settings);
      expect(el.shadowRoot!.querySelector("h2")).toBeNull();
      expect(el.shadowRoot!.querySelector("[data-test=refresh-readers]")).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector("[data-test=configure-providers]")?.getAttribute("href"),
      ).toBe("/modules/view/card-providers/state/all/return-to/card-readers");
      expect(el.shadowRoot!.querySelector("[data-test=add-reader]")).toBeNull();
    },
  );
});

const readerReads = [
  "getPaymentSettings",
  "listPaymentProviders",
  "listReaders",
  "listReaderHolders",
  "readerStatus",
] as const;
const recoveryReads = [
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
      surface === "checks" ? "Check card payments" : "Card readers",
    );
    expect(el.shadowRoot!.querySelector("[data-test=readers-section]") !== null).toBe(
      surface === "readers",
    );
    expect(el.shadowRoot!.querySelector("wt-button[aria-expanded]") !== null).toBe(
      surface === "checks",
    );
  },
);

const connected: PaymentProviderRow = { providerId: "acme", state: "connected", canUnpair: true };

it("opens discovery from the top Add reader for the only connected provider, without a panel", async () => {
  const client = api([], {
    listPaymentProviders: vi
      .fn()
      .mockResolvedValue([
        connected,
        { providerId: "zeta", state: "not_connected", canUnpair: false },
      ]),
  });
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: client,
    panels: [],
  });
  const root = el.shadowRoot!;
  await vi.waitFor(() =>
    expect(
      root
        .querySelector("[data-test=add-reader]")
        ?.shadowRoot?.querySelector<HTMLButtonElement>("button")?.disabled,
    ).toBe(false),
  );
  await vi.waitFor(() => expect(root.querySelector("wt-data-table")).not.toBeNull());
  const add = root.querySelector<HTMLElement>("[data-test=add-reader]")!;
  expect(
    add.compareDocumentPosition(root.querySelector("wt-data-table")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(root.querySelector("[data-test=configure-providers]")).toBeNull();
  add.click();
  await vi.waitFor(() => expect(root.querySelector("[data-test=reader-discovery]")).not.toBeNull());
  expect(client.availableReaders).toHaveBeenCalledExactlyOnceWith("acme");
  expect(root.querySelector("[data-test=choose-reader-provider]")).toBeNull();
});

it("asks which connected provider to discover and keeps provider setup in that choice", async () => {
  const client = api([], {
    listPaymentProviders: vi
      .fn()
      .mockResolvedValue([
        connected,
        { ...connected, providerId: "zeta" },
        { providerId: "other", state: "not_connected", canUnpair: false },
      ]),
  });
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: client,
    panels: [],
  });
  const root = el.shadowRoot!;
  await vi.waitFor(() =>
    expect(
      root
        .querySelector("[data-test=add-reader]")
        ?.shadowRoot?.querySelector<HTMLButtonElement>("button")?.disabled,
    ).toBe(false),
  );
  root.querySelector<HTMLElement>("[data-test=add-reader]")!.click();
  await el.updateComplete;
  const choice = root.querySelector("[data-test=choose-reader-provider]")!;
  expect(choice).not.toBeNull();
  expect(client.availableReaders).not.toHaveBeenCalled();
  expect(choice.querySelector("[data-test=add-reader-other]")).toBeNull();
  expect(choice.querySelector("a")?.getAttribute("href")).toBe(
    "/modules/view/card-providers/state/all/return-to/card-readers",
  );
  choice.querySelector<HTMLElement>("[data-test=add-reader-zeta]")!.click();
  await vi.waitFor(() => expect(root.querySelector("[data-test=reader-discovery]")).not.toBeNull());
  expect(client.availableReaders).toHaveBeenCalledExactlyOnceWith("zeta");
  expect(root.querySelector("[data-test=choose-reader-provider]")).toBeNull();
});

it("keeps Add unavailable while the provider read is pending or failed, without claiming there are no providers", async () => {
  let reject!: (reason: unknown) => void;
  const client = api([], {
    listPaymentProviders: vi.fn(
      () =>
        new Promise<PaymentProviderRow[]>((_resolve, no) => {
          reject = no;
        }),
    ),
  });
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: client,
    panels: [],
  });
  const root = el.shadowRoot!;
  await vi.waitFor(() => expect(client.listPaymentProviders).toHaveBeenCalled());
  const add = () =>
    root
      .querySelector("[data-test=add-reader]")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("button");
  expect(add()?.disabled).toBe(true);
  expect(root.querySelector("[data-test=configure-providers]")).toBeNull();
  reject({ code: "server.internal" });
  await vi.waitFor(() => expect(root.querySelector("[role=alert]")).not.toBeNull());
  expect(add()?.disabled).toBe(true);
  expect(root.querySelector("[data-test=configure-providers]")).toBeNull();
  expect(client.availableReaders).not.toHaveBeenCalled();
});

it.each([
  { state: "connected", note: false },
  { state: "not_connected", note: true },
] as const)(
  "places other card machines after the settings and tells them SumUp is $state",
  async ({ state, note }) => {
    const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
      api: api([reader], {
        listPaymentProviders: vi
          .fn()
          .mockResolvedValue([{ providerId: "sumup", state, canUnpair: false }]),
        getOtherCardMachines: vi.fn().mockResolvedValue({
          otherCardMachines: [{ id: "m1", name: "Terrace", paysInto: "connected_account" }],
          revision: 0,
        }),
      }),
      panels: [],
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("dashboard-payments-settings")).not.toBeNull(),
    );
    const machines = el.shadowRoot!.querySelector("dashboard-other-card-machines")!;
    expect(el.shadowRoot!.querySelector("dashboard-payments-settings")!.nextElementSibling).toBe(
      machines,
    );
    await vi.waitFor(() => expect(machines.sumUpConnected).toBe(!note));
    await vi.waitFor(() => expect(machines.shadowRoot!.querySelector("wt-input")).not.toBeNull());
    await vi.waitFor(() =>
      expect(machines.shadowRoot!.textContent!.includes("SumUp is not connected")).toBe(note),
    );
  },
);

it("says nothing about SumUp's connection while the provider read is pending or failed", async () => {
  let reject!: (reason: unknown) => void;
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: api([reader], {
      listPaymentProviders: vi.fn(
        () =>
          new Promise<PaymentProviderRow[]>((_resolve, no) => {
            reject = no;
          }),
      ),
      getOtherCardMachines: vi.fn().mockResolvedValue({
        otherCardMachines: [{ id: "m1", name: "Terrace", paysInto: "connected_account" }],
        revision: 0,
      }),
    }),
    panels: [],
  });
  const root = el.shadowRoot!;
  await vi.waitFor(() =>
    expect(
      root.querySelector("dashboard-other-card-machines")?.shadowRoot?.querySelector("wt-input"),
    ).not.toBeNull(),
  );
  const machines = root.querySelector("dashboard-other-card-machines")!;
  await machines.updateComplete;
  expect(machines.shadowRoot!.textContent).not.toContain("SumUp is not connected");
  reject({ code: "server.internal" });
  await vi.waitFor(() => expect(root.querySelector("[role=alert]")).not.toBeNull());
  await machines.updateComplete;
  expect(machines.shadowRoot!.textContent).not.toContain("SumUp is not connected");
});

it("drops the SumUp note when a later provider read fails", async () => {
  const liveData = new LiveData();
  const listPaymentProviders = vi
    .fn()
    .mockResolvedValueOnce([{ providerId: "sumup", state: "not_connected", canUnpair: false }])
    .mockRejectedValue({ code: "server.internal" });
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: api([reader], {
      liveData,
      listPaymentProviders,
      getOtherCardMachines: vi.fn().mockResolvedValue({
        otherCardMachines: [{ id: "m1", name: "Terrace", paysInto: "connected_account" }],
        revision: 0,
      }),
    } as Partial<DashboardApi>),
    panels: [],
  });
  const root = el.shadowRoot!;
  const note = () =>
    root.querySelector("dashboard-other-card-machines")?.shadowRoot?.textContent ?? "";
  await vi.waitFor(() => expect(note()).toContain("SumUp is not connected"));
  liveData.refresh();
  await vi.waitFor(() => expect(listPaymentProviders).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(root.querySelector("[role=alert]")).not.toBeNull());
  await vi.waitFor(() => expect(note()).not.toContain("SumUp is not connected"));
});

it("leaves a section's gap above the settings and above other card machines", async () => {
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api: api([reader], {
      getOtherCardMachines: vi.fn().mockResolvedValue({ otherCardMachines: [], revision: 0 }),
    }),
    panels: [],
  });
  const root = el.shadowRoot!;
  await vi.waitFor(() =>
    expect(root.querySelector("dashboard-other-card-machines")).not.toBeNull(),
  );
  const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
  const readers = box("[data-test=readers-section]");
  const settings = box("dashboard-payments-settings");
  const machines = box("dashboard-other-card-machines");
  const sectionGap = Number.parseFloat(
    getComputedStyle(el).getPropertyValue("--wt-space-5").trim() || "NaN",
  );
  expect(sectionGap).toBeGreaterThan(0);
  expect(settings.top - readers.bottom).toBe(sectionGap);
  expect(machines.top - settings.bottom).toBe(sectionGap);
});
