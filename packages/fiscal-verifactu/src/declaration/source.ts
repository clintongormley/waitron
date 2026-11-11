import "../errors.js";
import { AppError } from "@waitron/shared";
import type { SiNo } from "@waitron/verifactu";
import { SOFTWARE_IDENTITY } from "../software-identity.js";

export interface PrepareInput {
  template: string;
  functions: string;
  version: string;
  libraryVersion: string;
  /** `YYYY-MM-DD`, already the Europe/Madrid day of signing. */
  date: string;
  place: string;
}

/** Filled by the renderer from the producer's settings, so a committed version leaves them. */
export const PRODUCER_SLOTS = {
  name: "‹nombre y apellidos›",
  taxId: "‹NIF›",
  address: "‹dirección›",
} as const;

const PRODUCER_SLOT_SET: ReadonlySet<string> = new Set(Object.values(PRODUCER_SLOTS));

export const SLOT = /‹[^›\n]*›/g;

export const SI_NO: Record<SiNo, string> = { S: "S - Sí", N: "N - No" };

export function prepareDeclarationSource(input: PrepareInput): string {
  const values: Record<string, string> = {
    "‹nombre del sistema›": SOFTWARE_IDENTITY.name,
    "‹código del sistema›": SOFTWARE_IDENTITY.code,
    "‹versión›": input.version,
    "‹versión de @waitron/verifactu›": input.libraryVersion,
    "‹solo VERI*FACTU›": SI_NO[SOFTWARE_IDENTITY.onlyVerifactu],
    "‹varios obligados›": SI_NO[SOFTWARE_IDENTITY.multipleTaxpayersPossible],
    "‹funcionalidades›": new Intl.ListFormat("es", { type: "conjunction" }).format(
      parseFunctions(input.functions),
    ),
    "‹fecha›": spanishDate(input.date),
    "‹lugar›": input.place,
  };
  // One pass: a filled value (a place, say) is never read again as a slot.
  return input.template.replace(SLOT, (slot) => {
    if (PRODUCER_SLOT_SET.has(slot)) return slot;
    const value = values[slot];
    if (value === undefined) throw new AppError("declaration.slot_unfilled", { slot });
    return value;
  });
}

export function parseFunctions(markdown: string): string[] {
  const functions: string[] = [];
  markdown.split("\n").forEach((line, index) => {
    if (!line.startsWith("- ")) return;
    const separator = line.indexOf(" — ");
    if (separator === -1) {
      throw new AppError("declaration.functions_malformed", { line: index + 1 });
    }
    functions.push(line.slice(2, separator).trim());
  });
  return functions;
}

export function releaseBlockers(source: string): string[] {
  return [...source.matchAll(/^<!-- release-blocker: (.*?) -->$/gm)].map((match) => match[1]!);
}

/** Each `**<n>.<x>) …**` paragraph's text after its closing `**`, keyed `"<n>.<x>"`. */
export function declarationItems(source: string): ReadonlyMap<string, string> {
  const items = new Map<string, string>();
  for (const paragraph of source.split(/\n\s*\n/)) {
    const match = /^\*\*(\d+\.[a-z])\)[\s\S]*?\*\*([\s\S]*)$/.exec(paragraph.trim());
    if (match) items.set(match[1]!, match[2]!.replace(/\s+/g, " ").trim());
  }
  return items;
}

export function spanishDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  // `Date` moves an impossible day (2026-02-30) on into the next month rather than refusing it.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new AppError("declaration.date_invalid", { date: isoDate });
  }
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
