import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./receipts-screen.js";
import type { ReceiptsScreen } from "./receipts-screen.js";
import type {
  DashboardApi as ProductionApi,
  ReceiptConfig,
  ReceiptPreview,
} from "../api/client.js";

type DashboardApi = ProductionApi & {
  drawReceipt(
    config: ReceiptConfig,
    width?: import("../api/client.js").PrintPaperWidth,
    language?: string,
  ): Promise<ReceiptPreview>;
};

function preview(config: ReceiptConfig): ReceiptPreview {
  const lines = ["Deli Test SL", ...(config.headerSubtitle ? [config.headerSubtitle] : [])];
  return {
    preview: {
      widthDots: 512,
      columns: 42,
      text: lines.join("\n"),
      blocks: lines.map((text) => ({ kind: "text", text: `${text}\n` })),
      qrData: [],
      omittedGraphics: false,
      truncated: false,
      unsupported: false,
    },
    marks: {
      headerSubtitle: config.headerSubtitle ? { start: 1, end: 2 } : null,
      footerMessage: null,
      phone: null,
      email: null,
      address: null,
      logo: null,
    },
    paperWidth: "80mm",
    paperWidths: ["80mm"],
  };
}

function stubApi(overrides: Partial<DashboardApi> = {}, receipt: ReceiptConfig = {}): DashboardApi {
  const api = {
    getVenueDepartments: vi
      .fn()
      .mockResolvedValue([{ id: "bar", name: "Bar", active: true, isDefault: true }]),
    getReceipt: vi.fn().mockResolvedValue({ receipt: { ...receipt }, venueAddress: [] }),
    putVenueReceiptSettings: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    getReceiptLanguage: vi.fn().mockResolvedValue({
      language: "es-ES",
      choices: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
      fixed: null,
    }),
    putReceiptLanguage: vi.fn().mockResolvedValue(undefined),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    drawReceipt: vi.fn(async (config: ReceiptConfig) => preview(config)),
    ...overrides,
  } as unknown as DashboardApi;
  api.getVenueReceiptSettings = vi.fn(async () => {
    const settings = { ...(await api.getReceipt()).receipt };
    delete settings.phone;
    delete settings.email;
    return { settings };
  });
  api.getDepartmentReceipt = vi.fn(async () => {
    const { receipt, venueAddress } = await api.getReceipt();
    return {
      receipt: {
        ...(receipt.phone ? { phone: receipt.phone } : {}),
        ...(receipt.email ? { email: receipt.email } : {}),
      },
      receiptLanguage: "es-ES",
      venueDefaults: {},
      venueAddress,
      languages: ["es-ES"],
      warningLanguages: [],
    };
  });
  api.putDepartmentReceipt = vi.fn().mockResolvedValue(undefined);
  api.previewReceiptDraft = vi.fn(async (draft) =>
    api.drawReceipt({ ...draft.settings, ...draft.receipt } as ReceiptConfig),
  );
  return api;
}

function q<T extends Element = HTMLElement>(el: ReceiptsScreen, selector: string): T | null {
  return (
    el
      .shadowRoot!.querySelector("dashboard-venue-receipt-defaults-editor")
      ?.shadowRoot?.querySelector<T>(selector) ??
    el
      .shadowRoot!.querySelector("dashboard-department-receipt-editor")
      ?.shadowRoot?.querySelector<T>(selector) ??
    el.shadowRoot!.querySelector<T>(selector)
  );
}
async function flush(el: ReceiptsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** An edit, so Save can be pressed. */
async function editHeader(el: ReceiptsScreen, value: string): Promise<void> {
  q(el, "wt-input[name=headerSubtitle]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function saveState(el: ReceiptsScreen) {
  const save = q<HTMLElementTagNameMap["wt-button"]>(el, "[data-test=defaults-save]")!;
  await save.updateComplete;
  return [save.variant, save.disabled];
}

// axe does not score a placeholder's contrast, so the footer's placeholder hint is measured here.
// The parser reads rgb()/rgba() only, which is why each colour is checked for that form first.
function contrastRatio(a: string, b: string): number {
  const luminance = (rgb: string) => {
    expect(rgb).toMatch(/^rgba?\(/);
    const [r, g, bl] = rgb
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map((part) => Number(part) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("receipts-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with both fields populated", async () => {
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      {
        api: stubApi(
          {},
          { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" },
        ),
      },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with Save quiet, then with Save ready after an edit", async () => {
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      {
        api: stubApi(
          {},
          { headerSubtitle: "Calle Mayor 1", footerMessage: "Gracias por su visita" },
        ),
      },
      theme,
    );
    await flush(el);
    expect(await saveState(el)).toEqual(["secondary", true]);
    await expectNoA11yViolations(host);
    await editHeader(el, "Calle Mayor 2");
    expect(await saveState(el)).toEqual(["primary", false]);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a refused save shown in the form's bottom message", async () => {
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      {
        api: stubApi({
          putVenueReceiptSettings: vi.fn().mockRejectedValue({ code: "receipt.invalid" }),
        }),
      },
      theme,
    );
    await flush(el);
    await editHeader(el, "Calle Mayor 1");
    q<HTMLElement>(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(q<HTMLElement & { error: string }>(el, "wt-form-actions")!.error).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a line of the preview outlined and both trim fields refused", async () => {
    const api = stubApi(
      {
        putVenueReceiptSettings: vi.fn().mockRejectedValue({
          code: "receipt.invalid",
          params: { reason: "too_long", field: "footerMessage", maxLength: 200 },
        }),
      },
      { headerSubtitle: "Calle Mayor 1" },
    );
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api },
      theme,
    );
    await flush(el);
    await vi.waitFor(() => expect(q(el, "[data-mark=headerSubtitle]")).not.toBeNull());
    q(el, "wt-textarea[name=footerMessage]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Gracias por su visita" },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    q<HTMLElement>(el, "[data-test=defaults-save]")!.click();
    await flush(el);
    expect(
      q<HTMLElement & { error: string }>(el, "wt-textarea[name=footerMessage]")!.error,
    ).not.toBe("");
    q(el, "wt-input[name=headerSubtitle]")!.shadowRoot!.querySelector("input")!.focus();
    await flush(el);
    expect(q(el, "[data-mark=headerSubtitle]")!.hasAttribute("data-active")).toBe(true);
    await expectNoA11yViolations(host);
  });

  const LOGO = `${"c".repeat(64)}.png`;
  const topBlock = { phone: "+34 912 345 678", email: "hola@deli.es", logo: LOGO };

  it.each([
    ["on, with the address it prints", { ...topBlock }, ["Calle Mayor 1", "28013 Madrid"]],
    ["off", { ...topBlock, printAddress: false }, ["Calle Mayor 1", "28013 Madrid"]],
    ["on, with no address saved", { ...topBlock }, []],
  ])(
    "renders accessibly with a logo, a phone, an email and the address switch %s",
    async (_, receipt, venueAddress) => {
      const api = stubApi({
        getReceipt: vi.fn().mockResolvedValue({ receipt, venueAddress }),
      });
      const { el, host } = await mountWidget<ReceiptsScreen>(
        "dashboard-receipts-screen",
        { api },
        theme,
      );
      await flush(el);
      const shown = q(
        el,
        venueAddress.length > 0 ? "[data-test=venue-address]" : "[data-test=no-address]",
      );
      expect(shown).not.toBeNull();
      expect(
        q<HTMLElementTagNameMap["dashboard-image-upload"]>(el, "dashboard-image-upload")!.image,
      ).toBe(LOGO);
      await expectNoA11yViolations(host);
    },
  );

  it.each([
    [{ reason: "invalid_phone", field: "phone" }, "wt-input[name=phone]"],
    [{ reason: "invalid_email", field: "email" }, "wt-input[name=email]"],
    [{ reason: "image_not_found", field: "logo" }, "[data-test=logo-error]"],
    [{ reason: "not_boolean", field: "printAddress" }, "[data-test=print-address-error]"],
  ])("renders accessibly with the save's refusal %j shown under its field", async (params, at) => {
    const api = stubApi({
      getReceipt: vi.fn().mockResolvedValue({ receipt: topBlock, venueAddress: ["Calle Mayor 1"] }),
      putVenueReceiptSettings: vi.fn().mockRejectedValue({ code: "receipt.invalid", params }),
    });
    const contact = params.field === "phone" || params.field === "email";
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api, departmentId: contact ? "bar" : "", departmentName: "Bar" },
      theme,
    );
    await flush(el);
    await vi.waitFor(() =>
      expect(
        q(el, contact ? "[data-test=department-save]" : "[data-test=defaults-save]"),
      ).toBeTruthy(),
    );
    if (contact) {
      api.putDepartmentReceipt = vi.fn().mockRejectedValue({ code: "receipt.invalid", params });
      const input = q(el, `wt-input[name=${params.field}]`)!;
      input.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: params.field === "phone" ? "933333333" : "other@example.com" },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
    } else await editHeader(el, "Calle Mayor 1");
    q<HTMLElement>(
      el,
      contact ? "[data-test=department-save]" : "[data-test=defaults-save]",
    )!.click();
    await flush(el);
    const marked = q<HTMLElement & { error?: string }>(el, at)!;
    expect(marked.error ?? marked.textContent!.trim()).not.toBe("");
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the paper width dropdown shown", async () => {
    const api = stubApi({
      drawReceipt: vi.fn(async (config: ReceiptConfig): Promise<ReceiptPreview> => ({
        ...preview(config),
        paperWidths: ["58mm", "80mm"],
      })),
    });
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api },
      theme,
    );
    await flush(el);
    await vi.waitFor(() => expect(q(el, "wt-combobox[name=paperWidth]")).not.toBeNull());
    await expectNoA11yViolations(host);
  });

  const choices = ["es-ES", "ca-ES", "gl-ES", "eu-ES"];
  const reason = { en: "Receipts here print in Catalan.", es: "Aquí se imprimen en catalán." };

  it.each([
    ["chosen, with a refusal under it", { language: "gl-ES", choices, fixed: null }],
    ["fixed", { language: "ca-ES", choices, fixed: { locale: "ca-ES", reason } }],
    [
      "fixed, with another stored and the button to correct it",
      { language: "es-ES", choices, fixed: { locale: "ca-ES", reason } },
    ],
  ])("renders accessibly with the receipt language %s", async (_, receiptLanguage) => {
    const api = stubApi({
      getReceiptLanguage: vi.fn().mockResolvedValue(receiptLanguage),
      putReceiptLanguage: vi.fn().mockRejectedValue({
        code: "receipt.language_orders_open",
        params: { field: "receiptLanguage", count: 1 },
      }),
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "ca", "gl"] }),
    });
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api },
      theme,
    );
    await flush(el);
    const language = q(el, "wt-combobox[name=receiptLanguage]");
    if (receiptLanguage.fixed === null) {
      await chooseOption(language!, "ca-ES");
      await flush(el);
      q<HTMLElement>(el, "[data-test=language-save]")!.click();
      await flush(el);
      await vi.waitFor(() =>
        expect(language!.shadowRoot!.querySelector("[data-error]")).not.toBeNull(),
      );
    } else {
      expect(language).toBeNull();
    }
    expect(q(el, "[data-test=receipt-language-warning]")).toBeNull();
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with the warning that receipts print in a language the content lacks", async () => {
    const api = stubApi({
      getReceiptLanguage: vi.fn().mockResolvedValue({ language: "gl-ES", choices, fixed: null }),
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "ca"] }),
    });
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api },
      theme,
    );
    await flush(el);
    expect(q(el, "[data-test=receipt-language-warning]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("paints the footer's placeholder hint readably", async () => {
    const { el } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    const footer = q(el, "wt-textarea[name=footerMessage]")!;
    const placeholder = getComputedStyle(
      footer.shadowRoot!.querySelector("textarea")!,
      "::placeholder",
    ).color;
    const field = getComputedStyle(footer.shadowRoot!.querySelector(".field")!).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });
});
