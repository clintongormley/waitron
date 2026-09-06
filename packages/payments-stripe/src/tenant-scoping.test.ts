import { describe, expect, it } from "vitest";

/**
 * Makes the tenant-scoping invariant STRUCTURAL rather than a rule three doc comments happen to
 * describe.
 *
 * Adapters use `withTenant` for their transaction boundaries and node origin attribution.
 * The source scan rejects bare `.transaction(` calls in production sources.
 *
 * The local `ImportMeta.glob` declaration mirrors that file's, and for its reason: this package
 * carries no `vite` dependency, and adding one for a type reference would be a dependency bought
 * for a comment.
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

/** Blanks block comments to equivalent whitespace and drops trailing line comments, so a doc
 * comment that legitimately DISCUSSES `db.transaction(...)` — several here do, explaining why it is
 * wrong — does not trip the guard, while real code still does. Replicated from
 * `payments/src/no-provider-vocabulary.test.ts`, which explains at length why these two regexes are
 * copied rather than exported through a package's production surface.
 *
 * Known blind spot, inherited with the regexes: a STRING LITERAL containing `//` or an unterminated
 * `/*` swallows the rest of its line (or file), so `const x = "//"; await db.transaction(fn);`
 * strips to nothing and would pass. Nothing in this package writes such a string, and hardening it
 * properly means a tokeniser rather than two regexes — noted so the next reader knows the bound
 * rather than assuming there is none. */
function stripComments(source: string): string {
  const blockBlanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return blockBlanked
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

describe("the source glob itself", () => {
  it("discovers the three adapters and the reversal primitive", () => {
    // Without this the scan below passes vacuously against an empty set — the shape of vacuous
    // test this project has shipped too many of already.
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
    // NO exemptions, deliberately. An earlier version of this test exempted `reverse.ts` on the
    // grounds that `reverseViaStripe` "chooses its opener once, from its own `tenantId` option" —
    // which described the code the fix had just deleted. Its opener is now an unconditional
    // `withTenant`, so the exemption protected nothing and holed the guard in precisely the file
    // that caused the reversal defect: re-adding
    // `tenantId === undefined ? db.transaction(fn) : withTenant(...)` there would have kept CI
    // green while returning every reversal to `payment.not_found` under a real role.
    const offenders = Object.entries(sources)
      .filter(([, source]) => stripComments(source).includes(".transaction("))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("would catch a bare db.transaction — the guard is not vacuous", () => {
    // The check above is an assertion about absence, which passes just as well when the predicate
    // is broken. This pins the predicate itself against the exact string the adapters used to
    // contain, so a refactor that silently stops matching fails here instead of going quiet.
    const offending = "await this.opts.db.transaction((tx) => insertCapturedPayment(tx, common));";
    expect(stripComments(offending).includes(".transaction(")).toBe(true);
  });
});
