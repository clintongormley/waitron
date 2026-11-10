import { isDeepStrictEqual } from "node:util";
import type { MeasureResult } from "./measure.js";

/** How far after's median may move past before's spread of round medians and still be noise. */
const MARGIN = 0.1;

const RUNTIME_FIELDS = ["node", "sqlite", "sqliteStat4"] as const;

export type Verdict = "slower" | "faster" | "same";

export interface ComparisonRow {
  name: string;
  /** Before's round medians, lowest and highest. */
  before: { lowestMs: number; highestMs: number };
  /** The median of after's round medians. */
  afterMs: number;
  verdict: Verdict;
}

export interface Comparison {
  /** One row per case both results hold, in before's order. */
  rows: ComparisonRow[];
  onlyBefore: string[];
  onlyAfter: string[];
}

export function compareTimings(before: MeasureResult, after: MeasureResult): Comparison {
  for (const [side, result] of [
    ["before", before],
    ["after", after],
  ] as const)
    if (RUNTIME_FIELDS.some((field) => result[field] === undefined))
      throw new Error(`bench: the ${side} result does not record which Node and SQLite made it`);
  for (const field of [...RUNTIME_FIELDS, "seed", "profile", "machine"] as const)
    if (!isDeepStrictEqual(before[field], after[field]))
      throw new Error(
        `bench: the two results differ in ${field}: ${JSON.stringify(before[field])} against ` +
          JSON.stringify(after[field]),
      );
  const beforeMedians = roundMediansByCase(before, "before");
  const afterMedians = roundMediansByCase(after, "after");
  const rows: ComparisonRow[] = [];
  for (const [name, medians] of beforeMedians) {
    const other = afterMedians.get(name);
    if (other === undefined) continue;
    const lowestMs = Math.min(...medians);
    const highestMs = Math.max(...medians);
    const afterMs = median(other);
    const verdict: Verdict =
      afterMs > highestMs * (1 + MARGIN)
        ? "slower"
        : afterMs < lowestMs * (1 - MARGIN)
          ? "faster"
          : "same";
    rows.push({ name, before: { lowestMs, highestMs }, afterMs, verdict });
  }
  return {
    rows,
    onlyBefore: [...beforeMedians.keys()].filter((name) => !afterMedians.has(name)),
    onlyAfter: [...afterMedians.keys()].filter((name) => !beforeMedians.has(name)),
  };
}

/** Refuses a case with no rounds, or a median JSON wrote as `null`, rather than call it `same`. */
function roundMediansByCase(result: MeasureResult, side: string): Map<string, number[]> {
  const byCase = new Map<string, number[]>();
  for (const entry of result.cases) {
    if (entry.rounds.length === 0) throw new Error(`bench: ${entry.name} has no rounds in ${side}`);
    const medians = entry.rounds.map((round) => round.medianMs as unknown);
    const bad = medians.findIndex((value) => typeof value !== "number" || !Number.isFinite(value));
    if (bad !== -1)
      throw new Error(
        `bench: ${entry.name} has a round median that is not a number in ${side}: ` +
          String(medians[bad]),
      );
    byCase.set(entry.name, medians as number[]);
  }
  return byCase;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function formatComparison({ rows, onlyBefore, onlyAfter }: Comparison): string {
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
  const lines = table.map((line) =>
    line
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join("  ")
      .trimEnd(),
  );
  if (onlyBefore.length > 0) lines.push(`only in before: ${onlyBefore.join(", ")}`);
  if (onlyAfter.length > 0) lines.push(`only in after: ${onlyAfter.join(", ")}`);
  return lines.join("\n");
}
