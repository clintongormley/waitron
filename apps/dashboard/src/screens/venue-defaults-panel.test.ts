import { LiveData } from "@waitron/dashboard-kit";
import type { ContentLanguages } from "@waitron/shared";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./venue-defaults-panel.js";

type Panel = HTMLElementTagNameMap["dashboard-venue-defaults-panel"];
const MADRID: VenueDefaults = {
  receiptLanguage: "es-ES",
  receiptLanguageChoices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
  fixedReceiptLanguage: null,
  defaultProductVatClass: "reduced",
};
const BARCELONA: VenueDefaults = {
  receiptLanguage: "es-ES",
  receiptLanguageChoices: ["ca-ES"],
  fixedReceiptLanguage: "ca-ES",
  defaultProductVatClass: "reduced",
};
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const q = (el: Panel, selector: string) => el.shadowRoot!.querySelector(selector);
const rows = (el: Panel) =>
  [...el.shadowRoot!.querySelectorAll("section.settings-card dt")].map(
    (label) => `${text(label)}: ${text(label.nextElementSibling)}`,
  );
const flush = async (el: Panel) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
};

function rig(
  stored: VenueDefaults = MADRID,
  content: ContentLanguages = { defaultLanguage: "es", languages: ["es", "ca"] },
) {
  const liveData = new LiveData();
  const state = { stored: structuredClone(stored), content: structuredClone(content) };
  const api = {
    liveData,
    getVenueDefaults: vi.fn(async () => structuredClone(state.stored)),
    getContentLanguages: vi.fn(async () => structuredClone(state.content)),
  };
  return { api: api as typeof api & DashboardApi, liveData, state };
}
async function mount(api: DashboardApi) {
  const { el } = await mountWidget<Panel>("dashboard-venue-defaults-panel", { api });
  await expect.poll(() => q(el, "section.settings-card dl")).toBeTruthy();
  await flush(el);
  return el;
}
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  setLocale("es-ES");
});

it.each([
  [
    "en-GB",
    "Defaults",
    "Edit",
    ["Default receipt language: Spanish", "VAT class for new products: Reduced (10%)"],
  ],
  [
    "es",
    "Valores predeterminados",
    "Editar",
    [
      "Idioma predeterminado del recibo: Español",
      "Clase de IVA para productos nuevos: Reducido (10%)",
    ],
  ],
])(
  "shows the two defaults in a card headed by an h2 (%s)",
  async (locale, heading, edit, expected) => {
    setLocale(locale);
    const el = await mount(rig().api);
    const card = q(el, "section.settings-card")!;
    expect(text(card.querySelector("header > h2"))).toBe(heading);
    expect(card.getAttribute("aria-labelledby")).toBe(card.querySelector("h2")!.id);
    expect(text(q(el, "[data-test=edit]"))).toBe(edit);
    expect(q(el, "[data-test=edit]")!.closest("header")?.parentElement).toBe(card);
    expect(rows(el)).toEqual(expected);
    expect(text(q(el, "[data-test=saved-receiptLanguage]"))).toBe(expected[0]!.split(": ")[1]);
    expect(text(q(el, "[data-test=saved-defaultProductVatClass]"))).toBe(
      expected[1]!.split(": ")[1],
    );
  },
);

it.each(["en-GB", "es"])("shows no legal paragraph for a Catalan venue (%s)", async (locale) => {
  setLocale(locale);
  const el = await mount(rig({ ...BARCELONA, receiptLanguage: "ca-ES" }).api);
  const all = el.shadowRoot!.textContent ?? "";
  expect(all).not.toContain("22/2010");
  expect(all).not.toContain("128-1.2.a");
  expect(q(el, ".reason")).toBeNull();
});

it("warns when the receipt language is not a content language, following a live change", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await mount(r.api);
  expect(q(el, "[data-test=receipt-language-warning]")).toBeNull();
  r.state.content = { defaultLanguage: "ca", languages: ["ca"] };
  r.liveData.invalidate([{ type: "content_languages" }]);
  await expect.poll(() => text(q(el, "[data-test=receipt-language-warning]"))).toContain("Spanish");
  expect(q(el, "[data-test=receipt-language-warning]")!.closest("section.settings-card")).toBe(
    q(el, "section.settings-card"),
  );
  r.state.content = { defaultLanguage: "es", languages: ["es"] };
  r.liveData.invalidate([{ type: "content_languages" }]);
  await expect.poll(() => q(el, "[data-test=receipt-language-warning]")).toBeNull();
});

it("follows a live change to the stored defaults", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await mount(r.api);
  r.state.stored = { ...r.state.stored, defaultProductVatClass: "zero", receiptLanguage: "ca-ES" };
  r.liveData.invalidate([{ type: "catalogue_settings" }]);
  await expect.poll(() => text(q(el, "[data-test=saved-receiptLanguage]"))).toBe("Catalan");
  expect(text(q(el, "[data-test=saved-defaultProductVatClass]"))).toBe("No tax (0%)");
});

it.each([
  ["en-GB", "By default, receipts print in Spanish until you switch to Catalan."],
  ["es", "Por defecto, los recibos se imprimen en español hasta que cambies a catalán."],
])(
  "says a Barcelona venue stored in Spanish prints in Spanish until switched (%s)",
  async (locale, sentence) => {
    setLocale(locale);
    const el = await mount(rig(BARCELONA).api);
    expect(text(q(el, "[data-test=stored-differs]"))).toBe(sentence);
  },
);

it("says nothing about a fixed language where none is fixed, or where the stored one is it", async () => {
  setLocale("en-GB");
  const madrid = await mount(rig().api);
  expect(q(madrid, "[data-test=stored-differs]")).toBeNull();
  const matching = await mount(rig({ ...BARCELONA, receiptLanguage: "ca-ES" }).api);
  expect(q(matching, "[data-test=stored-differs]")).toBeNull();
});

it("shows a read failure with Retry, and Retry recovers", async () => {
  setLocale("en-GB");
  const r = rig();
  r.api.getVenueDefaults.mockRejectedValueOnce({ code: "server.unavailable" });
  const { el } = await mountWidget<Panel>("dashboard-venue-defaults-panel", { api: r.api });
  await expect.poll(() => q(el, "[data-test=read-error]")).toBeTruthy();
  expect(q(el, "[data-test=read-error]")!.getAttribute("role")).toBe("alert");
  expect(q(el, "section.settings-card dl")).toBeNull();
  const retry = q(el, "[data-test=retry]") as HTMLElement;
  expect(text(retry)).toBe("Retry");
  retry.click();
  await expect.poll(() => text(q(el, "[data-test=saved-receiptLanguage]"))).toBe("Spanish");
  expect(q(el, "[data-test=read-error]")).toBeNull();
  expect(q(el, "[data-test=retry]")).toBeNull();
});
