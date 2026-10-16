import { LiveData } from "@waitron/dashboard-kit";
import type { ContentLanguages } from "@waitron/shared";
import { afterEach, expect, it, vi } from "vitest";
import type { WtButton, WtCombobox } from "@waitron/ui";
import type { DashboardApi, VenueDefaults } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
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
    putVenueDefaults: vi.fn(async (changes: Partial<VenueDefaults>) => {
      state.stored = { ...state.stored, ...changes };
      return structuredClone(state.stored);
    }),
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

const combo = (el: Panel, name: string) => q(el, `wt-combobox[name=${name}]`) as WtCombobox | null;
const saveButton = (el: Panel) => q(el, "[data-test=save]") as WtButton;
const bottom = (el: Panel) =>
  (q(el, "wt-form-actions") as (HTMLElement & { error: string }) | null)?.error ?? "";
async function edit(el: Panel) {
  (q(el, "[data-test=edit]") as HTMLElement).click();
  await el.updateComplete;
  await expect.poll(() => combo(el, "receiptLanguage")).toBeTruthy();
}
async function pick(el: Panel, name: string, value: string) {
  combo(el, name)!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

it("Edit opens both fields, required and without search, with Save quiet and disabled", async () => {
  setLocale("en-GB");
  const el = await mount(rig().api);
  await edit(el);
  expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(true);
  expect(q(el, "[data-test=edit]")).toBeNull();
  const language = combo(el, "receiptLanguage")!;
  const vat = combo(el, "defaultProductVatClass")!;
  for (const field of [language, vat]) {
    expect(field.required).toBe(true);
    expect(field.search).toBe("never");
  }
  expect(language.label).toBe("Default receipt language");
  expect(language.value).toBe("es-ES");
  expect(language.options.map((option) => option.value)).toEqual([
    "es-ES",
    "ca-ES",
    "gl-ES",
    "eu-ES",
  ]);
  expect(vat.label).toBe("VAT class for new products");
  expect(vat.value).toBe("reduced");
  expect(vat.options.map((option) => option.label)).toEqual([
    "General (21%)",
    "Reduced (10%)",
    "Super-reduced (4%)",
    "No tax (0%)",
  ]);
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).variant).toBe("secondary");
  const cancel = q(el, "[data-test=cancel]")!;
  expect(cancel.getAttribute("slot")).toBe("cancel");
});

it("offers a stored language outside the choices, so the field shows what is stored", async () => {
  setLocale("en-GB");
  const el = await mount(rig({ ...MADRID, receiptLanguage: "en-GB" }).api);
  await edit(el);
  expect(combo(el, "receiptLanguage")!.options.map((option) => option.value)).toEqual([
    "es-ES",
    "ca-ES",
    "gl-ES",
    "eu-ES",
    "en-GB",
  ]);
  expect(combo(el, "receiptLanguage")!.value).toBe("en-GB");
});

it("sends only the changed VAT class, and changing it back quiets Save", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  await pick(el, "defaultProductVatClass", "general");
  expect(saveButton(el).disabled).toBe(false);
  expect(saveButton(el).variant).toBe("primary");
  await pick(el, "defaultProductVatClass", "reduced");
  expect(saveButton(el).disabled).toBe(true);
  expect(saveButton(el).variant).toBe("secondary");
  await pick(el, "defaultProductVatClass", "zero");
  saveButton(el).click();
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(r.api.putVenueDefaults.mock.calls).toEqual([[{ defaultProductVatClass: "zero" }]]);
  expect(q(el, "section.settings-card")!.hasAttribute("data-editing")).toBe(false);
  expect(text(q(el, "[data-test=saved-defaultProductVatClass]"))).toBe("No tax (0%)");
});

it("sends both changes in one call and shows the answer in view mode", async () => {
  setLocale("en-GB");
  const r = rig();
  r.api.putVenueDefaults.mockImplementationOnce(async () => ({
    ...MADRID,
    receiptLanguage: "gl-ES",
    defaultProductVatClass: "general",
  }));
  const el = await mount(r.api);
  await edit(el);
  await pick(el, "receiptLanguage", "ca-ES");
  await pick(el, "defaultProductVatClass", "zero");
  saveButton(el).click();
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(r.api.putVenueDefaults.mock.calls).toEqual([
    [{ receiptLanguage: "ca-ES", defaultProductVatClass: "zero" }],
  ]);
  expect(text(q(el, "[data-test=saved-receiptLanguage]"))).toBe("Galician");
  expect(text(q(el, "[data-test=saved-defaultProductVatClass]"))).toBe("General (21%)");
});

it("Save does nothing while the draft is unchanged", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  saveButton(el).disabled = false;
  saveButton(el).click();
  await flush(el);
  expect(r.api.putVenueDefaults).not.toHaveBeenCalled();
});

it("Barcelona offers exactly one language, Catalan", async () => {
  setLocale("en-GB");
  const el = await mount(rig({ ...BARCELONA, receiptLanguage: "ca-ES" }).api);
  await edit(el);
  expect(combo(el, "receiptLanguage")!.options).toEqual([{ value: "ca-ES", label: "Catalan" }]);
  expect(saveButton(el).disabled).toBe(true);
});

it("a Barcelona venue stored in Spanish opens Edit on Catalan with Save live", async () => {
  setLocale("en-GB");
  const r = rig(BARCELONA);
  const el = await mount(r.api);
  await edit(el);
  expect(combo(el, "receiptLanguage")!.value).toBe("ca-ES");
  expect(combo(el, "receiptLanguage")!.options).toEqual([{ value: "ca-ES", label: "Catalan" }]);
  expect(saveButton(el).disabled).toBe(false);
  expect(saveButton(el).variant).toBe("primary");
  saveButton(el).click();
  await expect.poll(() => q(el, "[data-test=edit]")).toBeTruthy();
  expect(r.api.putVenueDefaults.mock.calls).toEqual([[{ receiptLanguage: "ca-ES" }]]);
});

it.each([
  [{ code: "receipt.language_orders_open" }, "receiptLanguage", "ca-ES", null],
  [{ code: "receipt.language_fixed" }, "receiptLanguage", "ca-ES", null],
  [
    { code: "management.request_invalid", params: { field: "receiptLanguage" } },
    "receiptLanguage",
    "ca-ES",
    "Choose one of the languages offered.",
  ],
  [
    { code: "product.invalid", params: { field: "defaultProductVatClass" } },
    "defaultProductVatClass",
    "zero",
    "Choose a VAT class for new products.",
  ],
] as const)(
  "puts the refusal %j beside its field, with the generic sentence at the bottom",
  async (refusal, field, value, sentence) => {
    setLocale("en-GB");
    const r = rig();
    r.api.putVenueDefaults.mockRejectedValueOnce(refusal);
    const el = await mount(r.api);
    await edit(el);
    await pick(el, field, value);
    saveButton(el).click();
    await expect.poll(() => combo(el, field)!.error).not.toBe("");
    if (sentence) expect(combo(el, field)!.error).toBe(sentence);
    else expect(combo(el, field)!.error).toBe(codeMessage(refusal.code));
    const other = field === "receiptLanguage" ? "defaultProductVatClass" : "receiptLanguage";
    expect(combo(el, other)!.error).toBe("");
    expect(bottom(el)).toBe("Correct the highlighted fields to continue.");
    await el.updateComplete;
    expect(saveButton(el).disabled).toBe(false);
    expect(combo(el, field)!.value).toBe(value);
    await pick(el, field, field === "receiptLanguage" ? "gl-ES" : "general");
    expect(combo(el, field)!.error).toBe("");
    expect(bottom(el)).toBe("");
  },
);

it("shows any other refusal at the bottom only, and Save stays enabled", async () => {
  setLocale("en-GB");
  const r = rig();
  r.api.putVenueDefaults.mockRejectedValueOnce({ code: "connection.failed" });
  const el = await mount(r.api);
  await edit(el);
  await pick(el, "defaultProductVatClass", "zero");
  saveButton(el).click();
  await expect.poll(() => bottom(el)).toBe(codeMessage("connection.failed"));
  expect(combo(el, "receiptLanguage")!.error).toBe("");
  expect(combo(el, "defaultProductVatClass")!.error).toBe("");
  await el.updateComplete;
  expect(saveButton(el).disabled).toBe(false);
});

it("a clean draft adopts a live change and a dirty one keeps its value", async () => {
  setLocale("en-GB");
  const r = rig();
  const el = await mount(r.api);
  await edit(el);
  r.state.stored = { ...r.state.stored, defaultProductVatClass: "general" };
  r.liveData.invalidate([{ type: "catalogue_settings" }]);
  await expect.poll(() => combo(el, "defaultProductVatClass")!.value).toBe("general");
  expect(saveButton(el).disabled).toBe(true);
  await pick(el, "receiptLanguage", "gl-ES");
  r.state.stored = { ...r.state.stored, receiptLanguage: "eu-ES", defaultProductVatClass: "zero" };
  r.liveData.invalidate([{ type: "locations" }]);
  await expect.poll(() => r.api.getVenueDefaults.mock.calls.length).toBe(3);
  await flush(el);
  expect(combo(el, "receiptLanguage")!.value).toBe("gl-ES");
  expect(combo(el, "defaultProductVatClass")!.value).toBe("general");
  expect(saveButton(el).disabled).toBe(false);
});
