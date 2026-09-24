import { describe, expect, it } from "vitest";

/**
 * Adapters open transactions through `withTransaction`; this scan rejects bare `.transaction(`
 * calls in production sources.
 *
 * `ImportMeta.glob` is declared locally because this package carries no `vite` dependency.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

const sources = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Strips comments so a doc comment that mentions `.transaction(` does not trip the guard. Copied
 * from `payments/src/no-provider-vocabulary.test.ts`.
 *
 * Blind spot: a STRING LITERAL containing `//` or an unterminated `/*` swallows the rest of its line
 * (or file), so `const x = "//"; await db.transaction(fn);` strips to nothing and would pass. */
function stripComments(source: string): string {
  const blockBlanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return blockBlanked
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

describe("the source glob itself", () => {
  it("discovers the three adapters and the reversal primitive", () => {
    // Without this the scan below passes vacuously against an empty set.
    const names = Object.keys(sources);
    for (const expected of [
      "provider.ts",
      "device-provider.ts",
      "hosted-provider.ts",
      "reverse.ts",
    ]) {
      expect(names.some((n) => n.endsWith(`/${expected}`))).toBe(true);
    }
  });

  it("strips comments before scanning, so a doc comment about db.transaction does not trip it", () => {
    expect(stripComments("/* a db.transaction( in a block comment */ const x = 1;")).not.toContain(
      "db.transaction(",
    );
    expect(stripComments("const x = 1; // a db.transaction( in a line comment")).not.toContain(
      "db.transaction(",
    );
    // …and real code still survives the strip, or the guard would be vacuous in the other direction.
    expect(stripComments("await db.transaction(fn);")).toContain("db.transaction(");
  });
});

describe("no adapter opens an unscoped transaction", () => {
  it("finds no `.transaction(` anywhere in this package's production sources", () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => stripComments(source).includes(".transaction("))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("would catch a bare db.transaction — the guard is not vacuous", () => {
    // The check above is an assertion about absence, which passes just as well when the predicate
    // is broken.
    const offending = "await this.opts.db.transaction((tx) => insertCapturedPayment(tx, common));";
    expect(stripComments(offending).includes(".transaction(")).toBe(true);
  });
});
