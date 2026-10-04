import type { Database } from "@waitron/db";
import type { SaleId, SaleLineClassification } from "@waitron/shared";
import type { CategoryTotal } from "../src/category-sales.js";
import { seedSale } from "./fixtures.js";
import type { SeededVenue } from "./fixtures.js";

export const TZ = "Europe/Madrid";
export const CUTOVER = "05:00";

/** `utcTime` UTC on `day`; by default noon in Madrid (UTC+2 in August), well inside that business day. */
export function at(day: string, utcTime = "10:00"): string {
  return new Date(`${day}T${utcTime}:00Z`).toISOString();
}

/** A recorded chain, root first, from `[id, name]` pairs. */
export function chain(...entries: [string, string][]): SaleLineClassification["reporting"] {
  return entries.map(([id, name]) => ({ id, name }));
}

export function classified(reporting: SaleLineClassification["reporting"]): SaleLineClassification {
  return { reporting };
}

export interface LineSpec {
  net: string;
  /** Absent: the line recorded no gross, as a line filed before classification did. */
  gross?: string;
  /** Absent: the line recorded no classification. */
  cls?: SaleLineClassification;
  productId?: string;
  category?: string;
  id?: string;
  parentLineId?: string;
  quantity?: string;
}

let invoiceNumber = 0;

/**
 * One sale of `lines`. Every line's staff name and customer-facing text differ, so a report that
 * read either as a category would fail rather than pass by coincidence.
 */
export function sellLines(
  db: Database,
  venue: Pick<SeededVenue, "deviceId" | "nodeId" | "seriesId">,
  issuedAt: string,
  lines: LineSpec[],
  correctsSaleId?: SaleId,
): Promise<SaleId> {
  return seedSale(db, venue, {
    invoiceNumber: ++invoiceNumber,
    issuedAt,
    total: "0.00",
    correctsSaleId,
    lines: lines.map((l) => ({
      vatRate: "10.00",
      lineTotal: l.net,
      name: "House negroni",
      descriptions: { es: "Negroni de la casa" },
      quantity: l.quantity,
      lineGross: l.gross,
      classification: l.cls,
      productId: l.productId,
      category: l.category,
      id: l.id,
      parentLineId: l.parentLineId,
    })),
  });
}

export interface Row {
  path: string;
  id: string;
  depth: number;
  gross: string;
  net: string;
  /** `gross/net/lines` of the rows whose own chain ends at this node. */
  direct: string;
}

/**
 * The tree flattened depth-first in its own order, each node named by the path of names above it.
 * A node that is not a category shows its kind in brackets, since the screen names those.
 */
export function rows(tree: CategoryTotal[], above: string[] = []): Row[] {
  return tree.flatMap((node) => {
    const path = [
      ...above,
      node.kind === "category" || node.kind === "free_text" ? node.name : `(${node.kind})`,
    ];
    return [
      {
        path: path.join(" > "),
        id: node.id,
        depth: node.depth,
        gross: node.gross,
        net: node.net,
        direct: `${node.direct.gross}/${node.direct.net}/${node.direct.lines}`,
      },
      ...rows(node.children, path),
    ];
  });
}
