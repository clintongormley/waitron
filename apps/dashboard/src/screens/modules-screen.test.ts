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
  expect(rows(el)).toHaveLength(5);
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  expect(table.shadowRoot!.querySelector("[data-test=configure-workforce]")).toBeNull();
  expect(table.shadowRoot!.querySelectorAll("wt-row-actions")).toHaveLength(2);
  expect(rows(el).join()).toContain("Workforce");
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
