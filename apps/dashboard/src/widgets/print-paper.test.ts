import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { PrintJobPreview } from "../api/client.js";
import { PrintPaper, paperStyles, type PaperMark } from "./print-paper.js";

@customElement("test-print-paper-host")
class TestPrintPaperHost extends LitElement {
  static override styles = [paperStyles];
  @property({ attribute: false }) preview!: PrintJobPreview;
  @property({ attribute: false }) marks: PaperMark[] = [];
  readonly #paper = new PrintPaper();
  override render() {
    return html`${this.#paper.render(this.preview, this.marks)}`;
  }
}

const line = (text: string) => ({
  kind: "image" as const,
  width: 16,
  height: 2,
  data: btoa("\0".repeat(4)),
  text,
});

const preview: PrintJobPreview = {
  widthDots: 16,
  columns: 2,
  text: "A\nB\nC\nD\n",
  blocks: [line("A"), line("B"), line("C"), line("D"), { kind: "cut" }],
  qrData: [],
  omittedGraphics: false,
  truncated: false,
  unsupported: false,
};

afterEach(cleanupWidgets);

it("draws a marked range's lines as a picture of their own, wrapped and named, and its neighbours apart", async () => {
  const { el } = await mountWidget<TestPrintPaperHost>("test-print-paper-host", {
    preview,
    marks: [{ name: "headerSubtitle", range: { start: 1, end: 3 }, active: false }],
  });
  const paper = el.shadowRoot!.querySelector(".paper")!;
  expect([...paper.children].map((node) => node.getAttribute("data-kind") ?? node.tagName)).toEqual(
    ["image", "DIV", "image", "cut"],
  );
  const mark = paper.querySelector<HTMLElement>("[data-mark=headerSubtitle]")!;
  expect([...mark.querySelectorAll("img")].map((img) => img.alt)).toEqual(["B\nC"]);
  expect([...paper.querySelectorAll(":scope > img")].map((img) => img.getAttribute("alt"))).toEqual(
    ["A", "D"],
  );
});

it("joins every unmarked line into one picture, as the print-job preview does", async () => {
  const { el } = await mountWidget<TestPrintPaperHost>("test-print-paper-host", { preview });
  const images = [...el.shadowRoot!.querySelectorAll("img")];
  expect(images.map((img) => img.alt)).toEqual(["A\nB\nC\nD"]);
});

it("outlines only the active mark, and an empty range marks nothing", async () => {
  const { el, host } = await mountWidget<TestPrintPaperHost>("test-print-paper-host", {
    preview,
    marks: [
      { name: "headerSubtitle", range: { start: 0, end: 1 }, active: true },
      { name: "footerMessage", range: { start: 3, end: 4 }, active: false },
      { name: "empty", range: { start: 2, end: 2 }, active: true },
    ],
  });
  const mark = (name: string) => el.shadowRoot!.querySelector<HTMLElement>(`[data-mark=${name}]`);
  expect(getComputedStyle(mark("headerSubtitle")!).outlineStyle).toBe("solid");
  expect(getComputedStyle(mark("footerMessage")!).outlineStyle).toBe("none");
  expect(mark("empty")).toBeNull();
  el.style.setProperty("--wt-selected-ring", "3px dashed rgb(1, 2, 3)");
  expect(getComputedStyle(mark("headerSubtitle")!).outlineColor).toBe("rgb(1, 2, 3)");
  await expectNoA11yViolations(host);
});

it("wraps every piece of a marked range in one element, text and pictures alike", async () => {
  const { el } = await mountWidget<TestPrintPaperHost>("test-print-paper-host", {
    preview: { ...preview, blocks: [{ kind: "text", text: "X\n" }, line("A"), line("B")] },
    marks: [{ name: "footerMessage", range: { start: 0, end: 2 }, active: false }],
  });
  const paper = el.shadowRoot!.querySelector(".paper")!;
  const mark = paper.querySelector("[data-mark=footerMessage]")!;
  expect([...mark.children].map((node) => node.getAttribute("data-kind"))).toEqual([
    "text",
    "image",
  ]);
  expect([...paper.children].map((node) => node.getAttribute("data-kind") ?? node.tagName)).toEqual(
    ["DIV", "image"],
  );
});
