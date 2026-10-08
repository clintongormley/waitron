import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData } from "@waitron/dashboard-kit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { CatalogueSettings, DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { t } from "../i18n/t.js";
import type { CatalogueSettingsPanel } from "./catalogue-settings-panel.js";
import "./catalogue-settings-panel.js";

afterEach(cleanupWidgets);

function stubApi(overrides: Partial<DashboardApi> = {}) {
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

async function mount(api = stubApi()) {
  const { el } = await mountWidget<CatalogueSettingsPanel>("dashboard-catalogue-settings-panel", {
    api,
  });
  await expect.poll(() => el.shadowRoot?.querySelector("[data-test=save]")).toBeTruthy();
  return el;
}
function field(el: CatalogueSettingsPanel) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    'wt-combobox[name="defaultProductVatClass"]',
  )!;
}
function saveButton(el: CatalogueSettingsPanel) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
}
/** What Save looks like and whether a person can press it: the host's state and its inner button's. */
async function saveState(el: CatalogueSettingsPanel) {
  await el.updateComplete;
  const save = saveButton(el);
  await save.updateComplete;
  return {
    variant: save.variant,
    disabled: save.disabled,
    innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
  };
}
const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
const ready = { variant: "primary", disabled: false, innerDisabled: false };
const blocked = { variant: "primary", disabled: true, innerDisabled: true };
/** A real pointer press on the inner button; `force` presses a disabled one too. */
async function press(el: CatalogueSettingsPanel) {
  const inner = saveButton(el).shadowRoot!.querySelector("button")!;
  await userEvent.click(page.elementLocator(inner), { force: true });
  await el.updateComplete;
}
async function choose(el: CatalogueSettingsPanel, value: string) {
  await chooseOption(field(el), value);
  await el.updateComplete;
}

it("opens on the stored class with Save quiet and disabled, and an untouched press sends nothing", async () => {
  const api = stubApi();
  const el = await mount(api);
  expect(field(el).value).toBe("reduced");
  expect(await saveState(el)).toEqual(quiet);
  await press(el);
  expect(api.saveCatalogueSettings).not.toHaveBeenCalled();
  expect(field(el).error).toBe("");
});

it("choosing another class makes Save primary and enabled, and choosing the stored one back makes it quiet", async () => {
  const el = await mount();
  await choose(el, "general");
  expect(await saveState(el)).toEqual(ready);
  await choose(el, "reduced");
  expect(await saveState(el)).toEqual(quiet);
});

// A host `.click()` reaches Save's listener even while its inner button is disabled, so this
// presses the host: what it proves is that the handler itself sends nothing for an unchanged form.
it("a press that reaches Save's handler on an untouched panel sends nothing and marks no field", async () => {
  const api = stubApi();
  const el = await mount(api);
  saveButton(el).click();
  await el.updateComplete;
  expect(api.saveCatalogueSettings).not.toHaveBeenCalled();
  expect(field(el).error).toBe("");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
});

it("after a save the panel stays open with the saved class and Save quiet again", async () => {
  const api = stubApi();
  const el = await mount(api);
  await choose(el, "super_reduced");
  await press(el);
  await expect
    .poll(() => el.shadowRoot!.querySelector('[role="status"]')?.textContent?.trim())
    .toBe(t("catalogue_settings.saved"));
  expect(api.saveCatalogueSettings).toHaveBeenCalledExactlyOnceWith({
    defaultProductVatClass: "super_reduced",
  });
  expect(field(el).value).toBe("super_reduced");
  expect(await saveState(el)).toEqual(quiet);
});

it("a changed default the panel refuses shows its error after a press and holds Save until fixed", async () => {
  const api = stubApi();
  const el = await mount(api);
  await choose(el, "");
  expect(await saveState(el)).toEqual(ready);
  await press(el);
  expect(api.saveCatalogueSettings).not.toHaveBeenCalled();
  expect(field(el).error).toBe(t("catalogue_settings.invalid"));
  expect(await saveState(el)).toEqual(blocked);
  await choose(el, "general");
  expect(await saveState(el)).toEqual(ready);
});

it("a refused save leaves the changed class and Save enabled", async () => {
  const api = stubApi({
    saveCatalogueSettings: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const el = await mount(api);
  await choose(el, "zero");
  await press(el);
  await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
  expect(field(el).value).toBe("zero");
  expect(await saveState(el)).toEqual(ready);
});

it("a live read that moves an untouched default leaves Save quiet", async () => {
  const api = stubApi();
  const el = await mount(api);
  vi.mocked(api.getCatalogueSettings).mockResolvedValue({ defaultProductVatClass: "general" });
  api.liveData.refresh();
  await expect.poll(() => field(el).value).toBe("general");
  expect(await saveState(el)).toEqual(quiet);
});
