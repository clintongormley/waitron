import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Proves a change touched comments and nothing else. It reads commits, never an uncommitted edit:
// every file changed between where HEAD left the base and HEAD must be a TypeScript or JavaScript
// file, present at both ends as a regular file with the same mode, that parses at both ends to the
// same syntax tree with the same token text, give or take the trailing comma Prettier adds or
// drops. Anything else fails. A comment counts as code only when it is the shebang or matches
// TOOL_COMMENT, a hand-written list, so a comment read by a tool the list does not name is dropped
// unseen; and a tool comment is placed by the tokens around it, not by its line. A line break
// counts only where it changes the tree, or before `=>` or `using`.
//
// The tree is compared rather than the scanner's token stream alone because a scanner without the
// parser cannot tell a regular expression or the tail of a template literal from code, so a `/*` in
// the one or a `//` in the other hides an edit after it; and because deleting a comment that holds a
// line break can change what `return` returns while leaving every token the same.

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const REGULAR_FILE = new Set(["100644", "100755"]);

// Anchored where the tool itself looks, so prose that names a directive mid-sentence stays prose.
const TOOL_COMMENT = [
  /^\/\/\s*eslint-/,
  /^\/\*[\s*]*(?:eslint|globals?|exported)\b/,
  /^\/[/*][\s*]*(?:prettier-ignore|Stryker\s+(?:disable|restore))/,
  /^\/[/*][\s*]*(?:v8|c8|istanbul|node:coverage)\s+ignore/,
  /^[\s/*]*@ts-/m,
  /^\/\/\/\s*<(?:reference|amd)/,
  /^\/[/*]!/,
  /@(?:vitest|jest)-|__PURE__|__NO_SIDE_EFFECTS__|@jsx|webpack[A-Z]|@vite-ignore/,
  /@license|@preserve|[#@]\s*source(?:Mapping)?URL=/,
];

// JavaScript forbids a line break before these, and TypeScript's parser builds the same tree
// either way.
const NO_LINE_BREAK_BEFORE = new Set([
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.UsingKeyword,
]);

// Types written as JSDoc are dropped too: no tsconfig here sets `checkJs` or `allowJs`, so no tool
// reads them.
function isJsDoc(node) {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

// A trailing comma after a rest parameter or element is a SyntaxError, so it is never Prettier's
// to drop. A spread counts too, since one can be a destructuring target; a tuple type's rest does
// not, because TypeScript accepts the comma there and Prettier writes it.
function isRest(node) {
  if (ts.isParameter(node) || ts.isBindingElement(node)) return node.dotDotDotToken !== undefined;
  return ts.isSpreadElement(node) || ts.isSpreadAssignment(node);
}

/**
 * The syntax tree as a flat list: `(Kind` and `)` around each inner node, each token's text, and
 * each tool comment before the token it precedes. The `key` tags which of those an entry is, so a
 * token spelled `)` or `(Kind` never matches the structure.
 */
function shape(text, fileName) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const entries = [];
  const push = (tag, entryText, start) =>
    entries.push({ key: tag + entryText, text: entryText, start, file });
  push("#", ts.getShebang(text) ?? "", 0);
  const visit = (node) => {
    const children = node.getChildren(file).filter((child) => !isJsDoc(child));
    const start = node.getStart(file);
    if (children.length === 0) {
      // `getStart` skips JSX text's leading whitespace, which JSX keeps unless it holds a line
      // break.
      if (node.kind === ts.SyntaxKind.JsxText) {
        push("t", text.slice(node.pos, node.end), node.pos);
        return;
      }
      const gap = text.slice(node.pos, start);
      for (const range of ts.getLeadingCommentRanges(gap, 0) ?? []) {
        const comment = gap.slice(range.pos, range.end);
        if (TOOL_COMMENT.some((pattern) => pattern.test(comment))) {
          push("d", comment, node.pos + range.pos);
        }
      }
      const lineBreak = NO_LINE_BREAK_BEFORE.has(node.kind) && /[\n\r\u2028\u2029]/.test(gap);
      push(lineBreak ? "t\n" : "t", node.getText(file), start);
      return;
    }
    // Prettier adds or drops a trailing comma when a list moves onto one line, which is what
    // deleting a comment inside it often lets happen. A hole (`[x,,]`) is an OmittedExpression
    // node, so it still shows.
    const last = children.at(-1);
    if (
      node.kind === ts.SyntaxKind.SyntaxList &&
      last.kind === ts.SyntaxKind.CommaToken &&
      !isRest(children.at(-2))
    ) {
      children.pop();
    }
    push("(", `(${ts.SyntaxKind[node.kind]}`, start);
    for (const child of children) visit(child);
    push(")", ")", node.getEnd());
  };
  visit(file);
  return entries;
}

/** `null` when only comments differ; otherwise the first difference, located in `head`. */
export function compareSources(base, head, fileName) {
  const before = shape(base, fileName);
  const after = shape(head, fileName);
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (before[i]?.key === after[i]?.key) continue;
    const { file, start } = after[Math.min(i, after.length - 1)];
    return {
      line: file.getLineAndCharacterOfPosition(start).line + 1,
      base: before[i]?.text,
      head: after[i]?.text,
    };
  }
  return null;
}

function git(args, { cwd, env }) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout;
}

const STATUS_REFUSALS = { A: "file added", D: "file deleted", T: "file type changed" };

function refusal(status, oldMode, newMode, file) {
  if (status !== "M") return STATUS_REFUSALS[status] ?? `unexpected status ${status}`;
  if (oldMode !== newMode) return `mode changed ${oldMode} → ${newMode}`;
  if (!REGULAR_FILE.has(newMode)) return `not a regular file (mode ${newMode})`;
  if (!CODE_FILE.test(file)) return "not a code file, so not compared";
  return null;
}

/**
 * Checks every file changed between where HEAD left `base` and HEAD. Renames are not followed, so
 * a moved file shows as deleted and added — a move is not a comment edit.
 */
export function checkCommentsOnly(base, options) {
  const from = git(["merge-base", base, "HEAD"], options).trim();
  const changes = git(["diff", "--raw", "--no-renames", "-z", from, "HEAD"], options)
    .split("\0")
    .filter(Boolean);
  const checked = [];
  for (let i = 0; i < changes.length; i += 2) {
    // `:<old mode> <new mode> <old blob> <new blob> <status>`, then the path.
    const [oldMode, newMode, , , status] = changes[i].slice(1).split(" ");
    const file = changes[i + 1];
    const reason = refusal(status, oldMode, newMode, file);
    if (reason !== null) return { checked, failure: { file, reason } };
    checked.push(file);
    const before = git(["show", `${from}:${file}`], options);
    const after = git(["show", `HEAD:${file}`], options);
    const difference = compareSources(before, after, file);
    if (difference !== null) {
      const { line, base: was, head: now } = difference;
      const reason = `line ${line}: code changed from ${JSON.stringify(was)} to ${JSON.stringify(now)}`;
      return { checked, failure: { file, reason } };
    }
  }
  return { checked, failure: null };
}

export function main(argv, { cwd, env, stdout, stderr }) {
  if (argv.length !== 1) {
    stderr("usage: node scripts/comments-only.mjs <base>");
    return 2;
  }
  let result;
  try {
    result = checkCommentsOnly(argv[0], { cwd, env });
  } catch (error) {
    stderr(`comments-only: ${error.message}`);
    return 2;
  }
  if (result.failure !== null) {
    stderr(`comments-only: ${result.failure.file}: ${result.failure.reason}`);
    return 1;
  }
  const count = result.checked.length;
  if (count === 0) stdout("comments-only: no files changed");
  else
    stdout(
      `comments-only: ${count} code file${count === 1 ? "" : "s"} compared; only comments changed`,
    );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: console.log,
    stderr: console.error,
  });
}
