import { isDeepStrictEqual } from "node:util";
import type { CaseTiming, MeasureResult } from "./measure.js";

/** How far after's median may move past before's spread of round medians and still be noise. */
const MARGIN = 0.1;

export type Verdict = "slower" | "faster" | "same";

export interface ComparisonRow {
  name: string;
  /** Before's round medians, lowest and highest. */
  before: { lowestMs: number; highestMs: number };
  /** The median of after's round medians. */
  afterMs: number;
  verdict: Verdict;
}

/** One row per case either result holds; a case only one of them holds has no verdict to give. */
export function compareTimings(before: MeasureResult, after: MeasureResult): ComparisonRow[] {
  for (const field of ["seed", "profile", "machine"] as const)
    if (!isDeepStrictEqual(before[field], after[field]))
      throw new Error(
        `bench: the two results differ in ${field}: ${JSON.stringify(before[field])} against ` +
          JSON.stringify(after[field]),
      );
  const afterCases = new Map(after.cases.map((entry) => [entry.name, entry]));
  const rows: ComparisonRow[] = [];
  for (const entry of before.cases) {
    const other = afterCases.get(entry.name);
    if (other === undefined) continue;
    const medians = roundMedians(entry);
    const lowestMs = Math.min(...medians);
    const highestMs = Math.max(...medians);
    const afterMs = median(roundMedians(other));
    const verdict: Verdict =
      afterMs > highestMs * (1 + MARGIN)
        ? "slower"
        : afterMs < lowestMs * (1 - MARGIN)
          ? "faster"
          : "same";
    rows.push({ name: entry.name, before: { lowestMs, highestMs }, afterMs, verdict });
  }
  return rows;
}

function roundMedians(entry: CaseTiming): number[] {
  return entry.rounds.map((round) => round.medianMs);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function formatComparison(rows: ComparisonRow[]): string {
  const ms = (value: number) => `${value.toFixed(2)} ms`;
  const table = [
    ["case", "before (round medians)", "after (median)", "verdict"],
    ...rows.map((row) => [
      row.name,
      `${ms(row.before.lowestMs)} to ${ms(row.before.highestMs)}`,
      ms(row.afterMs),
      row.verdict,
    ]),
  ];
  const widths = table[0]!.map((_, column) =>
    Math.max(...table.map((line) => line[column]!.length)),
  );
  return table
    .map((line) =>
      line
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
