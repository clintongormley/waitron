import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SPANISH_WORDS,
  englishFileProblems,
  isHome,
  readText,
} from "../packages/db/src/english-only.js";
import { FISCAL_VOCABULARY } from "../packages/fiscal-verifactu/src/vocabulary.js";
import { WORKFORCE_ES_VOCABULARY } from "../packages/workforce-es/src/vocabulary.js";
import { STILL_TO_CLEAN } from "./english-only-still-to-clean.js";
import { isMainScript } from "./is-main-script.mjs";

// CI compares this set against the module descriptors because the hook only needs their words.
export const PRE_PUSH_WORDS = new Set([
  ...SPANISH_WORDS,
  ...FISCAL_VOCABULARY,
  ...WORKFORCE_ES_VOCABULARY,
]);

if (isMainScript(import.meta.url)) {
  const [, , root, ...args] = process.argv;
  if (!root) throw new Error("Pass the repository root followed by repository-relative paths.");

  const paths = args.length > 0 ? args : readFileSync(0, "utf8").split("\n");
  const stillToClean = new Set(STILL_TO_CLEAN);
  for (const path of [...new Set(paths)].sort()) {
    if (!/^(apps|packages)\//.test(path) || isHome(path)) continue;
    const absolute = join(root, path);
    if (!lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) continue;
    const source = readText(absolute);
    if (source === undefined) continue;

    const problems = englishFileProblems(path, source, PRE_PUSH_WORDS, stillToClean.has(path));
    if (problems.length === 0) continue;
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
