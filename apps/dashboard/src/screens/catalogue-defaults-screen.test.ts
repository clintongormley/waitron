import { afterEach, expect, it, vi } from "vitest";
import { LitElement } from "lit";
import { LiveData } from "@waitron/dashboard-kit";
import type { WtCombobox } from "@waitron/ui";
import type { CatalogueSettings, DashboardApi } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "../dashboard-app.js";

type Screen = LitElement & { api: DashboardApi };
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

function fixture() {
  let stored: CatalogueSettings = { defaultProductVatClass: "reduced", defaultColor: null };
  const api = {
    liveData: new LiveData(),
    getCatalogueSettings: vi.fn(async () => ({ ...stored })),
    saveCatalogueSettings: vi.fn(
      async (value: Pick<CatalogueSettings, "defaultProductVatClass">) => {
        stored = { ...stored, ...value };
        return { ...stored };
      },
    ),
  } as unknown as DashboardApi;
  Object.defineProperty(api, "background", { get: () => api });
  return api;
}

const panelOf = (screen: Screen) =>
  screen.shadowRoot!.querySelector<LitElement>("dashboard-catalogue-settings-panel")!;
const fieldOf = (screen: Screen) =>
  panelOf(screen)?.shadowRoot?.querySelector<WtCombobox>('[name="defaultProductVatClass"]');

async function mount(api = fixture()) {
  const { el } = await mountWidget<Screen>("dashboard-catalogue-defaults-screen", { api });
  await expect.poll(() => fieldOf(el), { timeout: 1000 }).toBeTruthy();
  return el;
}

it.each([
  ["en-GB", "Defaults", "VAT class for new products"],
  ["es-ES", "Valores predeterminados", "Clase de IVA para productos nuevos"],
])("heads the page and the VAT class in %s", async (locale, title, heading) => {
  setLocale(locale);
  const screen = await mount();
  expect(screen.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe(title);
  expect(panelOf(screen).shadowRoot!.querySelector("h2")!.textContent!.trim()).toBe(heading);
});

it("loads the stored VAT class and saves a changed one", async () => {
  const api = fixture();
  const screen = await mount(api);
  const field = fieldOf(screen)!;
  expect(field.value).toBe("reduced");
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "zero" }, bubbles: true, composed: true }),
  );
  await panelOf(screen).updateComplete;
  panelOf(screen).shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  await expect
    .poll(() => api.saveCatalogueSettings)
    .toHaveBeenCalledWith({
      defaultProductVatClass: "zero",
    });
  await expect.poll(() => fieldOf(screen)!.value).toBe("zero");
});
