import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import type { WtModal } from "@waitron/ui/src/components/wt-modal.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import { PrintJobPreviewDialog } from "./print-job-preview.js";

const preview = {
  text: "Café <img src=x onerror=alert(1)>\nTotal 12.50\n",
  qrData: ["javascript:alert(1)"],
  omittedGraphics: false,
  unsupported: false,
  truncated: false,
};

afterEach(cleanupWidgets);

describe("print job preview", () => {
  it("shows stored receipt text and QR content as text with a visible limitation notice", async () => {
    const { el, host } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
      open: true,
      preview,
    });
    expect(el.shadowRoot!.querySelector("pre")?.textContent).toBe(preview.text);
    expect(el.shadowRoot!.textContent).toContain(preview.qrData[0]);
    expect(el.shadowRoot!.querySelector("img,a,script")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(t("printers.preview_notice"));
    const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
    await modal.updateComplete;
    expect(modal.heading).toBe(t("printers.preview_title"));
    expect(modal.querySelector('[slot="footer"]')?.textContent).toContain(t("action.close"));
    await expectNoA11yViolations(host);
  });

  it("closes with the fixed footer button and emits one preview-close event", async () => {
    const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
      open: true,
      preview,
    });
    const close = vi.fn();
    el.addEventListener("preview-close", close);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=preview-close]")!.click();
    await el.updateComplete;
    expect(el.open).toBe(false);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });

  it("closes with Escape and tells the screen", async () => {
    const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
      open: true,
      preview,
    });
    const close = vi.fn();
    el.addEventListener("preview-close", close);
    await el.shadowRoot!.querySelector<WtModal>("wt-modal")!.updateComplete;
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(el.open).toBe(false));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(["truncated", "unsupported"] as const)(
    "warns that a %s preview is incomplete",
    async (flag) => {
      const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
        open: true,
        preview: { ...preview, omittedGraphics: true, [flag]: true },
      });
      expect(el.shadowRoot!.textContent).toContain(t("printers.preview_graphics_omitted"));
      expect(el.shadowRoot!.textContent).toContain(t("printers.preview_incomplete"));
    },
  );

  it("explains a drawer-only job with no printable text", async () => {
    const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
      open: true,
      preview: { ...preview, text: "", qrData: [] },
    });
    expect(el.shadowRoot!.textContent).toContain(t("printers.preview_empty"));
    expect(el.shadowRoot!.querySelector("pre")).toBeNull();
  });

  it("starts closed without a selected preview", async () => {
    const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {});
    expect(el.open).toBe(false);
    expect(el.shadowRoot!.querySelector<WtModal>("wt-modal")!.open).toBe(false);
  });
});
