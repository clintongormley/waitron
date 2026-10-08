import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, ReaderRow } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type { PaymentsScreen } from "./payments-screen.js";
import "./payments-screen.js";

const reader: ReaderRow = {
  id: "r1",
  provider: "acme",
  name: "Counter",
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
};
function client(readers: ReaderRow[], overrides: Partial<DashboardApi> = {}) {
  return Object.assign({
    listPaymentProviders: vi
      .fn()
      .mockResolvedValue([{ providerId: "acme", state: "connected", canUnpair: true }]),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    readerStatus: vi.fn().mockResolvedValue({ online: false }),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    disconnectPaymentProvider: vi.fn().mockResolvedValue(undefined),
    liveData: new LiveData(),
    ...overrides,
  }) as unknown as DashboardApi & { liveData: LiveData };
}
async function mount(api = client([])) {
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api,
    panels: [],
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=disconnect-acme]")).not.toBeNull(),
  );
  await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalled());
  await el.updateComplete;
  return el;
}
const button = (el: PaymentsScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=disconnect-acme]")!;
async function press(el: PaymentsScreen) {
  button(el).click();
  await el.updateComplete;
}
const notice = (el: PaymentsScreen) =>
  el
    .shadowRoot!.querySelector("[data-test=disconnect-notice-acme]")
    ?.shadowRoot?.querySelector("[role=alert]");
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/payments/view/providers");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Disconnect precheck and confirmation", () => {
  // Removing the provider/active filter, local refusal, or second-tap gate breaks these cases.
  it.each(["en", "es-ES"])(
    "refuses an offline active reader locally beside its button without moving the page (%s)",
    async (locale) => {
      setLocale(locale);
      const api = client([reader]);
      const el = await mount(api);
      const before = el.getBoundingClientRect().height;
      const position = button(el).getBoundingClientRect().top;
      await press(el);
      await vi.waitFor(() =>
        expect(notice(el)?.textContent).toContain(codeMessage("payment.provider_in_use")),
      );
      expect(button(el).textContent?.trim()).toBe(locale === "en" ? "Disconnect" : "Desconectar");
      expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      expect(el.getBoundingClientRect().height).toBe(before);
      expect(button(el).getBoundingClientRect().top).toBe(position);
      await press(el);
      expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
    },
  );
  it.each([
    { readers: [] },
    { readers: [{ ...reader, active: false }] },
    { readers: [{ ...reader, provider: "other" }] },
  ])("confirms when this provider has no active readers ($readers)", async ({ readers }) => {
    const api = client(readers);
    const el = await mount(api);
    await press(el);
    expect(button(el).textContent?.trim()).toBe("Disconnect this provider?");
    expect(button(el).getAttribute("variant")).toBe("danger");
    expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
    await press(el);
    await vi.waitFor(() =>
      expect(api.disconnectPaymentProvider).toHaveBeenCalledExactlyOnceWith("acme"),
    );
  });
  it("rechecks readers arriving between the first and confirming taps", async () => {
    const api = client([]);
    const el = await mount(api);
    await press(el);
    vi.mocked(api.listReaders).mockResolvedValue([reader]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    await press(el);
    await vi.waitFor(() =>
      expect(notice(el)?.textContent).toContain(codeMessage("payment.provider_in_use")),
    );
    expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
    expect(button(el).textContent?.trim()).toBe("Disconnect");
  });
  it("shows a server race refusal beside the button and lets a later attempt confirm", async () => {
    const api = client([], {
      disconnectPaymentProvider: vi
        .fn()
        .mockRejectedValueOnce({ code: "payment.provider_in_use" })
        .mockResolvedValue(undefined),
    });
    const el = await mount(api);
    await press(el);
    await press(el);
    await vi.waitFor(() =>
      expect(notice(el)?.textContent).toContain(codeMessage("payment.provider_in_use")),
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    await press(el);
    expect(button(el).textContent?.trim()).toBe("Disconnect this provider?");
    await press(el);
    await vi.waitFor(() => expect(api.disconnectPaymentProvider).toHaveBeenCalledTimes(2));
  });
});
