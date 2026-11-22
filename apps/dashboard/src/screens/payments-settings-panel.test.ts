import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi, PaymentSettingsView } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { PaymentsSettingsPanel } from "./payments-settings-panel.js";
import "./payments-screen.js";

const initial: PaymentSettingsView = {
  tipsEnabled: false,
  testProviders: true,
  testProvidersAvailable: false,
  revision: 3,
};

async function mount(
  testProvidersAvailable = false,
  savePaymentSettings = vi.fn(async (draft) => ({ ...draft, testProvidersAvailable, revision: 4 })),
) {
  setLocale("en");
  const { el } = await mountWidget<PaymentsSettingsPanel>("dashboard-payments-settings", {
    api: {
      getPaymentSettings: async () => ({ ...initial, testProvidersAvailable }),
      savePaymentSettings,
    } as unknown as DashboardApi,
  });
  await expect.element(page.getByRole("switch", { name: "Offer tips at the till" })).toBeVisible();
  return { el, savePaymentSettings };
}

afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

it("keeps Save quiet until the switches change and excludes the practice switch on Live", async () => {
  const { savePaymentSettings } = await mount();
  const tips = page.getByText("Offer tips at the till", { exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect
    .element(page.getByRole("switch", { name: "Use card providers' test accounts" }))
    .not.toBeInTheDocument();
  await expect.element(save).toBeDisabled();
  await tips.click();
  await expect.element(save).toBeEnabled();
  await tips.click();
  await expect.element(save).toBeDisabled();
  await tips.click();
  await save.click();
  expect(savePaymentSettings).toHaveBeenCalledExactlyOnceWith({
    tipsEnabled: true,
    testProviders: false,
    revision: 3,
  });
  await expect.element(save).toBeDisabled();
});

it("saves the revised Prepare choices after the manager confirms a stale edit", async () => {
  const savePaymentSettings = vi
    .fn()
    .mockRejectedValueOnce({ code: "settings.out_of_date", params: { revision: 4 } })
    .mockResolvedValue({
      tipsEnabled: true,
      testProviders: true,
      testProvidersAvailable: true,
      revision: 5,
    });
  await mount(true, savePaymentSettings);
  const providers = page.getByRole("switch", { name: "Use card providers' test accounts" });
  await expect.element(providers).toBeChecked();
  await page.getByRole("switch", { name: "Offer tips at the till" }).click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect.element(page.getByText(codeMessage("settings.out_of_date"))).toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Offer tips at the till" })).toBeChecked();
  await expect.element(save).toBeEnabled();
  await save.click();
  expect(savePaymentSettings.mock.calls).toEqual([
    [{ tipsEnabled: true, testProviders: true, revision: 3 }],
    [{ tipsEnabled: true, testProviders: true, revision: 4 }],
  ]);
  await expect.element(save).toBeDisabled();
});

it("explains a Prepare-only refusal beside Save and keeps the draft", async () => {
  const savePaymentSettings = vi
    .fn()
    .mockRejectedValue({ code: "payments.test_providers_prepare_only" });
  await mount(true, savePaymentSettings);
  const tips = page.getByRole("switch", { name: "Offer tips at the till" });
  await tips.click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect
    .element(page.getByText(codeMessage("payments.test_providers_prepare_only")))
    .toBeVisible();
  await expect.element(tips).toBeChecked();
  await expect.element(save).toBeEnabled();
});
