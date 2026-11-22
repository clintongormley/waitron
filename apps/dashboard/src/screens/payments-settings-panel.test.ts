import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { DashboardApi, PaymentSettingsView } from "../api/client.js";
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
  getPaymentSettings = async () => ({ ...initial, testProvidersAvailable }),
) {
  setLocale("en");
  const { el } = await mountWidget<PaymentsSettingsPanel>("dashboard-payments-settings", {
    api: {
      getPaymentSettings,
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

it.each([
  {
    label: "Offer tips at the till",
    current: { tipsEnabled: false, testProviders: false },
    submitted: { tipsEnabled: true, testProviders: true },
  },
  {
    label: "Use card providers' test accounts",
    current: { tipsEnabled: true, testProviders: true },
    submitted: { tipsEnabled: false, testProviders: false },
  },
])("refreshes the untouched switch ($label)", async ({ label, current, submitted }) => {
  const prepare = { ...initial, testProvidersAvailable: true };
  const getPaymentSettings = vi
    .fn()
    .mockResolvedValueOnce(prepare)
    .mockResolvedValue({ ...prepare, ...current, revision: 4 });
  const savePaymentSettings = vi
    .fn()
    .mockRejectedValueOnce({ code: "settings.out_of_date", params: { revision: 4 } })
    .mockImplementation(async (draft) => ({
      ...draft,
      testProvidersAvailable: true,
      revision: 5,
    }));
  await mount(true, savePaymentSettings, getPaymentSettings);
  const providers = page.getByRole("switch", { name: "Use card providers' test accounts" });
  const tips = page.getByRole("switch", { name: "Offer tips at the till" });
  await page.getByText(label, { exact: true }).click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await vi.waitFor(() => expect(getPaymentSettings).toHaveBeenCalledTimes(2), { timeout: 1000 });
  await expect.element(providers).not.toBeChecked();
  await expect.element(tips).toBeChecked();
  await expect
    .element(
      page.getByText(
        "Payment settings changed while you were editing. Review the current switches.",
      ),
    )
    .toBeVisible();
  await expect.element(save).toBeEnabled();
  expect(savePaymentSettings).toHaveBeenCalledTimes(1);
  await save.click();
  expect(savePaymentSettings.mock.calls).toEqual([
    [{ ...submitted, revision: 3 }],
    [{ tipsEnabled: true, testProviders: false, revision: 4 }],
  ]);
  await expect.element(save).toBeDisabled();
});

it("explains a Prepare-only refusal beside Save and keeps the draft", async () => {
  const savePaymentSettings = vi
    .fn()
    .mockRejectedValue({ code: "payment.test_providers_prepare_only" });
  await mount(true, savePaymentSettings);
  const tips = page.getByRole("switch", { name: "Offer tips at the till" });
  await tips.click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect
    .element(
      page.getByText(
        "You can use test accounts on a Prepare box only. Your changes were not saved.",
      ),
    )
    .toBeVisible();
  await expect.element(tips).toBeChecked();
  await expect.element(save).toBeEnabled();
});
