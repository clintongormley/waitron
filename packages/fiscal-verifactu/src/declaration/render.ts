import "../errors.js";
import { AppError } from "@waitron/shared";
import { PRODUCER_SLOTS, SLOT } from "./source.js";

export type DeclarationProducer = { readonly [Field in keyof typeof PRODUCER_SLOTS]: string };

export interface DeclarationRun {
  bold: boolean;
  text: string;
}

export interface DeclarationBlock {
  kind: "title" | "paragraph" | "list";
  /** A paragraph or title is one line; a list has one line per item. */
  lines: DeclarationRun[][];
}

// `readSoftwareProducer` refuses only CR and LF. Unicode also ends a line at VT, FF, NEL, U+2028 and
// U+2029, so a reader that honours them would see a paragraph of the text broken in two.
const BREAK_OR_CONTROL = /[\p{Cc}\u2028\u2029]/u;

/** Each producer slot's value, once the source is known to hold no other slot. */
function producerValues(source: string, producer: DeclarationProducer): Map<string, string> {
  const fields = Object.keys(PRODUCER_SLOTS) as (keyof DeclarationProducer)[];
  for (const field of fields) {
    if (BREAK_OR_CONTROL.test(producer[field])) {
      throw new AppError("declaration.producer_invalid", { field });
    }
  }
  const values = new Map<string, string>(
    fields.map((field) => [PRODUCER_SLOTS[field], producer[field]]),
  );
  for (const [slot] of source.matchAll(SLOT)) {
    if (!values.has(slot)) throw new AppError("declaration.slot_unfilled", { slot });
  }
  return values;
}

function filled(text: string, values: Map<string, string>): string {
  // One pass: a producer's value is never read again as a slot.
  return text.replace(SLOT, (slot) => values.get(slot)!);
}

/**
 * The source with the producer's values written in as plain text, for reading items by their
 * text (`declarationItems`). Render through `declarationBlocks`, which never reads a value as markup.
 */
export function fillProducer(source: string, producer: DeclarationProducer): string {
  return filled(source, producerValues(source, producer));
}

/** The source's structure, read before the producer's values go into its runs as plain text. */
export function declarationBlocks(
  source: string,
  producer: DeclarationProducer,
): DeclarationBlock[] {
  const values = producerValues(source, producer);
  const runs = (line: string): DeclarationRun[] =>
    line
      .split("**")
      .map((text, index) => ({ bold: index % 2 === 1, text: filled(text, values) }))
      .filter((run) => run.text !== "");
  const lines = source.split("\n").filter((line) => !/^<!--.*-->$/.test(line.trim()));
  const blocks = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").filter((line) => line.trim() !== ""))
    .filter((block) => block.length > 0);
  return blocks.map((block, index): DeclarationBlock => {
    if (index === 0) return { kind: "title", lines: [runs(joined(block))] };
    if (
      block[0]!.startsWith("- ") &&
      block.every((line) => line.startsWith("- ") || line.startsWith("  "))
    ) {
      const items: string[][] = [];
      for (const line of block) {
        if (line.startsWith("- ")) items.push([line.slice(2)]);
        else items.at(-1)!.push(line);
      }
      return { kind: "list", lines: items.map((item) => runs(joined(item))) };
    }
    return { kind: "paragraph", lines: [runs(joined(block))] };
  });
}

function joined(lines: string[]): string {
  return lines.map((line) => line.trim()).join(" ");
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}

function plain(line: DeclarationRun[]): string {
  return line.map((run) => run.text).join("");
}

function html(line: DeclarationRun[]): string {
  return line
    .map((run) => (run.bold ? `<strong>${escapeHtml(run.text)}</strong>` : escapeHtml(run.text)))
    .join("");
}

export function renderDeclaration(
  source: string,
  producer: DeclarationProducer,
): { text: string; html: string } {
  const blocks = declarationBlocks(source, producer);
  const text = blocks
    .map((block) =>
      block.lines
        .map((line) => (block.kind === "list" ? `- ${plain(line)}` : plain(line)))
        .join("\n"),
    )
    .join("\n\n");
  const title = escapeHtml(
    blocks
      .filter((block) => block.kind === "title")
      .map((block) => plain(block.lines[0]!))
      .join(""),
  );
  const body = blocks.map((block) => {
    if (block.kind === "title") return `<h1>${title}</h1>`;
    if (block.kind === "list") {
      return `<ul>${block.lines.map((line) => `<li>${html(line)}</li>`).join("")}</ul>`;
    }
    return `<p>${html(block.lines[0]!)}</p>`;
  });
  return {
    text: `${text}\n`,
    html: [
      "<!DOCTYPE html>",
      '<html lang="es">',
      `<head><meta charset="utf-8"><title>${title}</title></head>`,
      "<body>",
      ...body,
      "</body>",
      "</html>",
      "",
    ].join("\n"),
  };
}
