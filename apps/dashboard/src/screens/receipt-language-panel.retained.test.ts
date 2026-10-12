import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  mount,
  field,
  pick,
  original,
  deferred,
  clickSave,
  save,
} from "../testing/receipt-language-fixture.js";
import type { DashboardApi } from "../api/client.js";
import "./receipt-language-panel.js";

beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

it.each([
  { locale: "en-GB", names: ["Spanish", "Catalan", "Galician", "Basque"] },
  { locale: "es-ES", names: ["Español", "Catalán", "Gallego", "Euskera"] },
] as const)(
  "the required language control names its choices in $locale",
  async ({ locale, names }) => {
    setLocale(locale);
    const { panel } = await mount({ ...original, language: "gl-ES" });
    const control = field(panel);
    await control.updateComplete;
    expect(control.name).toBe("receiptLanguage");
    expect(control.label).toBe(t("receipts.language"));
    expect(control.required).toBe(true);
    const star = control.shadowRoot!.querySelector(".required")!;
    expect(star.textContent).toBe("*");
    expect(star.getAttribute("aria-hidden")).toBe("true");
    expect(control.options.map((option) => option.label)).toEqual(names);
    expect(control.value).toBe("gl-ES");
  },
);
it("a failed language read offers Retry and does not reveal an unsaved selector", async () => {
  const getReceiptLanguage = vi
    .fn()
    .mockRejectedValueOnce(new Error("private"))
    .mockResolvedValue({ ...original, language: "gl-ES" });
  const api = {
    getReceiptLanguage,
    getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
  } as unknown as DashboardApi;
  const { el: panel } = await mountWidget<
    HTMLElementTagNameMap["dashboard-receipt-language-panel"]
  >("dashboard-receipt-language-panel", { api });
  await expect
    .poll(() =>
      panel.shadowRoot!.querySelector("[data-test=language-load-error]")?.textContent?.trim(),
    )
    .toBe(codeMessage("server.internal_error"));
  expect(field(panel)).toBeNull();
  await userEvent.click(page.elementLocator(panel.shadowRoot!.querySelector("wt-button")!));
  await expect.poll(() => field(panel)?.value).toBe("gl-ES");
  expect(getReceiptLanguage).toHaveBeenCalledTimes(2);
});
it("names absent receipt content, follows a staged language and recovers after content is enabled", async () => {
  let languages = ["es"];
  const { panel, liveData, writes } = await mount(original, {
    getContentLanguages: async () => ({ defaultLanguage: "es", languages }),
  });
  const warning = () => panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]");
  await pick(panel, "gl-ES");
  await expect.poll(() => warning()?.textContent).toContain("Galician");
  expect(warning()!.getAttribute("role")).toBe("note");
  expect(warning()!.textContent!.trim()).toBe(
    t("receipt_language.warning").replace("{receipt}", "Galician").replace("{default}", "Spanish"),
  );
  languages = ["es", "gl"];
  liveData.invalidate([{ type: "content_languages" }]);
  await expect.poll(warning).toBeNull();
  expect(field(panel).value).toBe("gl-ES");
  expect(writes).toEqual([]);
});
it("content-read failure is nonblocking and its later recovery restores the warning", async () => {
  let failed = true;
  const { panel, liveData } = await mount(
    { ...original, language: "gl-ES" },
    {
      getContentLanguages: async () => {
        if (failed) throw new Error("offline");
        return { defaultLanguage: "es", languages: ["es"] };
      },
    },
  );
  expect(field(panel).value).toBe("gl-ES");
  expect(panel.shadowRoot!.querySelector("[role=alert]")).toBeNull();
  expect(panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]")).toBeNull();
  failed = false;
  liveData.invalidate([{ type: "content_languages" }]);
  await expect
    .poll(
      () => panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]")?.textContent,
    )
    .toContain("Galician");
});
it("a fixed-language correction refuses below its action and blocks duplicate writes only while pending", async () => {
  const pending = deferred<void>();
  const fixed = { locale: "ca-ES", reason: { en: "Regional rule", es: "Regla regional" } };
  const { panel, writes } = await mount(
    { ...original, fixed },
    { putReceiptLanguage: () => pending.promise },
  );
  expect(field(panel)).toBeNull();
  expect(panel.shadowRoot!.querySelector(".reason")!.textContent).toContain("Regional rule");
  const use = panel.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=use-fixed-language]",
  )!;
  await userEvent.click(page.elementLocator(use));
  await panel.updateComplete;
  expect(use.disabled).toBe(true);
  use.click();
  expect(writes).toEqual(["ca-ES"]);
  pending.reject({ code: "receipt.language_orders_open", params: { field: "receiptLanguage" } });
  await expect
    .poll(() => panel.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe(codeMessage("receipt.language_orders_open"));
  expect(use.disabled).toBe(false);
  expect(
    panel.shadowRoot!.querySelector("[data-test=receipt-language-value]")!.textContent,
  ).toContain("Spanish");
  expect(field(panel)).toBeNull();
});

it("shows an arbitrary stored language unchanged without inventing a content warning or write", async () => {
  const { panel, writes } = await mount({ ...original, language: "not a language" });
  await field(panel).updateComplete;
  expect(field(panel).value).toBe("not a language");
  expect(field(panel).shadowRoot!.querySelector(".trigger")!.textContent).toContain(
    "not a language",
  );
  expect(panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]")).toBeNull();
  expect(save(panel).disabled).toBe(true);
  expect(writes).toEqual([]);
});

it("explains a rejected language value beside the chooser in its own wording", async () => {
  const { panel, writes } = await mount(original, {
    putReceiptLanguage: async () => {
      throw { code: "management.request_invalid", params: { field: "receiptLanguage" } };
    },
  });
  await pick(panel, "gl-ES");
  await clickSave(panel);
  await expect.poll(() => field(panel).error).toBe(t("receipts.language_invalid"));
  expect(save(panel).disabled).toBe(false);
  expect(writes).toEqual(["gl-ES"]);
});

it("words the missing-content warning and fixed regional reason and action in Spanish", async () => {
  setLocale("es-ES");
  const { panel } = await mount(
    { ...original, language: "gl-ES" },
    {
      getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }),
    },
  );
  await expect
    .poll(() =>
      panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]")?.textContent?.trim(),
    )
    .toBe(
      "Por defecto, los recibos se imprimen en gallego, que no es uno de tus idiomas del contenido. Los nombres de los productos salen en español, el idioma predeterminado.",
    );
  cleanupWidgets();
  const { panel: regional } = await mount({
    ...original,
    fixed: { locale: "ca-ES", reason: { en: "Regional rule", es: "Regla regional" } },
  });
  expect(regional.shadowRoot!.querySelector(".reason")!.textContent!.trim()).toBe("Regla regional");
  expect(
    regional.shadowRoot!.querySelector("[data-test=use-fixed-language]")!.textContent!.trim(),
  ).toBe("Usar catalán");
});

it("warns when the fixed receipt language is absent from the content languages", async () => {
  const { panel } = await mount(
    { ...original, language: "ca-ES", fixed: { locale: "ca-ES", reason: { en: "Regional rule" } } },
    { getContentLanguages: async () => ({ defaultLanguage: "es", languages: ["es"] }) },
  );
  await expect
    .poll(
      () => panel.shadowRoot!.querySelector("[data-test=receipt-language-warning]")?.textContent,
    )
    .toContain("Catalan");
});
