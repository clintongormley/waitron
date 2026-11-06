// The A760 baseline tools: rewrite a generated baseline to the old schema's text, prove the
// comparison catches changes, and check the shipped migration copies.
//
// Usage: pnpm --filter @waitron/server migration-baseline preserve --reference <absolute dir> --set <name> --from <old-set,...>
//        pnpm --filter @waitron/server migration-baseline controls --reference <absolute dir> --out <absolute dir>
//        pnpm --filter @waitron/server migration-baseline copies --dist <absolute dir> --image-root <absolute dir> --report <absolute file>
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatOutcomes, runControls } from "./controls.js";
import { checkCopies, formatCopies, manifestCopySets } from "./copies.js";
import { preserveBaseline } from "./preserve.js";

const USAGE =
  "Usage: preserve --reference <absolute dir> --set <name> --from <old-set,...>\n" +
  "       controls --reference <absolute dir> --out <absolute dir>\n" +
  "       copies --dist <absolute dir> --image-root <absolute dir> --report <absolute file>";

function flags(args: readonly string[], allowed: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] ?? "";
    const value = args[index + 1];
    if (!allowed.includes(name) || value === undefined || found.has(name)) {
      throw new Error(USAGE);
    }
    found.set(name, value);
  }
  for (const name of allowed) if (!found.has(name)) throw new Error(USAGE);
  return found;
}

function path(found: Map<string, string>, name: string): string {
  const value = found.get(name) as string;
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path: ${value}`);
  return value;
}

function preserve(args: readonly string[], print: (text: string) => void): number {
  const found = flags(args, ["--reference", "--set", "--from"]);
  const reference = path(found, "--reference");
  const name = found.get("--set") as string;
  const set = manifestCopySets().find((candidate) => candidate.name === name);
  if (set === undefined) throw new Error(`The manifest has no set named ${name}`);
  const from = (found.get("--from") as string).split(",").filter((part) => part !== "");
  const result = preserveBaseline({ reference, folder: set.folder, from });
  print([...result.provenance, result.changed ? "rewrote the baseline" : "unchanged"].join("\n"));
  return 0;
}

function controls(args: readonly string[], print: (text: string) => void): number {
  const found = flags(args, ["--reference", "--out"]);
  const reference = path(found, "--reference");
  const out = path(found, "--out");
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  mkdirSync(out, { recursive: true });
  const outcomes = runControls({ reference, out });
  const report = formatOutcomes(outcomes);
  writeFileSync(join(out, "controls.txt"), `${report}\n`);
  print(report);
  return outcomes.every((outcome) => outcome.passed) ? 0 : 1;
}

function copies(args: readonly string[], print: (text: string) => void): number {
  const found = flags(args, ["--dist", "--image-root", "--report"]);
  const roots = [
    { label: "dist", dir: path(found, "--dist") },
    { label: "image", dir: path(found, "--image-root") },
  ];
  const report = path(found, "--report");
  const sets = manifestCopySets();
  const result = checkCopies(sets, roots);
  const text = formatCopies(result, sets, roots);
  writeFileSync(report, `${text}\n`);
  print(text);
  return result.differences.length === 0 ? 0 : 1;
}

/** Answers the process exit status; a refusal throws. */
export async function runCli(
  argv: readonly string[],
  print: (text: string) => void,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "preserve") return preserve(rest, print);
  if (command === "controls") return controls(rest, print);
  if (command === "copies") return copies(rest, print);
  throw new Error(USAGE);
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  runCli(process.argv.slice(2), (text) => console.log(text)).then(
    (status) => {
      process.exitCode = status;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 2;
    },
  );
}
