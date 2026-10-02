import { LiveData } from "@waitron/dashboard-kit";
import type { ContentLanguages } from "@waitron/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type {
  DashboardApi,
  PrintPaperWidth,
  ReceiptConfig,
  ReceiptLanguage,
  ReceiptPreview,
} from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { ReceiptsScreen } from "./receipts-screen.js";

const CHOICES = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
const REASON = {
  en: "In Catalonia receipts print in Catalan.",
  es: "En Cataluña los recibos se imprimen en catalán.",
};
const madrid = (language = "es-ES"): ReceiptLanguage => ({
  language,
  choices: CHOICES,
  fixed: null,
});
const barcelona = (language = "ca-ES"): ReceiptLanguage => ({
  language,
  choices: CHOICES,
  fixed: { locale: "ca-ES", reason: REASON },
});

/** A stand-in for the server's drawing that prints which language it was asked to draw in. */
function drawn(
  _config: ReceiptConfig,
  _width?: PrintPaperWidth,
  language?: string,
): ReceiptPreview {
  const text = `Deli Test SL\nIdioma ${language ?? "guardado"}\n`;
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text,
      blocks: [{ kind: "text", text }],
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    marks: { headerSubtitle: null, footerMessage: null },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}

function stubApi(
  language: ReceiptLanguage,
  content: ContentLanguages = { defaultLanguage: "es", languages: ["es", "ca", "gl", "eu"] },
  overrides: Record<string, unknown> = {},
): DashboardApi {
  return {
    getReceipt: vi.fn().mockResolvedValue({ receipt: {} }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    getReceiptLanguage: vi.fn().mockResolvedValue(language),
    putReceiptLanguage: vi.fn().mockResolvedValue(undefined),
    getContentLanguages: vi.fn().mockResolvedValue(content),
    previewReceipt: vi.fn(drawn),
    ...overrides,
  } as unknown as DashboardApi;
}

const q = <T extends HTMLElement = HTMLElement>(el: ReceiptsScreen, selector: string) =>
  el.shadowRoot!.querySelector<T>(selector);
const select = (el: ReceiptsScreen) => q<HTMLSelectElement>(el, "select[name=receiptLanguage]");
const paperText = (el: ReceiptsScreen) => q(el, ".paper")?.textContent ?? "";
const warning = (el: ReceiptsScreen) => q(el, "[data-test=receipt-language-warning]");
const languageError = (el: ReceiptsScreen) =>
  q(el, "#receipt-language-error")?.textContent?.trim() ?? "";
async function bottomOf(el: ReceiptsScreen): Promise<string> {
  const actions = q(el, "wt-form-actions")! as HTMLElement & { error: string };
  return actions.error;
}

async function flush(el: ReceiptsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api: DashboardApi): Promise<ReceiptsScreen> {
  const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
  await flush(el);
  await vi.waitFor(() => expect(q(el, ".paper")).not.toBeNull());
  return el;
}

function pick(el: ReceiptsScreen, language: string): void {
  const field = select(el)!;
  field.value = language;
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

async function save(el: ReceiptsScreen): Promise<void> {
  q(el, "[data-test=save]")!.click();
  await flush(el);
}

const initialLocale = currentLocale();
beforeEach(() => setLocale("en-GB"));
afterEach(() => {
  cleanupWidgets();
  setLocale(initialLocale);
});

describe("the Receipts page's receipt language, where the venue may choose it", () => {
  it("offers the four languages by name in a labelled dropdown, with the saved one chosen", async () => {
    const el = await mount(stubApi(madrid("gl-ES")));
    const field = select(el)!;
    expect([...field.options].map((option) => [option.value, option.textContent!.trim()])).toEqual([
      ["es-ES", "Spanish"],
      ["ca-ES", "Catalan"],
      ["gl-ES", "Galician"],
      ["eu-ES", "Basque"],
    ]);
    expect([...field.selectedOptions].map((option) => option.value)).toEqual(["gl-ES"]);
    expect(field.labels![0]!.textContent).toContain(t("receipts.language"));
  });

  it("redraws the preview in a newly picked language at once, saving nothing", async () => {
    const api = stubApi(madrid());
    const el = await mount(api);
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}]]);
    pick(el, "gl-ES");
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}], [{}, undefined, "gl-ES"]]);
    await vi.waitFor(() => expect(paperText(el)).toContain("Idioma gl-ES"));
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  });

  it("draws in the saved language again, as before, when the saved one is picked back", async () => {
    const api = stubApi(madrid());
    const el = await mount(api);
    pick(el, "gl-ES");
    pick(el, "es-ES");
    await vi.waitFor(() => expect(paperText(el)).toContain("Idioma guardado"));
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([
      [{}],
      [{}, undefined, "gl-ES"],
      [{}],
    ]);
    await save(el);
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  });

  it("keeps the picked language when the paper width or the text changes", async () => {
    const twoWidths = vi.fn(
      async (config: ReceiptConfig, width?: PrintPaperWidth, language?: string) => ({
        ...drawn(config, width, language),
        paperWidths: ["58mm", "80mm"] as PrintPaperWidth[],
      }),
    );
    const api = stubApi(madrid(), undefined, { previewReceipt: twoWidths });
    const el = await mount(api);
    pick(el, "eu-ES");
    await chooseOption(q(el, "wt-combobox[name=paperWidth]")!, "58mm");
    await vi.waitFor(() => expect(twoWidths.mock.calls.at(-1)).toEqual([{}, "58mm", "eu-ES"]));
    q(el, "wt-input[name=headerSubtitle]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Hola" }, bubbles: true, composed: true }),
    );
    await vi.waitFor(() =>
      expect(twoWidths.mock.calls.at(-1)).toEqual([{ headerSubtitle: "Hola" }, "58mm", "eu-ES"]),
    );
  });

  it("saves a changed language first, then the description and the texts as before", async () => {
    const api = stubApi(madrid());
    const el = await mount(api);
    pick(el, "gl-ES");
    await save(el);
    expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("gl-ES");
    expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Venta en establecimiento");
    expect(api.putReceipt).toHaveBeenCalledExactlyOnceWith({});
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}], [{}, undefined, "gl-ES"]]);
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0]!;
    expect(order(api.putReceiptLanguage)).toBeLessThan(order(api.putReceipt));
    expect(order(api.putReceiptLanguage)).toBeLessThan(order(api.putLocationSettings));
    expect(q(el, "[role=status]")!.textContent).toBe(t("receipts.saved"));
    expect(select(el)!.value).toBe("gl-ES");
    await save(el);
    expect(api.putReceiptLanguage).toHaveBeenCalledTimes(1);
  });

  it("waits for the language to be saved before sending the rest", async () => {
    let answer!: () => void;
    const putReceiptLanguage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    const api = stubApi(madrid(), undefined, { putReceiptLanguage });
    const el = await mount(api);
    pick(el, "gl-ES");
    await save(el);
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(api.putReceipt).not.toHaveBeenCalled();
    answer();
    await vi.waitFor(() => expect(api.putLocationSettings).toHaveBeenCalledTimes(1));
    expect(api.putReceipt).toHaveBeenCalledTimes(1);
  });

  it("sends nothing about the language when it was not changed", async () => {
    const api = stubApi(madrid());
    const el = await mount(api);
    await save(el);
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    expect(api.putLocationSettings).toHaveBeenCalledExactlyOnceWith("Venta en establecimiento");
  });

  it.each(["receipt.language_orders_open", "receipt.language_fixed"])(
    "puts a %s refusal under the field, saves nothing else, and leaves Save working",
    async (code) => {
      const api = stubApi(madrid(), undefined, {
        putReceiptLanguage: vi
          .fn()
          .mockRejectedValue({ code, params: { field: "receiptLanguage", count: 2 } }),
      });
      const el = await mount(api);
      pick(el, "gl-ES");
      await save(el);
      expect(api.putLocationSettings).not.toHaveBeenCalled();
      expect(api.putReceipt).not.toHaveBeenCalled();
      expect(languageError(el)).toBe(codeMessage(code));
      expect(select(el)!.getAttribute("aria-invalid")).toBe("true");
      expect(select(el)!.getAttribute("aria-describedby")).toBe("receipt-language-error");
      expect(await bottomOf(el)).toBe(t("form.fix_fields"));
      expect(q(el, "[data-test=save]")!.hasAttribute("disabled")).toBe(false);
      expect(q(el, "[role=status]")).toBeNull();
      await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(select(el)));
      expect(select(el)!.value).toBe("gl-ES");
      pick(el, "eu-ES");
      await el.updateComplete;
      expect(languageError(el)).toBe("");
      expect(await bottomOf(el)).toBe("");
    },
  );

  it("says a refused language outside the offered ones under the field", async () => {
    const api = stubApi(madrid(), undefined, {
      putReceiptLanguage: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "receiptLanguage" },
      }),
    });
    const el = await mount(api);
    pick(el, "gl-ES");
    await save(el);
    expect(languageError(el)).toBe(t("receipts.language_invalid"));
  });

  it("says a language save that failed for another reason at the bottom, marking no field", async () => {
    const api = stubApi(madrid(), undefined, {
      putReceiptLanguage: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    const el = await mount(api);
    pick(el, "gl-ES");
    await save(el);
    expect(languageError(el)).toBe("");
    expect(await bottomOf(el)).toBe(
      `${t("receipts.language_save_error")} ${codeMessage("server.internal")}`,
    );
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(q(el, "[data-test=save]")!.hasAttribute("disabled")).toBe(false);
    vi.mocked(api.putReceiptLanguage).mockResolvedValue(undefined);
    await save(el);
    expect(await bottomOf(el)).toBe("");
    expect(api.putLocationSettings).toHaveBeenCalledTimes(1);
  });

  it("checks the description before sending the language", async () => {
    const api = stubApi(madrid());
    const el = await mount(api);
    pick(el, "gl-ES");
    q(el, "wt-input[name=operationDescription]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: " " }, bubbles: true, composed: true }),
    );
    await save(el);
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  });

  it("shows a stored language the venue no longer offers as chosen, and saves nothing for it", async () => {
    const api = stubApi(madrid("en-GB"));
    const el = await mount(api);
    const field = select(el)!;
    expect([...field.selectedOptions].map((option) => option.textContent!.trim())).toEqual([
      "English",
    ]);
    expect(field.value).toBe("en-GB");
    await save(el);
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
  });

  it("shows a stored value that is not a language as it is, without failing", async () => {
    const el = await mount(stubApi(madrid("not a language")));
    expect(select(el)!.selectedOptions[0]!.textContent!.trim()).toBe("not a language");
    expect(warning(el)).toBeNull();
  });

  it("follows a language saved elsewhere, and keeps a picked one", async () => {
    const liveData = new LiveData();
    const background = stubApi(madrid("eu-ES"));
    const api = Object.assign(stubApi(madrid()), { liveData, background });
    const el = await mount(api);
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(select(el)!.value).toBe("eu-ES"));
    await vi.waitFor(() => expect(background.previewReceipt).toHaveBeenCalledWith({}));
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}]]);
    pick(el, "gl-ES");
    vi.mocked(background.getReceiptLanguage).mockResolvedValue(madrid("ca-ES"));
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() => expect(background.getReceiptLanguage).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(select(el)!.value).toBe("gl-ES");
    await save(el);
    expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("gl-ES");
  });

  it("reports a failed read of the receipt language and offers retry", async () => {
    const api = stubApi(madrid(), undefined, {
      getReceiptLanguage: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(madrid("gl-ES")),
    });
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);
    expect(q(el, "[role=alert]")!.textContent).toBe(t("location_settings.load_error"));
    expect(q(el, "[data-test=save]")).toBeNull();
    q(el, "[data-test=retry]")!.click();
    await flush(el);
    await vi.waitFor(() => expect(select(el)?.value).toBe("gl-ES"));
  });
});

describe("the Receipts page's receipt language, where the region fixes it", () => {
  it("shows the language read-only with the region's reason, and Save never sends it", async () => {
    const api = stubApi(barcelona());
    const el = await mount(api);
    expect(select(el)).toBeNull();
    expect(q(el, "[data-test=receipt-language-value]")!.textContent!.trim()).toBe("Catalan");
    expect(q(el, "[data-test=receipt-language-reason]")!.textContent!.trim()).toBe(REASON.en);
    expect(q(el, "[data-test=use-fixed-language]")).toBeNull();
    await save(el);
    expect(api.putReceiptLanguage).not.toHaveBeenCalled();
    expect(api.putLocationSettings).toHaveBeenCalledTimes(1);
  });

  it("says a stored language other than the fixed one prints until corrected, and corrects it", async () => {
    let saved = "es-ES";
    const api = stubApi(barcelona(saved), undefined, {
      putReceiptLanguage: vi.fn(async (language: string) => {
        saved = language;
      }),
      previewReceipt: vi.fn((config: ReceiptConfig, width?: PrintPaperWidth, language?: string) =>
        Promise.resolve(drawn(config, width, language ?? saved)),
      ),
    });
    const el = await mount(api);
    expect(paperText(el)).toContain("Idioma es-ES");
    expect(q(el, "[data-test=receipt-language-value]")!.textContent!.trim()).toBe("Spanish");
    expect(q(el, "[data-test=receipt-language-stored]")!.textContent!.trim()).toBe(
      t("receipts.language_stored").replace("{stored}", "Spanish").replace("{fixed}", "Catalan"),
    );
    const use = q(el, "[data-test=use-fixed-language]")!;
    expect(use.textContent!.trim()).toBe("Use Catalan");
    use.click();
    await flush(el);
    expect(api.putReceiptLanguage).toHaveBeenCalledExactlyOnceWith("ca-ES");
    expect(api.putLocationSettings).not.toHaveBeenCalled();
    expect(q(el, "[data-test=receipt-language-value]")!.textContent!.trim()).toBe("Catalan");
    expect(q(el, "[data-test=use-fixed-language]")).toBeNull();
    expect(q(el, "[data-test=receipt-language-stored]")).toBeNull();
    expect(vi.mocked(api.previewReceipt).mock.calls).toEqual([[{}], [{}]]);
    await vi.waitFor(() => expect(paperText(el)).toContain("Idioma ca-ES"));
  });

  it("says a refused correction in the bottom message, as there is no field to fix, keeping the button", async () => {
    const api = stubApi(barcelona("es-ES"), undefined, {
      putReceiptLanguage: vi.fn().mockRejectedValue({
        code: "receipt.language_orders_open",
        params: { field: "receiptLanguage", count: 1 },
      }),
    });
    const el = await mount(api);
    q(el, "[data-test=use-fixed-language]")!.click();
    await flush(el);
    expect(languageError(el)).toBe("");
    expect(await bottomOf(el)).toBe(codeMessage("receipt.language_orders_open"));
    expect(q(el, "[data-test=use-fixed-language]")).not.toBeNull();
    await save(el);
    expect(await bottomOf(el)).toBe("");
    expect(api.putReceiptLanguage).toHaveBeenCalledTimes(1);
  });

  it("sends one correction while one is in flight", async () => {
    let answer!: () => void;
    const putReceiptLanguage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    const el = await mount(stubApi(barcelona("es-ES"), undefined, { putReceiptLanguage }));
    q(el, "[data-test=use-fixed-language]")!.click();
    await el.updateComplete;
    q(el, "[data-test=use-fixed-language]")!.click();
    q(el, "[data-test=save]")!.click();
    answer();
    await flush(el);
    expect(putReceiptLanguage).toHaveBeenCalledTimes(1);
  });
});

describe("the Receipts page's warning when receipts print in a language the content lacks", () => {
  it("names the receipt language and the default content language", async () => {
    const el = await mount(
      stubApi(madrid("gl-ES"), { defaultLanguage: "es", languages: ["es", "ca"] }),
    );
    expect(warning(el)!.getAttribute("role")).toBe("note");
    expect(warning(el)!.textContent!.trim()).toBe(
      t("receipt_language.warning")
        .replace("{receipt}", "Galician")
        .replace("{default}", "Spanish"),
    );
  });

  it("goes when the language is added to the content languages elsewhere", async () => {
    const liveData = new LiveData();
    const content = { defaultLanguage: "es", languages: ["es", "ca"] };
    const background = stubApi(madrid("gl-ES"), {
      defaultLanguage: "es",
      languages: ["es", "ca", "gl"],
    });
    const api = Object.assign(stubApi(madrid("gl-ES"), content), { liveData, background });
    const el = await mount(api);
    expect(warning(el)).not.toBeNull();
    liveData.invalidate([{ type: "content_languages" }]);
    await vi.waitFor(() => expect(warning(el)).toBeNull());
  });

  it("follows the picked language before it is saved", async () => {
    const el = await mount(stubApi(madrid(), { defaultLanguage: "es", languages: ["es"] }));
    expect(warning(el)).toBeNull();
    pick(el, "eu-ES");
    await el.updateComplete;
    expect(warning(el)!.textContent).toContain("Basque");
  });

  it("shows for a fixed language the content lacks", async () => {
    const el = await mount(stubApi(barcelona(), { defaultLanguage: "es", languages: ["es"] }));
    expect(warning(el)!.textContent).toContain("Catalan");
  });

  it("shows nothing, and the page still works, when the content languages cannot be read", async () => {
    const api = stubApi(madrid("gl-ES"), undefined, {
      getContentLanguages: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const el = await mount(api);
    expect(warning(el)).toBeNull();
    expect(q(el, "[role=alert]")).toBeNull();
    expect(select(el)).not.toBeNull();
  });
});

describe("the Receipts page's receipt language in Spanish", () => {
  it("labels the field, names the languages, gives the reason and warns in Spanish", async () => {
    setLocale("es-ES");
    const madridPage = await mount(
      stubApi(madrid("gl-ES"), { defaultLanguage: "es", languages: ["es"] }),
    );
    const field = select(madridPage)!;
    expect(field.labels![0]!.querySelector(".field-label")!.textContent).toBe("Idioma del recibo");
    expect([...field.options].map((option) => option.textContent!.trim())).toEqual([
      "Español",
      "Catalán",
      "Gallego",
      "Euskera",
    ]);
    expect(warning(madridPage)!.textContent!.trim()).toBe(
      "Los recibos se imprimen en gallego, que no es uno de tus idiomas del contenido, así que los nombres de los productos salen en español, el idioma predeterminado.",
    );
    cleanupWidgets();
    const barcelonaPage = await mount(stubApi(barcelona("es-ES")));
    expect(q(barcelonaPage, "[data-test=receipt-language-reason]")!.textContent!.trim()).toBe(
      REASON.es,
    );
    expect(q(barcelonaPage, "[data-test=use-fixed-language]")!.textContent!.trim()).toBe(
      "Usar catalán",
    );
  });
});
