import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildYear } from "./build-year.js";
import { BENCH_PROFILE } from "./profile.js";

const USAGE =
  "Usage: build --out <absolute dir> [--days 360] [--bills-per-day 250] [--seed 1]\n" +
  "  A stopped build resumes from its last finished day when run again with the same --out.";

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

export async function runCli(argv: readonly string[], print: (text: string) => void) {
  const [command, ...rest] = argv;
  if (command !== "build") throw new Error(USAGE);
  const found = flags(rest, ["--out", "--days", "--bills-per-day", "--seed"]);
  const out = found.get("--out");
  if (out === undefined) throw new Error(USAGE);
  if (!isAbsolute(out)) throw new Error(`--out must be an absolute path: ${out}`);
  const outside = (from: string, to: string) => {
    const path = relative(from, to);
    return path.startsWith("..") || isAbsolute(path);
  };
  const refuse = () => new Error(`--out must be outside the repository: ${out}`);
  if (!outside(REPOSITORY, resolve(out))) throw refuse();
  mkdirSync(out, { recursive: true });
  if (!outside(realpathSync(REPOSITORY), realpathSync(out))) throw refuse();
  const days = wholeNumber(found, "--days", BENCH_PROFILE.days);
  const billsPerDay = wholeNumber(found, "--bills-per-day", BENCH_PROFILE.billsPerDay);
  const seed = wholeNumber(found, "--seed", 1);
  await buildYear({
    out,
    days,
    billsPerDay,
    seed,
    onDay: (day, result, ms) =>
      print(
        `day ${day}/${days} ${result.day}: ${result.bills.length} bills in ` +
          `${(ms / 1000).toFixed(1)} s, ${(ms / 1000 / result.bills.length).toFixed(3)} s a bill`,
      ),
  });
  print(`built ${days} days into ${out}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), (text) => console.log(text)).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
