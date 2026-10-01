import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { afterEach, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
  cleanupWidgets();
});

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

/** A line whose picture is its own: every byte of it is `ink`. */
const inked = (text: string, ink: number) => ({
  ...line(text),
  data: btoa(String.fromCharCode(ink).repeat(4)),
});

it("encodes a picture once while successive previews keep it, and keeps only the last preview's", async () => {
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
  const marks: PaperMark[] = [
    { name: "footerMessage", range: { start: 1, end: 2 }, active: false },
  ];
  const job = (footer: number): PrintJobPreview => ({
    ...preview,
    blocks: [inked("A", 1), inked("F", footer), inked("C", 3)],
  });
  const { el } = await mountWidget<TestPrintPaperHost>("test-print-paper-host", {
    preview: job(2),
    marks,
  });
  const sources = () => [...el.shadowRoot!.querySelectorAll("img")].map((img) => img.src);
  const first = sources();
  expect(encode).toHaveBeenCalledTimes(3);

  encode.mockClear();
  el.preview = job(4);
  await el.updateComplete;
  expect(encode).toHaveBeenCalledTimes(1);
  const second = sources();
  expect([second[0], second[2]]).toEqual([first[0], first[2]]);
  expect(second[1]).not.toBe(first[1]);

  encode.mockClear();
  el.preview = job(2);
  await el.updateComplete;
  expect(encode).toHaveBeenCalledTimes(1);
  expect(sources()).toEqual(first);
});
