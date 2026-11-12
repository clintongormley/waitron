import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { modulesClient } from "./modules-screen.test-support.js";
import type { ModulesScreen } from "./modules-screen.js";
import "./modules-screen.js";
registerIcons(DASHBOARD_ICONS);
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/modules");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
async function mount(api = modulesClient()) {
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", { api });
  await vi.waitFor(() => expect(rows(el).length).toBeGreaterThan(0));
  return el;
}
function rows(el: ModulesScreen) {
  return [
    ...(el
      .shadowRoot!.querySelector("wt-data-table")
      ?.shadowRoot?.querySelectorAll("tbody tr[data-row-key]") ?? []),
  ].map((row) => row.textContent);
}
function change(el: ModulesScreen, name: string, value: string) {
  el.shadowRoot!.querySelector(`[name=${name}]`)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
it("opens Enabled, and Add discovers Disabled without changing the independent category", async () => {
  const el = await mount();
  expect(rows(el)).toHaveLength(3);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  expect(table.shadowRoot!.querySelector("[data-test=configure-payments]")).toBeNull();
  expect(table.shadowRoot!.querySelectorAll("wt-row-actions")).toHaveLength(2);
  expect(rows(el).join()).toContain("Card payments");
  expect(rows(el).join()).not.toContain("Bookings");
  change(el, "category", "card-providers");
  await el.updateComplete;
  expect(rows(el)).toHaveLength(2);
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=add-module]")!.click();
  await el.updateComplete;
  expect(rows(el)).toEqual([]);
  expect(location.pathname).toBe("/manage/modules/view/card-providers/state/disabled");
  change(el, "category", "all");
  await el.updateComplete;
  expect(rows(el).join()).toContain("Bookings");
  expect(rows(el).join()).toContain("Spanish workforce rules");
});
it("honours the direct all-provider link and separates Enabled from Needs setup", async () => {
  history.replaceState(null, "", "/manage/modules/view/card-providers/state/all");
  const el = await mount();
  const text = rows(el).join();
  expect(rows(el)).toHaveLength(2);
  expect(text).toContain("SumUp");
  expect(text).toContain("Stripe");
  expect(text).toContain("Configured");
  expect(text).toContain("Needs setup");
  expect(text).not.toContain("Disabled");
});
it("shows a failed catalogue read and retries without substituting an empty list", async () => {
  const api = modulesClient({
    listModules: vi
      .fn()
      .mockRejectedValueOnce({ code: "server.internal" })
      .mockResolvedValue([{ id: "payments", category: "module", enabled: true }]),
  });
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", { api });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-modules]")!.click();
  await vi.waitFor(() => expect(rows(el)).toHaveLength(1));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("wraps the module preparation note on a Spanish phone display", async () => {
  await page.viewport(390, 900);
  try {
    setLocale("es-ES");
    const el = await mount();
    const reason = el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("[part=switch-reason]")!;
    const range = document.createRange();
    range.selectNodeContents(reason);
    expect(range.getClientRects().length).toBeGreaterThan(1);
  } finally {
    await page.viewport(1280, 900);
  }
});

it("ends the loading indication when provider configuration cannot be read, and recovers on Retry", async () => {
  const api = modulesClient({
    listPaymentProviders: vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue([
        { providerId: "sumup", state: "connected", canUnpair: true },
        { providerId: "stripe", state: "not_connected", canUnpair: false },
      ]),
  });
  const { el } = await mountWidget<ModulesScreen>("dashboard-modules-screen", { api });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("[role=alert]")).not.toBeNull());
  await vi.waitFor(() => expect(rows(el).join()).toContain("Configuration unavailable"));
  expect(rows(el).join()).not.toContain("Loading");
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=retry-modules]")!.click();
  await vi.waitFor(() => expect(rows(el).join()).toContain("Needs setup"));
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

it("confirms provider Off separately from configuration and keeps attached-reader refusals visible", async () => {
  const api = modulesClient({
    setPaymentProviderState: vi.fn().mockRejectedValue({
      code: "payment.provider_in_use",
      params: { readerNames: ["Front reader"] },
    }),
  });
  const el = await mount(api);
  el.canManageProviders = true;
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const off = table.shadowRoot!.querySelector<HTMLElement>("[data-test=switch-sumup]");
  expect(off).not.toBeNull();
  off!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("sumup-connect-form")).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=provider-state-error]")?.textContent).toContain(
      "Front reader",
    ),
  );
  const link = el.shadowRoot!.querySelector<HTMLAnchorElement>("[data-test=remove-readers]")!;
  expect(link.getAttribute("href")).toBe("/manage/payments");
  expect(api.setPaymentProviderState).toHaveBeenCalledWith("sumup", false, 0);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=provider-state-error]")?.textContent).toContain(
    "Front reader",
  );
});
it("a manager can configure but cannot switch a provider", async () => {
  const el = await mount();
  const root = el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
  expect(root.querySelector("[data-test=configure-sumup]")).not.toBeNull();
  expect(root.querySelector("[data-test=switch-sumup]")).toBeNull();
});

it.each([true, false])(
  "switches a provider from enabled=%s and refreshes its state without changing configuration",
  async (enabled) => {
    history.replaceState(null, "", "/manage/modules/view/card-providers/state/all");
    const api = modulesClient({
      listModules: vi
        .fn()
        .mockResolvedValueOnce([{ id: "sumup", category: "card-provider", enabled, revision: 4 }])
        .mockResolvedValue([
          { id: "sumup", category: "card-provider", enabled: !enabled, revision: 5 },
        ]),
      setPaymentProviderState: vi.fn().mockResolvedValue({ enabled: !enabled, revision: 5 }),
    });
    const el = await mount(api);
    el.canManageProviders = true;
    await el.updateComplete;
    el.shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=switch-sumup]")!
      .click();
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
    await vi.waitFor(() => expect(rows(el).join()).toContain(enabled ? "Disabled" : "Enabled"));
    expect(api.setPaymentProviderState).toHaveBeenCalledWith("sumup", !enabled, 4);
    expect(rows(el).join()).toContain("Configured");
    expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull();
  },
);

it("offers no provider switch while the Payments module is disabled", async () => {
  history.replaceState(null, "", "/manage/modules/view/card-providers/state/all");
  const el = await mount(
    modulesClient({
      listModules: vi.fn().mockResolvedValue([
        { id: "payments", category: "module", enabled: false },
        { id: "sumup", category: "card-provider", enabled: false, revision: 0 },
      ]),
    }),
  );
  el.canManageProviders = true;
  await el.updateComplete;
  expect(
    el
      .shadowRoot!.querySelector("wt-data-table")!
      .shadowRoot!.querySelector("[data-test=switch-sumup]"),
  ).toBeNull();
});

it("refreshes a stale provider revision so the open confirmation can be retried", async () => {
  const api = modulesClient({
    listModules: vi
      .fn()
      .mockResolvedValueOnce([
        { id: "sumup", category: "card-provider", enabled: true, revision: 0 },
      ])
      .mockResolvedValue([{ id: "sumup", category: "card-provider", enabled: true, revision: 1 }]),
    setPaymentProviderState: vi
      .fn()
      .mockRejectedValueOnce({ code: "settings.out_of_date" })
      .mockResolvedValue({ enabled: false, revision: 2 }),
  });
  const el = await mount(api);
  el.canManageProviders = true;
  await el.updateComplete;
  el.shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>("[data-test=switch-sumup]")!
    .click();
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() => expect(api.listModules).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("[data-test=confirm-provider-state]")!
        .shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled,
    ).toBe(false),
  );
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-provider-state]")!.click();
  await vi.waitFor(() =>
    expect(api.setPaymentProviderState).toHaveBeenLastCalledWith("sumup", false, 1),
  );
});
