import "../errors.js";
import { AppError } from "@waitron/shared";

export interface DeclarationProducer {
  readonly name: string;
  readonly taxId: string;
  readonly address: string;
}

export interface DeclarationRun {
  bold: boolean;
  text: string;
}

export interface DeclarationBlock {
  kind: "title" | "paragraph" | "list";
  /** A paragraph or title is one line; a list has one line per item. */
  lines: DeclarationRun[][];
}

const SLOT = /‹[^›\n]*›/g;

export function fillProducer(source: string, producer: DeclarationProducer): string {
  const values: Record<string, string> = {
    "‹nombre y apellidos›": producer.name,
    "‹NIF›": producer.taxId,
    "‹dirección›": producer.address,
  };
  for (const [slot] of source.matchAll(SLOT)) {
    if (values[slot] === undefined) throw new AppError("declaration.slot_unfilled", { slot });
  }
  // One pass: a producer's value is never read again as a slot.
  return source.replace(SLOT, (slot) => values[slot]!);
}

function runs(line: string): DeclarationRun[] {
  return line
    .split("**")
    .map((text, index) => ({ bold: index % 2 === 1, text }))
    .filter((run) => run.text !== "");
}

export function declarationBlocks(filled: string): DeclarationBlock[] {
  const lines = filled.split("\n").filter((line) => !/^<!--.*-->$/.test(line.trim()));
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
  const blocks = declarationBlocks(fillProducer(source, producer));
  const text = blocks
    .map((block) =>
      block.lines
        .map((line) => (block.kind === "list" ? `- ${plain(line)}` : plain(line)))
        .join("\n"),
    )
    .join("\n\n");
  const title = escapeHtml(plain(blocks[0]?.lines[0] ?? []));
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
