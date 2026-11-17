import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { modulesClient } from "./modules-screen.test-support.js";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, ReaderRow } from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import type { ModulesScreen } from "./modules-screen.js";
import "./modules-screen.js";

const reader: ReaderRow = {
  printsOwnSlipAutomatically: false,
  id: "r1",
  provider: "acme",
  name: "Counter",
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
};
function client(readers: ReaderRow[], overrides: Partial<DashboardApi> = {}) {
  return modulesClient({
    listModules: vi
      .fn()
      .mockResolvedValue([{ id: "acme", category: "card-provider", enabled: true }]),
    listPaymentProviders: vi
      .fn()
      .mockResolvedValue([{ providerId: "acme", state: "connected", canUnpair: true }]),
    listReaders: vi.fn().mockResolvedValue(readers),
    disconnectPaymentProvider: vi.fn().mockResolvedValue(undefined),
    liveData: new LiveData(),
    ...overrides,
  }) as DashboardApi & { liveData: LiveData };
}
async function mount(api = client([]), theme?: "light" | "dark") {
  const { el } = await mountWidget<ModulesScreen>(
    "dashboard-modules-screen",
    {
      api,
      panels: [],
    },
    theme,
  );
  await vi.waitFor(() =>
    expect(tableRoot(el)?.querySelector("[data-test=disconnect-acme]")).toBeTruthy(),
  );
  await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalled());
  await el.updateComplete;
  const actions = tableRoot(el)!.querySelector("wt-row-actions")!;
  actions.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  for (let last = -1, height = el.getBoundingClientRect().height; height !== last;) {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    last = height;
    height = el.getBoundingClientRect().height;
  }
  return el;
}
const tableRoot = (el: ModulesScreen) => el.shadowRoot!.querySelector("wt-data-table")?.shadowRoot;
const button = (el: ModulesScreen) =>
  tableRoot(el)!.querySelector<HTMLElement>("[data-test=disconnect-acme]")!;
async function press(el: ModulesScreen) {
  await vi.waitFor(() => expect(button(el).hasAttribute("disabled")).toBe(false));
  button(el).click();
  await el.updateComplete;
}
const notice = (el: ModulesScreen) =>
  tableRoot(el)
    ?.querySelector("[data-test=disconnect-notice-acme]")
    ?.shadowRoot?.querySelector("[role=alert] .message");
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/modules/view/card-providers/state/all");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Disconnect precheck and confirmation", () => {
  it.each(["en", "es-ES"])(
    "refuses an active reader locally beside its button without moving the page (%s)",
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
    await vi.waitFor(() => expect(button(el).hasAttribute("disabled")).toBe(false));
    await press(el);
    expect(button(el).textContent?.trim()).toBe("Disconnect this provider?");
    await press(el);
    await vi.waitFor(() => expect(api.disconnectPaymentProvider).toHaveBeenCalledTimes(2));
  });
});

it("keeps a refusal and an armed confirmation through background refreshes", async () => {
  const api = client([], {
    disconnectPaymentProvider: vi.fn().mockRejectedValue({ code: "payment.provider_in_use" }),
  });
  const el = await mount(api);
  await press(el);
  await press(el);
  await vi.waitFor(() => expect(notice(el)?.textContent).toContain("Delete or unpair"));
  expect(notice(el)?.textContent).not.toContain("payment.provider_in_use");
  const reads = vi.mocked(api.listPaymentProviders).mock.calls.length;
  api.liveData.refresh();
  await vi.waitFor(() => expect(api.listPaymentProviders).toHaveBeenCalledTimes(reads + 1));
  expect(notice(el)?.textContent).toBe(codeMessage("payment.provider_in_use"));
  await press(el);
  expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
  api.liveData.refresh();
  await vi.waitFor(() => expect(api.listPaymentProviders).toHaveBeenCalledTimes(reads + 2));
  expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
  expect(api.disconnectPaymentProvider).toHaveBeenCalledTimes(1);
});

it("disarms after a provider is disconnected by a background read", async () => {
  const api = client([]);
  const el = await mount(api);
  await press(el);
  vi.mocked(api.listPaymentProviders).mockResolvedValue([
    { providerId: "acme", state: "not_connected", canUnpair: true },
  ]);
  api.liveData.refresh();
  await vi.waitFor(() =>
    expect(tableRoot(el)?.querySelector("[data-test=disconnect-acme]")).toBeNull(),
  );
  vi.mocked(api.listPaymentProviders).mockResolvedValue([
    { providerId: "acme", state: "connected", canUnpair: true },
  ]);
  api.liveData.refresh();
  await vi.waitFor(() => expect(button(el)?.textContent).toBe(t("payments.disconnect")));
});

it.each([true, false])(
  "keeps an action failure when a failed readers read recovers (first read failed: %s)",
  async (firstFailed) => {
    const list = vi.fn();
    if (firstFailed) list.mockRejectedValueOnce({ code: "server.internal" });
    list.mockResolvedValue([]);
    const api = client([], {
      listReaders: list,
      disconnectPaymentProvider: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const el = await mount(api);
    if (firstFailed)
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("server.internal"),
      );
    await press(el);
    await press(el);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("connection.failed"),
      ),
    );
    expect(api.disconnectPaymentProvider).toHaveBeenCalledWith("acme");
    expect(
      el.shadowRoot!.querySelector("[role=alert]")?.querySelector("[data-test=retry-modules]"),
    ).toBeNull();
    if (!firstFailed) {
      list.mockRejectedValueOnce({ code: "server.internal" });
      api.liveData.refresh();
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        codeMessage("connection.failed"),
      );
    }
    const retry = el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-modules]");
    expect(retry).not.toBeNull();
    expect(retry!.closest("p")?.textContent).toContain(codeMessage("server.internal"));
    retry!.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=retry-modules]")).toBeNull(),
    );
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      codeMessage("connection.failed"),
    );
    const reads = list.mock.calls.length;
    api.liveData.refresh();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(reads + 1));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
      codeMessage("connection.failed"),
    );
  },
);

it.each(["light", "dark"] as const)(
  "keeps the real row menu open for confirmation and refusal (%s)",
  async (theme) => {
    const api = client([]);
    const el = await mount(api, theme);
    const menu = button(el).closest("wt-row-actions")!;
    await expectNoA11yViolations(menu);
    await userEvent.click(button(el));
    expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(menu);
    vi.mocked(api.listReaders).mockResolvedValue([reader]);
    api.liveData.refresh();
    await vi.waitFor(() => expect(api.listReaders).toHaveBeenCalledTimes(2));
    await el.updateComplete;
    await userEvent.click(button(el));
    await vi.waitFor(() =>
      expect(notice(el)?.textContent).toBe(codeMessage("payment.provider_in_use")),
    );
    expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(true);
    await expectNoA11yViolations(menu);
  },
);

it("cancels a pending confirmation when the menu is closed and reopened", async () => {
  const api = client([]);
  const el = await mount(api);
  const menu = button(el).closest("wt-row-actions")!;
  await userEvent.click(button(el));
  expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
  menu
    .shadowRoot!.querySelector("[popover]")!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
  await userEvent.keyboard("{Escape}");
  expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  expect(button(el).textContent).toBe(t("payments.disconnect"));
  await userEvent.click(button(el));
  expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
  expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
});

it("cancels a pending confirmation when Retry reloads a failed read", async () => {
  const api = client([]);
  const el = await mount(api);
  vi.mocked(api.listModules).mockRejectedValueOnce({ code: "connection.failed" });
  api.liveData.refresh();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=retry-modules]")).not.toBeNull(),
  );
  await press(el);
  expect(button(el).textContent).toBe(t("payments.disconnect_confirm"));
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-modules]")!.click();
  await vi.waitFor(() => expect(button(el).textContent).toBe(t("payments.disconnect")));
  expect(api.disconnectPaymentProvider).not.toHaveBeenCalled();
});
