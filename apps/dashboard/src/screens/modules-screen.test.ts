import { page, userEvent } from "vitest/browser";
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
it("offers a truthful no-settings window for a module and restores focus after closing", async () => {
  const el = await mount();
  const table = el.shadowRoot!.querySelector("wt-data-table")!;
  const configure = table.shadowRoot!.querySelector<HTMLElement>(
    "[data-test=configure-workforce]",
  )!;
  const menu = configure.closest("wt-row-actions")!;
  const opener = menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
  await userEvent.click(opener);
  await userEvent.click(configure);
  await el.updateComplete;
  const dialog = el.shadowRoot!.querySelector("wt-dialog")!;
  await dialog.updateComplete;
  expect(dialog.textContent).toContain("No settings for this module");
  expect(dialog.textContent).not.toContain("Save");
  expect(rows(el).join()).toContain("Switching this module is not available yet");
  dialog.querySelector<HTMLElement>("[data-test=close-module]")!.click();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("wt-dialog")).toBeNull());
  await vi.waitFor(() => expect(menu.shadowRoot!.activeElement).toBe(opener));
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

it("wraps the module refusal on a Spanish phone display", async () => {
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
