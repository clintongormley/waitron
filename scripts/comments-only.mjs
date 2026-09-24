import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Proves a change touched comments and nothing else: every changed code file must parse, at the
// base and at HEAD, to the same syntax tree with the same token text.
//
// The tree is compared rather than the scanner's token stream alone because a scanner without the
// parser cannot tell a regular expression or the tail of a template literal from code, so a `/*` in
// the one or a `//` in the other hides an edit after it; and because deleting a comment that holds a
// line break can change what `return` returns while leaving every token the same.

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

function isJsDoc(node) {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/** The syntax tree as a flat list: `(Kind` and `)` around each inner node, and each token's text. */
function shape(text, fileName) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const entries = [];
  const visit = (node) => {
    const children = node.getChildren(file).filter((child) => !isJsDoc(child));
    const start = node.getStart(file);
    if (children.length === 0) {
      entries.push({ text: node.getText(file), start, file });
      return;
    }
    // Prettier adds or drops a trailing comma when a list moves onto one line, which is what
    // deleting a comment inside it often lets happen. A hole (`[x,,]`) is an OmittedExpression
    // node, so it still shows.
    const last = children.at(-1);
    if (node.kind === ts.SyntaxKind.SyntaxList && last.kind === ts.SyntaxKind.CommaToken) {
      children.pop();
    }
    entries.push({ text: `(${ts.SyntaxKind[node.kind]}`, start, file });
    for (const child of children) visit(child);
    entries.push({ text: ")", start: node.getEnd(), file });
  };
  visit(file);
  return entries;
}

/** `null` when only comments differ; otherwise the first difference, located in `head`. */
export function compareSources(base, head, fileName) {
  const before = shape(base, fileName);
  const after = shape(head, fileName);
  // Each list is one whole tree, closed by the source file's `)`, so neither can be a proper prefix
  // of the other: a difference is always found at an index both lists hold.
  for (let i = 0; i < before.length; i++) {
    if (before[i].text === after[i].text) continue;
    const { file, start } = after[i];
    return {
      line: file.getLineAndCharacterOfPosition(start).line + 1,
      base: before[i].text,
      head: after[i].text,
    };
  }
  return null;
}

function git(args, { cwd, env }) {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout;
}

/**
 * Compares every code file changed between where HEAD left `base` and HEAD. Renames are not
 * followed, so a moved file shows as deleted and added — a move is not a comment edit.
 */
export function checkCommentsOnly(base, options) {
  const from = git(["merge-base", base, "HEAD"], options).trim();
  const changes = git(["diff", "--name-status", "--no-renames", "-z", from, "HEAD"], options)
    .split("\0")
    .filter(Boolean);
  const checked = [];
  for (let i = 0; i < changes.length; i += 2) {
    const [status, file] = [changes[i], changes[i + 1]];
    if (!CODE_FILE.test(file)) continue;
    checked.push(file);
    if (status === "A") return { checked, failure: { file, reason: "file added" } };
    if (status === "D") return { checked, failure: { file, reason: "file deleted" } };
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
  stdout(`comments-only: ${count} code file${count === 1 ? "" : "s"} compared; no code changed`);
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
