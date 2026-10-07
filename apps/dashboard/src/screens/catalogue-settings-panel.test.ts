import { afterEach, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import type { WtCombobox } from "@waitron/ui";
import type { CatalogueSettings, DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "../dashboard-app.js";

type Panel = LitElement & { api: DashboardApi };
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});
function field(panel: Panel): WtCombobox {
  return panel.shadowRoot!.querySelector<WtCombobox>('[name="defaultProductVatClass"]')!;
}
function click(panel: Panel, action: string) {
  panel.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
}
async function change(panel: Panel, value: string) {
  field(panel).dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value },
      bubbles: true,
      composed: true,
    }),
  );
  await panel.updateComplete;
}
function fixture(overrides: Partial<DashboardApi> = {}) {
  let stored: CatalogueSettings = { defaultProductVatClass: "reduced" };
  const api = {
    liveData: new LiveData(),
    getCatalogueSettings: vi.fn(async () => ({ ...stored })),
    saveCatalogueSettings: vi.fn(async (value: CatalogueSettings) => {
      stored = { ...value };
      return { ...stored };
    }),
    ...overrides,
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}
async function mount(api = fixture()) {
  const { el } = await mountWidget<Panel>("dashboard-catalogue-settings-panel", { api });
  await expect
    .poll(() => el.shadowRoot?.querySelector('[name="defaultProductVatClass"]'), { timeout: 1000 })
    .toBeTruthy();
  return el;
}

it.each([
  [
    "en-GB",
    "VAT class for new products",
    "Only products created afterwards use this default. Existing products keep their class.",
  ],
  [
    "es-ES",
    "Clase de IVA para productos nuevos",
    "Solo los productos creados después usan este valor. Los productos existentes conservan su clase.",
  ],
])("loads the default with its explanation in %s", async (locale, label, hint) => {
  setLocale(locale);
  const panel = await mount();
  expect(field(panel).value).toBe("reduced");
  expect(field(panel).label).toBe(label);
  expect(field(panel).hint).toBe(hint);
  expect(field(panel).required).toBe(true);
  expect(field(panel).options.map(({ label }) => label)).toEqual(
    locale === "en-GB"
      ? ["General (21%)", "Reduced (10%)", "Super-reduced (4%)", "No tax (0%)"]
      : ["General (21%)", "Reducido (10%)", "Superreducido (4%)", "Sin impuestos (0%)"],
  );
  expect(field(panel).options.map(({ value }) => value)).toEqual([
    "general",
    "reduced",
    "super_reduced",
    "zero",
  ]);
});

it("saves a changed class, then reloads it in a new panel", async () => {
  const api = fixture();
  const panel = await mount(api);
  await change(panel, "super_reduced");
  click(panel, "save");
  await expect
    .poll(() => vi.mocked(api.saveCatalogueSettings).mock.calls)
    .toEqual([[{ defaultProductVatClass: "super_reduced" }]]);
  await expect
    .poll(() => panel.shadowRoot?.querySelector('[role="status"]')?.textContent?.trim())
    .toBe(t("catalogue_settings.saved"));
  panel.remove();
  expect(field(await mount(api)).value).toBe("super_reduced");
});

it("validates beside the field and enables Save after the value is corrected", async () => {
  const panel = await mount();
  await change(panel, "");
  expect(field(panel).error).toBe("");
  click(panel, "save");
  await panel.updateComplete;
  expect(field(panel).error).toBe(t("catalogue_settings.invalid"));
  expect(
    panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(true);
  expect(
    panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>("wt-form-actions")!
      .error,
  ).toBe(t("form.fix_fields"));
  await change(panel, "general");
  expect(field(panel).error).toBe("");
  expect(
    panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(false);
});

it("keeps a failed save editable and its field refusal through a successful live read", async () => {
  const api = fixture({
    saveCatalogueSettings: vi
      .fn()
      .mockRejectedValue({ code: "product.invalid", params: { field: "defaultProductVatClass" } }),
  });
  const panel = await mount(api);
  await change(panel, "zero");
  click(panel, "save");
  await expect.poll(() => field(panel).error).not.toBe("");
  api.liveData.refresh();
  await expect.poll(() => vi.mocked(api.getCatalogueSettings).mock.calls.length).toBe(2);
  expect(field(panel).value).toBe("zero");
  expect(field(panel).error).not.toBe("");
  expect(
    panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!
      .disabled,
  ).toBe(false);
  await change(panel, "general");
  expect(field(panel).error).toBe("");
});

it("refreshes a pristine default but preserves a changed draft", async () => {
  const api = fixture();
  const panel = await mount(api);
  vi.mocked(api.getCatalogueSettings).mockResolvedValue({ defaultProductVatClass: "general" });
  api.liveData.refresh();
  await expect.poll(() => field(panel).value).toBe("general");
  await change(panel, "zero");
  vi.mocked(api.getCatalogueSettings).mockResolvedValue({
    defaultProductVatClass: "super_reduced",
  });
  api.liveData.refresh();
  await expect.poll(() => vi.mocked(api.getCatalogueSettings).mock.calls.length).toBe(3);
  expect(field(panel).value).toBe("zero");
  click(panel, "cancel");
  await panel.updateComplete;
  expect(field(panel).value).toBe("super_reduced");
});
