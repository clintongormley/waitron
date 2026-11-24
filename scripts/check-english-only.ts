import { join } from "node:path";
import {
  SPANISH_WORDS,
  englishFileProblems,
  isHome,
  readText,
} from "../packages/db/src/english-only.js";
import { forbiddenVocabulary } from "../packages/module/src/vocabulary.js";
import { STILL_TO_CLEAN } from "./english-only-still-to-clean.js";

const [, , root, ...paths] = process.argv;
if (!root) throw new Error("Pass the repository root followed by repository-relative paths.");

const files = new Map<string, string>();
for (const path of paths) {
  if (!/^(apps|packages)\//.test(path) || isHome(path)) continue;
  const source = readText(join(root, path));
  if (source !== undefined) files.set(path, source);
}

if (files.size > 0) {
  const { ALL_MODULES } = await import("../packages/composition/src/index.js");
  const words = forbiddenVocabulary(SPANISH_WORDS, ALL_MODULES);
  const stillToClean = new Set(STILL_TO_CLEAN);
  for (const [path, source] of files) {
    const problems = englishFileProblems(path, source, words, stillToClean.has(path));
    if (problems.length === 0) continue;
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
