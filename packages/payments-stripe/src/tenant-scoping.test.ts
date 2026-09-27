import { blankComments } from "@waitron/shared";
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

/** Blanks comments so a doc comment that mentions `.transaction(` does not trip the guard.
 *
 * Blind spot: `blankComments` guesses from the code before a `/` whether it opens a regular
 * expression, and a wrong guess can blank real code on a later line as if it were a comment. */
function stripComments(source: string): string {
  return blankComments(source);
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

  it("keeps the code after a `/*` inside a line comment or a string", () => {
    const afterLineComment = "// see a/*b\nawait db.transaction(fn);\n/* c */";
    expect(stripComments(afterLineComment)).toContain(".transaction(");
    const afterString = 'const p = "/*"; await db.transaction(fn); // */';
    expect(stripComments(afterString)).toContain(".transaction(");
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
