import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { WtModal } from "@waitron/ui/src/components/wt-modal.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { t } from "../i18n/t.js";
import type { PrintJobPreview } from "../api/client.js";
import { PrintJobPreviewDialog } from "./print-job-preview.js";

const preview: PrintJobPreview = {
  columns: 42,
  dpi: 180,
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

const initialViewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(async () => {
  cleanupWidgets();
  await page.viewport(initialViewport.width, initialViewport.height);
});

describe("print job preview", () => {
  it.each([
    ["light", 1280],
    ["dark", 1280],
    ["light", 390],
    ["dark", 390],
  ] as const)(
    "centres images and legend without shifting body text in %s at %i pixels",
    async (theme, width) => {
      await page.viewport(width, 800);
      const { el, host } = await mountWidget<PrintJobPreviewDialog>(
        "dashboard-print-job-preview",
        {
          open: true,
          preview: {
            ...preview,
            blocks: [
              { kind: "text", text: "Body".padEnd(42) + "\n", align: "center" },
              {
                kind: "image",
                width: 120,
                height: 120,
                data: btoa("\xff".repeat(1800)),
                align: "center",
              },
              { kind: "text", text: "VERI*FACTU\n", align: "center" },
              { kind: "image", width: 120, height: 1, data: btoa("\0".repeat(15)), align: "right" },
              { kind: "text", text: "Right", align: "right" },
            ],
          },
        },
        theme,
      );
      const paper = el.shadowRoot!.querySelector<HTMLElement>(".paper")!;
      const [body, legend, right] = paper.querySelectorAll("pre");
      const [image, rightImage] = paper.querySelectorAll("img");
      await image!.decode();
      const bounds = paper.getBoundingClientRect();
      const img = image!.getBoundingClientRect();
      expect(Math.abs((img.left + img.right) / 2 - (bounds.left + bounds.right) / 2)).toBeLessThan(
        1,
      );
      const textBounds = (element: Element) => {
        const range = document.createRange();
        const node = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!;
        range.setStart(node, 0);
        range.setEnd(node, node.textContent!.trimEnd().length);
        return range.getBoundingClientRect();
      };
      const caption = textBounds(legend!);
      expect(
        Math.abs((caption.left + caption.right) / 2 - (img.left + img.right) / 2),
      ).toBeLessThan(1);
      expect(Math.abs(textBounds(body!).left - body!.getBoundingClientRect().left)).toBeLessThan(1);
      expect(getComputedStyle(right!).textAlign).toBe("right");
      expect(
        Math.abs(rightImage!.getBoundingClientRect().right - right!.getBoundingClientRect().right),
      ).toBeLessThan(1);
      await expectNoA11yViolations(host);
    },
  );
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

it("sizes the paper's text area to the printer's columns and images in the same character units", async () => {
  const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
    open: true,
    preview: {
      ...preview,
      columns: 30,
      qrData: [],
      blocks: [
        { kind: "text", text: "x".repeat(30) },
        { kind: "text", text: "y".repeat(31) },
        // 180 dots = 15 printed columns at 12 dots per column: half the paper.
        { kind: "image", width: 180, height: 2, data: btoa("\0".repeat(23 * 2)) },
      ],
    },
  });
  await el.shadowRoot!.querySelector<WtModal>("wt-modal")!.updateComplete;
  const paper = el.shadowRoot!.querySelector<HTMLElement>(".paper")!;
  const [fits, spills] = [...paper.querySelectorAll("pre")];
  const lineHeight = parseFloat(getComputedStyle(fits!).lineHeight);
  expect(fits!.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
  expect(spills!.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 1.5);
  const probe = document.createElement("span");
  probe.style.whiteSpace = "pre";
  probe.textContent = "0".repeat(30);
  paper.append(probe);
  const contentWidth = parseFloat(getComputedStyle(paper).width);
  expect(Math.abs(contentWidth - probe.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  probe.remove();
  const img = paper.querySelector("img")!;
  expect(Math.abs(img.getBoundingClientRect().width - contentWidth / 2)).toBeLessThanOrEqual(1);
  expect(el.shadowRoot!.querySelector("select")).toBeNull();
});
