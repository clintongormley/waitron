import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildYear } from "./build-year.js";
import { compareTimings, formatComparison } from "./compare-timings.js";
import { measureVenue, type MeasureResult } from "./measure.js";
import { BENCH_PROFILE } from "./profile.js";
import { describeRuntime } from "./runtime.js";

const USAGE =
  "Usage: build --out <absolute dir> [--days 360] [--bills-per-day 250] [--seed 1]\n" +
  "  A stopped build resumes from its last finished day when run again with the same --out.\n" +
  "       measure --venue <built dir> --out <absolute file> [--samples 200] [--rounds 3]\n" +
  "       compare --before <file> --after <file>";

const REPOSITORY = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

function flags(args: readonly string[], allowed: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] ?? "";
    const value = args[index + 1];
    if (!allowed.includes(name) || value === undefined || found.has(name)) throw new Error(USAGE);
    found.set(name, value);
  }
  return found;
}

function wholeNumber(found: Map<string, string>, name: string, fallback: number): number {
  const value = found.get(name);
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(`${name} must be a whole number above 0: ${value}`);
  return Number(value);
}

/** An absolute path outside the repository, checked again on the real path once `exists` does. */
function outsideRepository(name: string, path: string | undefined, exists: string): string {
  if (path === undefined) throw new Error(USAGE);
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path: ${path}`);
  const outside = (from: string, to: string) => {
    const rel = relative(from, to);
    return rel.startsWith("..") || isAbsolute(rel);
  };
  const refuse = () => new Error(`${name} must be outside the repository: ${path}`);
  if (!outside(REPOSITORY, resolve(path))) throw refuse();
  mkdirSync(exists, { recursive: true });
  if (!outside(realpathSync(REPOSITORY), realpathSync(exists))) throw refuse();
  return path;
}

export async function runCli(argv: readonly string[], print: (text: string) => void) {
  const [command, ...rest] = argv;
  if (command === "measure") return measure(rest, print);
  if (command === "compare") return compare(rest, print);
  if (command !== "build") throw new Error(USAGE);
  const found = flags(rest, ["--out", "--days", "--bills-per-day", "--seed"]);
  const out = found.get("--out");
  outsideRepository("--out", out, out ?? "");
  const days = wholeNumber(found, "--days", BENCH_PROFILE.days);
  const billsPerDay = wholeNumber(found, "--bills-per-day", BENCH_PROFILE.billsPerDay);
  const seed = wholeNumber(found, "--seed", 1);
  await buildYear({
    out: out!,
    days,
    billsPerDay,
    seed,
    onDay: (day, result, ms) => {
      print(
        `day ${day}/${days} ${result.day}: ${result.bills.length} bills in ` +
          `${(ms / 1000).toFixed(1)} s, ${(ms / 1000 / result.bills.length).toFixed(3)} s a bill`,
      );
      print(
        `  ${Object.entries(result.requestTimings)
          .sort(([, a], [, b]) => b.totalMs - a.totalMs)
          .map(([name, route]) => `${name} ${route.count} x ${route.medianMs.toFixed(1)} ms`)
          .join("; ")}`,
      );
    },
  });
  print(`built ${days} days into ${out}`);
}

async function measure(args: readonly string[], print: (text: string) => void) {
  const found = flags(args, ["--venue", "--out", "--samples", "--rounds"]);
  const venue = found.get("--venue");
  outsideRepository("--venue", venue, venue ?? "");
  const out = found.get("--out");
  outsideRepository("--out", out, dirname(out ?? ""));
  const result = await measureVenue({
    venue: venue!,
    out: out!,
    samples: wholeNumber(found, "--samples", 200),
    rounds: wholeNumber(found, "--rounds", 3),
  });
  print(describeRuntime(result));
  for (const entry of result.cases)
    print(
      `${entry.name}: ` +
        entry.rounds.map((round) => `${round.medianMs.toFixed(2)} ms`).join(", ") +
        " (median of each round)",
    );
  print(`wrote ${out}`);
}

/** Reports only: a slower case is for a person to read, so this answers success whatever it finds. */
function compare(args: readonly string[], print: (text: string) => void) {
  const found = flags(args, ["--before", "--after"]);
  const read = (name: string) => {
    const path = found.get(name);
    if (path === undefined) throw new Error(USAGE);
    return JSON.parse(readFileSync(path, "utf8")) as MeasureResult;
  };
  const before = read("--before");
  const after = read("--after");
  try {
    const compared = compareTimings(before, after);
    print(describeRuntime(before));
    print(formatComparison(compared));
  } catch (error) {
    print(`not compared: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isMainScript(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainScript()) {
  runCli(process.argv.slice(2), (text) => console.log(text)).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}
