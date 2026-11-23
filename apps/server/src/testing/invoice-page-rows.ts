import { layoutA4Invoice } from "../invoice-layout.js";
import { invoiceTextWidth } from "../invoice-page.js";
import type { ReceiptDocumentInput } from "../receipt-document.js";

/**
 * The printed A4 page's table rows, one string per column, read from where the page draws them:
 * each row ends at its 0.5 pt rule, and a figure is the cell whose right edge meets a column
 * heading's.
 */
export function pageRows(input: ReceiptDocumentInput): string[][] {
  return layoutA4Invoice(input).flatMap(({ elements }) => {
    const heading = elements.find(
      (element) => element.kind === "box" && element.fill === "heading",
    );
    if (heading?.kind !== "box") return [];
    const texts = elements.flatMap((element) => (element.kind === "text" ? [element] : []));
    const right = (text: (typeof texts)[number]) =>
      text.x + invoiceTextWidth(text.text, text.size, text.weight);
    const headed = texts.filter(({ y }) => y >= heading.y && y < heading.y + heading.height);
    const top = Math.min(...headed.map(({ y }) => y));
    const edges = headed
      .filter(({ y }) => y === top)
      .sort((one, other) => one.x - other.x)
      .map(right);
    const found: string[][] = [];
    let start = heading.y + heading.height;
    for (const rule of elements) {
      if (rule.kind !== "rule" || rule.thickness !== 0.5 || rule.y < start) continue;
      const cells: string[][] = edges.map(() => []);
      for (const text of texts.filter(({ y }) => y >= start && y < rule.y)) {
        const column = edges.findIndex(
          (edge, index) => index > 0 && Math.abs(edge - right(text)) < 0.01,
        );
        cells[Math.max(0, column)]!.push(text.text);
      }
      found.push(cells.map((lines) => lines.join(" ")));
      start = rule.y + rule.thickness;
    }
    return found;
  });
}
