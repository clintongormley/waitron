import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi, PaymentProviderRow, ReaderRow } from "../api/client.js";
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
    availableReaders: vi.fn().mockResolvedValue([]),
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
  history.replaceState(null, "", "/payments");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Card payments reader tools", () => {
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
      expect(
        [...el.shadowRoot!.querySelectorAll("h2")].map((heading) => heading.textContent),
      ).toEqual(["Card readers"]);
      expect(el.shadowRoot!.querySelector("[data-test=refresh-readers]")).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector("[data-test=configure-providers]")?.getAttribute("href"),
      ).toBe("/modules/view/card-providers/state/all");
      expect(el.shadowRoot!.querySelector("[data-test=add-reader]")).toBeNull();
    },
  );
});

const readerReads = [
  "listPaymentProviders",
  "listReaders",
  "listReaderHolders",
  "readerStatus",
] as const;
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
    "/modules/view/card-providers/state/all",
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
