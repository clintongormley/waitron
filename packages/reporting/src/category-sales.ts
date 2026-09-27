import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { centsToDecimal, decimalToCents, rawCentsToDecimal } from "@waitron/shared";
import type { Decimal, SaleLineClassification } from "@waitron/shared";
import {
  businessDayRangeWindow,
  issuedSalesClause,
  nodeScopeClause,
  reversedSalesClause,
  validateBusinessDayRange,
  validateCutover,
  validateTimeZone,
} from "./business-day.js";
import type { PeriodVatInput } from "./types.js";

/** "at_time_of_sale" reads each line's recorded snapshot; "current" classifies its product today. */
export type CategoryReportMode = "at_time_of_sale" | "current";

const MODES: readonly string[] = ["at_time_of_sale", "current"] satisfies CategoryReportMode[];

export interface CategorySalesInput extends PeriodVatInput {
  mode: CategoryReportMode;
  /** Count an extras line under its dish line's classification rather than its own. */
  extrasIntoDish?: boolean;
}

/**
 * Today's classification of each listed product. An id absent from the answer has no product
 * today, and its lines are reported as Not recorded.
 */
export type CurrentClassifier = (
  productIds: readonly string[],
) => Promise<ReadonlyMap<string, SaleLineClassification>>;

export interface CategoryTotal {
  kind: "category" | "uncategorised" | "not_recorded" | "free_text";
  /** The category id; "uncategorised"; "not_recorded"; for "free_text" the recorded text. */
  id: string;
  /** A category's name (recorded, or today's in current mode); a free-text node's text; "" for
   * uncategorised and not_recorded, which the screen names. */
  name: string;
  /** 0 at the root. */
  depth: number;
  /** This node including its children. Gross sums only the lines that recorded one. */
  gross: Decimal;
  net: Decimal;
  /** The lines whose own chain ends at this node, counted in rows (a reversed row counts too). */
  direct: { gross: Decimal; net: Decimal; lines: number };
  children: CategoryTotal[];
}

/** One label's lines. Label totals overlap each other and cut across the tree. */
export interface LabelTotal {
  id: string;
  name: string;
  gross: Decimal;
  net: Decimal;
}

export interface CategoryReport {
  mode: CategoryReportMode;
  tree: CategoryTotal[];
  labels: LabelTotal[];
  gross: Decimal;
  net: Decimal;
  /** False when any counted line, issued or reversed, recorded no gross. */
  grossComplete: boolean;
  linesWithoutGross: number;
}

type LineRow = {
  sale_id: string;
  issued_at: string;
  line_no: number;
  net: string;
  gross: string | null;
  parent_line_id: string | null;
  product_id: string | null;
  category: string | null;
  classification: string | null;
  dish_product_id: string | null;
  dish_category: string | null;
  dish_classification: string | null;
};

/** Which of two lines was issued later: by the original sale's issue time, then sale id, then
 * line number. A node takes its name from the latest line through it. */
interface Rank {
  issuedAt: string;
  saleId: string;
  lineNo: number;
}

function isLater(a: Rank, b: Rank): boolean {
  if (a.issuedAt !== b.issuedAt) return a.issuedAt > b.issuedAt;
  if (a.saleId !== b.saleId) return a.saleId > b.saleId;
  return a.lineNo > b.lineNo;
}

interface Segment {
  kind: CategoryTotal["kind"];
  id: string;
  name: string;
}

interface Tally {
  name: string;
  rank: Rank;
  netCents: number;
  grossCents: number;
}

interface Node extends Tally {
  kind: CategoryTotal["kind"];
  id: string;
  directNetCents: number;
  directGrossCents: number;
  directLines: number;
  children: Map<string, Node>;
}

const UNCATEGORISED: Segment = { kind: "uncategorised", id: "uncategorised", name: "" };
const NOT_RECORDED: Segment = { kind: "not_recorded", id: "not_recorded", name: "" };

/** The path a line is counted along, root first. */
function pathOf(
  classification: SaleLineClassification | null | undefined,
  freeText: string | null,
): Segment[] {
  if (classification == null) {
    return freeText
      ? [NOT_RECORDED, { kind: "free_text", id: freeText, name: freeText }]
      : [NOT_RECORDED];
  }
  if (classification.reporting.length === 0) return [UNCATEGORISED];
  return classification.reporting.map((entry) => ({ kind: "category", ...entry }));
}

function cents(raw: string): number {
  return decimalToCents(rawCentsToDecimal(raw));
}

/** Adds a line's net and gross to a tally, and takes its name when it is the latest seen. */
function tally(target: Tally, name: string, rank: Rank, net: number, gross: number | null): void {
  target.netCents += net;
  target.grossCents += gross ?? 0;
  if (isLater(rank, target.rank)) {
    target.name = name;
    target.rank = rank;
  }
}

const KIND_ORDER: Record<CategoryTotal["kind"], number> = {
  category: 0,
  free_text: 0,
  uncategorised: 1,
  not_recorded: 2,
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byReportOrder(
  a: { kind?: CategoryTotal["kind"]; name: string; id: string },
  b: { kind?: CategoryTotal["kind"]; name: string; id: string },
): number {
  return (
    KIND_ORDER[a.kind ?? "category"] - KIND_ORDER[b.kind ?? "category"] ||
    compareText(a.name, b.name) ||
    compareText(a.id, b.id)
  );
}

function toTotal(node: Node, depth: number): CategoryTotal {
  return {
    kind: node.kind,
    id: node.id,
    name: node.name,
    depth,
    gross: centsToDecimal(node.grossCents),
    net: centsToDecimal(node.netCents),
    direct: {
      gross: centsToDecimal(node.directGrossCents),
      net: centsToDecimal(node.directNetCents),
      lines: node.directLines,
    },
    children: [...node.children.values()]
      .sort(byReportOrder)
      .map((child) => toTotal(child, depth + 1)),
  };
}

/**
 * Sales by reporting category over a closed business-day range, in one of two modes (spec
 * `2026-09-25-sales-classification-and-category-reports-design.md` §5). A line's amount is added at
 * every node of its path, and a node is keyed by the whole path from the root, never by its own id
 * alone: a category moved in the period appears under each parent it had.
 *
 * Inclusion is the other reports' (`issuedSalesClause`, `reversedSalesClause`): a void in the range
 * of a sale issued outside it subtracts, at time of sale under the voided line's own recorded
 * snapshot, and corrections net in with their signed lines. Every amount is summed in whole cents.
 *
 * Invalid inputs, and current mode without a classifier, are a caller precondition and throw a
 * plain `Error` before any query runs.
 */
export async function computeCategorySales(
  tx: Transaction,
  input: CategorySalesInput,
  classifyCurrent?: CurrentClassifier,
): Promise<CategoryReport> {
  validateTimeZone(input.timeZone);
  validateCutover(input.dayCutover);
  validateBusinessDayRange(input);
  if (!MODES.includes(input.mode)) {
    throw new Error(`reporting: unknown category report mode: ${JSON.stringify(input.mode)}`);
  }
  if (input.mode === "current" && classifyCurrent === undefined) {
    throw new Error("reporting: a current-categories report needs a classifier");
  }
  const nodeClause = nodeScopeClause(input.nodeId);
  const window = businessDayRangeWindow(input);
  const { rows } = await tx.execute<LineRow>(sql`
    select s.id as sale_id, s.issued_at, sl.line_no,
      cast(sl.line_total as text) as net, cast(sl.line_gross as text) as gross,
      sl.parent_line_id, sl.product_id, sl.category, sl.classification,
      dl.product_id as dish_product_id, dl.category as dish_category,
      dl.classification as dish_classification
    from sale_lines sl
    join sales s on s.id = sl.sale_id
    left join sale_lines dl on dl.id = sl.parent_line_id
    where ${issuedSalesClause(window)}
      ${nodeClause}
    union all
    select s.id, s.issued_at, sl.line_no,
      cast(-sl.line_total as text), cast(-sl.line_gross as text),
      sl.parent_line_id, sl.product_id, sl.category, sl.classification,
      dl.product_id, dl.category, dl.classification
    from sale_voids sv
    join sales s on s.id = sv.sale_id
    join sale_lines sl on sl.sale_id = s.id
    left join sale_lines dl on dl.id = sl.parent_line_id
    where ${reversedSalesClause(window)}
      ${nodeClause}
  `);

  const lines = rows.map((row) => {
    const own = !(input.extrasIntoDish && row.parent_line_id !== null);
    return {
      row,
      productId: own ? row.product_id : row.dish_product_id,
      freeText: own ? row.category : row.dish_category,
      recorded: own ? row.classification : row.dish_classification,
    };
  });

  let today: ReadonlyMap<string, SaleLineClassification> | undefined;
  if (input.mode === "current") {
    const productIds = new Set<string>();
    for (const line of lines) if (line.productId !== null) productIds.add(line.productId);
    today = await classifyCurrent!([...productIds]);
  }

  const roots = new Map<string, Node>();
  const labels = new Map<string, Tally & { id: string }>();
  let linesWithoutGross = 0;
  let netCents = 0;
  let grossCents = 0;
  for (const { row, productId, freeText, recorded } of lines) {
    const classification =
      today === undefined
        ? (JSON.parse(recorded ?? "null") as SaleLineClassification | null)
        : productId === null
          ? null
          : today.get(productId);
    const path = pathOf(classification, today === undefined ? freeText : null);
    const rank: Rank = { issuedAt: row.issued_at, saleId: row.sale_id, lineNo: row.line_no };
    const net = cents(row.net);
    const gross = row.gross === null ? null : cents(row.gross);
    if (gross === null) linesWithoutGross += 1;
    netCents += net;
    grossCents += gross ?? 0;

    let level = roots;
    let node: Node | undefined;
    for (const segment of path) {
      const key = `${segment.kind}:${segment.id}`;
      node = level.get(key);
      if (node === undefined) {
        node = {
          ...segment,
          rank,
          netCents: 0,
          grossCents: 0,
          directNetCents: 0,
          directGrossCents: 0,
          directLines: 0,
          children: new Map(),
        };
        level.set(key, node);
      }
      tally(node, segment.name, rank, net, gross);
      level = node.children;
    }
    node!.directNetCents += net;
    node!.directGrossCents += gross ?? 0;
    node!.directLines += 1;

    for (const label of classification?.labels ?? []) {
      let total = labels.get(label.id);
      if (total === undefined) {
        total = { id: label.id, name: label.name, rank, netCents: 0, grossCents: 0 };
        labels.set(label.id, total);
      }
      tally(total, label.name, rank, net, gross);
    }
  }

  return {
    mode: input.mode,
    tree: [...roots.values()].sort(byReportOrder).map((root) => toTotal(root, 0)),
    labels: [...labels.values()].sort(byReportOrder).map((label) => ({
      id: label.id,
      name: label.name,
      gross: centsToDecimal(label.grossCents),
      net: centsToDecimal(label.netCents),
    })),
    gross: centsToDecimal(grossCents),
    net: centsToDecimal(netCents),
    grossComplete: linesWithoutGross === 0,
    linesWithoutGross,
  };
}
