import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import type { WtModal } from "@waitron/ui/src/components/wt-modal.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import type { PrintJobPreview } from "../api/client.js";
import { PrintJobPreviewDialog } from "./print-job-preview.js";

const preview: PrintJobPreview = {
  text: "Café <img src=x onerror=alert(1)>\nTotal 12.50\n",
  qrData: ["javascript:alert(1)"],
  blocks: [
    { kind: "text", text: "Café <img src=x onerror=alert(1)>\nTotal 12.50\n" },
    { kind: "image", width: 8, height: 2, data: "gAE=", qrData: "javascript:alert(1)" },
    { kind: "feed", lines: 5 },
    { kind: "cut" },
  ],
  omittedGraphics: false,
  unsupported: false,
  truncated: false,
};

afterEach(cleanupWidgets);

describe("print job preview", () => {
  it("shows receipt text and QR content safely alongside a visual paper preview", async () => {
    const { el, host } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
      open: true,
      preview,
    });
    expect(el.shadowRoot!.querySelector("pre")?.textContent).toBe(preview.text);
    expect(el.shadowRoot!.textContent).toContain(preview.qrData[0]);
    expect(el.shadowRoot!.querySelector("a,script")).toBeNull();
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
      preview: { ...preview, text: "", qrData: [], blocks: [] },
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

it("lets a keyboard user scroll a long stored receipt while Close remains visible", async () => {
  const { el, host } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
    open: true,
    preview: {
      ...preview,
      text: "Kitchen ticket line\n".repeat(100),
      blocks: [{ kind: "text", text: "Kitchen ticket line\n".repeat(100) }],
    },
  });
  const modal = el.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  await modal.updateComplete;
  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  await expectNoA11yViolations(host);
  body.focus();
  await userEvent.keyboard("{PageDown}");
  await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
  expect(
    el.shadowRoot!.querySelector("[data-test=preview-close]")!.getBoundingClientRect().bottom,
  ).toBeLessThan(window.innerHeight);
});

it.each(["light", "dark"] as const)(
  "renders ordered paper blocks and actual bitmap pixels in %s mode",
  async (theme) => {
    const { el, host } = await mountWidget<PrintJobPreviewDialog>(
      "dashboard-print-job-preview",
      { open: true, preview },
      theme,
    );
    const paper = el.shadowRoot!.querySelector<HTMLElement>(".paper")!;
    expect(paper).not.toBeNull();
    expect([...paper.children].map((node) => node.getAttribute("data-kind"))).toEqual([
      "text",
      "image",
      "feed",
      "cut",
    ]);
    expect(getComputedStyle(paper).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(paper).color).toBe("rgb(0, 0, 0)");
    const img = paper.querySelector("img")!;
    expect(img.src).toMatch(/^data:image\/png;base64,/);
    await img.decode();
    expect([img.naturalWidth, img.naturalHeight]).toEqual([8, 2]);
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    expect([...ctx.getImageData(0, 0, 2, 1).data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...ctx.getImageData(7, 1, 1, 1).data]).toEqual([0, 0, 0, 255]);
    expect(
      paper.querySelector<HTMLElement>('[data-kind="feed"]')!.getBoundingClientRect().height,
    ).toBeGreaterThan(50);
    await expectNoA11yViolations(host);
  },
);

it("changes the paper approximation without changing stored job content", async () => {
  const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
    open: true,
    preview,
  });
  const paper = el.shadowRoot!.querySelector<HTMLElement>(".paper")!;
  const before = paper.getBoundingClientRect().width;
  const select = el.shadowRoot!.querySelector<HTMLSelectElement>('[name="preview-paper-width"]')!;
  select.value = "58";
  select.dispatchEvent(new Event("change"));
  await el.updateComplete;
  expect(paper.getBoundingClientRect().width).toBeLessThan(before);
  expect(el.preview).toBe(preview);
  expect(paper.querySelector("pre")!.textContent).toBe(preview.text);
});
