import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

// Three one-shot operator scripts read their positional arguments by destructuring `process.argv`,
// and TypeScript cannot see the arity of that: `const [a, b] = args` compiles against an array of any
// length, so removing an argument from the destructure while leaving the `args.length` guard and the
// printed usage counting it is a silent, invisible shift. It happened on this branch, to all three at
// once, when the leading tenant id was dropped — an operator following the printed usage would have
// fed the taxpayer id into the node id, the till id and the till id respectively, and one of those
// scripts closes a fiscal chain (CLAUDE.md §5).
//
// WHAT THIS GUARD READS, AND THE GAP: it reads the SOURCE TEXT of each script and checks three
// numbers agree — the counts `args.length` accepts, the names destructured out of `args`, and the
// placeholders printed in both usage texts. It does NOT run the scripts and cannot tell you that the
// names are in the right ORDER, only that there are the right number of them. Ordering is still
// carried by review.
const SCRIPTS = ["register-till.ts", "record-one-sale.ts", "settle-invoice-first.ts"] as const;

/** Placeholders a usage text spells for POSITIONAL arguments: everything after the `dist/<x>.js`
 * token, minus the ones that describe an environment variable (`<...>`, `<production|preproduction>`). */
function placeholders(region: string, script: string): { required: number; optional: number } {
  const marker = `dist/${basename(script, ".ts")}.js`;
  const at = region.lastIndexOf(marker);
  const tail = at === -1 ? region : region.slice(at + marker.length);
  const tokens = [...tail.matchAll(/<[^<>]+>|\[[^[\]]+\]/g)].map((m) => m[0]);
  const positional = tokens.filter((t) => !/[|=]/.test(t) && !t.includes("..."));
  return {
    required: positional.filter((t) => t.startsWith("<")).length,
    optional: positional.filter((t) => t.startsWith("[")).length,
  };
}

/** The leading `//` comment block at the top of the file — where each script prints its usage. */
function headerComment(source: string): string {
  const lines: string[] = [];
  for (const line of source.split("\n")) {
    if (!line.startsWith("//")) break;
    lines.push(line);
  }
  return lines.join("\n");
}

/** The argument of the `usageError` helper's second `console.error(...)`. */
function usageErrorText(source: string): string {
  const at = source.indexOf("function usageError");
  expect(at).toBeGreaterThan(-1);
  const body = source.slice(at, source.indexOf("process.exit(1)", at));
  const second = body.lastIndexOf("console.error(");
  return body.slice(second);
}

describe.each(SCRIPTS)(
  "%s: its arity check, its destructure and its usage text agree",
  (script) => {
    const source = readFileSync(join(import.meta.dirname, script), "utf8");

    it("accepts exactly as many arguments as it destructures and as it prints", () => {
      const accepted = [...source.matchAll(/args\.length !== (\d+)/g)]
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b);
      expect(accepted.length).toBeGreaterThan(0);

      const destructure = /const \[([^\]]*)\] = args;/.exec(source);
      expect(destructure).not.toBeNull();
      const names = destructure![1]!
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n !== "");

      const header = placeholders(headerComment(source), script);
      const printed = placeholders(usageErrorText(source), script);

      // Both usage texts spell the same argument list.
      expect(header).toEqual(printed);
      // Every destructured name has a placeholder, and vice versa.
      expect(names).toHaveLength(printed.required + printed.optional);
      // The arity check accepts exactly the counts the placeholders describe.
      expect(accepted).toEqual(
        printed.optional === 0
          ? [printed.required]
          : [printed.required, printed.required + printed.optional],
      );
    });
  },
);
