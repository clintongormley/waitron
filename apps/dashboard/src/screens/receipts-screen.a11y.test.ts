import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./receipts-screen.js";
import type { ReceiptsScreen } from "./receipts-screen.js";
import type { DashboardApi, ReceiptConfig, ReceiptPreview } from "../api/client.js";

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
    },
  };
}

function stubApi(overrides: Partial<DashboardApi> = {}, receipt: ReceiptConfig = {}): DashboardApi {
  return {
    getReceipt: vi.fn().mockResolvedValue({ receipt: { ...receipt } }),
    putReceipt: vi.fn().mockResolvedValue(undefined),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Calle Mayor", operationDescription: "Venta en establecimiento" }),
    putLocationSettings: vi.fn().mockResolvedValue(undefined),
    previewReceipt: vi.fn(async (config: ReceiptConfig) => preview(config)),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ReceiptsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
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

  it("renders accessibly with a refused save shown in the form's bottom message", async () => {
    const { el, host } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api: stubApi({ putReceipt: vi.fn().mockRejectedValue({ code: "receipt.invalid" }) }) },
      theme,
    );
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("renders accessibly with a line of the preview outlined and both trim fields refused", async () => {
    const api = stubApi(
      {
        putReceipt: vi.fn().mockRejectedValue({
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
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-mark=headerSubtitle]")).not.toBeNull(),
    );
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await flush(el);
    el.shadowRoot!.querySelector("wt-input[name=headerSubtitle]")!
      .shadowRoot!.querySelector("input")!
      .focus();
    await flush(el);
    expect(
      el.shadowRoot!.querySelector("[data-mark=headerSubtitle]")!.hasAttribute("data-active"),
    ).toBe(true);
    await expectNoA11yViolations(host);
  });

  it("paints the footer's placeholder hint readably", async () => {
    const { el } = await mountWidget<ReceiptsScreen>(
      "dashboard-receipts-screen",
      { api: stubApi() },
      theme,
    );
    await flush(el);
    const footer = el.shadowRoot!.querySelector("textarea[name=footerMessage]")!;
    const placeholder = getComputedStyle(footer, "::placeholder").color;
    const field = getComputedStyle(footer).backgroundColor;
    expect(contrastRatio(placeholder, field)).toBeGreaterThanOrEqual(4.5);
  });
});
