import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: a reader that sums, counts or tests for a sale's correctives goes through
 * `correctivesOf` (`packages/db/src/correctives-of.ts`), which leaves a replacement out and takes
 * in its refunds. A replacement repeats its original's full total, so a reader matching
 * `corrects_sale_id` directly counts a replaced sale twice.
 *
 * Weaker than its name: it reads TEXT, line by line, in non-test `.ts` files under `apps/*\/src`
 * and `packages/*\/src` (`testing/` folders left out). It flags an SQL equality on
 * `corrects_sale_id` and a Drizzle `eq(`/`inArray(` whose first argument is a `correctsSaleId`
 * column. A sum built any other way passes it: a column renamed through an alias in a `sql`
 * template, a comparison split across lines, a helper it does not recognise, or SQL outside those
 * folders, such as the `sale_settlements_check_coverage` trigger in `packages/db/triggers/core.sql`.
 */

const repoRoot = join(import.meta.dirname, "..");

const SQL_EQUALITY = /\bcorrects_sale_id\s*=(?!=)|=\s*[\w$]+\.corrects_sale_id\b/;
const DRIZZLE_MATCH = /\b(?:eq|inArray)\(\s*[\w$.]+\.correctsSaleId\s*,/;

/**
 * The lines that may match, each by file, a fragment of the line and how many lines it matches,
 * with why it is not a sum of what a sale owes. The count keeps a second copy of an allowed line
 * from passing unseen.
 */
const ALLOWED: readonly { file: string; fragment: string; lines: number; reason: string }[] = [
  {
    file: "packages/db/src/correctives-of.ts",
    fragment: "corrects_sale_id = ${saleId}",
    lines: 2,
    reason: "the helper itself",
  },
  {
    file: "apps/server/src/orders-list.ts",
    fragment: "where (x.id = r.sale_id or x.corrects_sale_id = r.sale_id",
    lines: 1,
    reason:
      "the number search finds a bill by its own invoice or any corrective of it, its replacement included",
  },
  {
    file: "apps/server/src/orders-list.ts",
    fragment:
      "or x.corrects_sale_id in (select y.id from sales y where y.corrects_sale_id = r.sale_id",
    lines: 1,
    reason: "the number search finds a bill by a corrective of its replacement",
  },
  {
    file: "apps/server/src/orders-list.ts",
    fragment: "eq(sales.correctsSaleId, saleId), eq(sales.replacesOriginal, true)",
    lines: 1,
    reason: "finds the replacement itself, to list it as Replaced by",
  },
  {
    file: "apps/server/src/deferred-payment-export.ts",
    fragment: "eq(correction.correctsSaleId, deferredClosures.saleId)",
    lines: 1,
    reason: "finds the replacement itself (joined with replacesOriginal), to name it",
  },
  {
    file: "packages/core/src/record-replacement.ts",
    fragment: "select count(*) from sales c where c.corrects_sale_id",
    lines: 1,
    reason: "a replacement is refused after ANY earlier corrective (sale.replacement_not_first)",
  },
  {
    file: "packages/core/src/record-substitution.ts",
    fragment: "inArray(sales.correctsSaleId, input.substitutedSaleIds)",
    lines: 1,
    reason: "finds a replacement of a ticket (with replacesOriginal), which refuses its exchange",
  },
  {
    file: "packages/core/src/correction-target.ts",
    fragment: "eq(sales.correctsSaleId, saleId), eq(sales.replacesOriginal, true)",
    lines: 1,
    reason: "finds the replacement itself, the invoice a later correction is filed against",
  },
  {
    file: "packages/core/src/record-correction.ts",
    fragment: "select sum(c.total) from sales c where c.corrects_sale_id",
    lines: 1,
    reason:
      "what is left on the correction target, which has no replacement (correctionTargetFor), so its own correctives are all that change it",
  },
  {
    file: "packages/core/src/record-correction.ts",
    fragment: "select count(*) from sales c where c.corrects_sale_id",
    lines: 1,
    reason: "the correction target's own earlier corrections; it has no replacement",
  },
  {
    file: "packages/core/src/record-correction.ts",
    fragment: "eq(sales.correctsSaleId, correctsSaleId)",
    lines: 2,
    reason:
      "the partial-refund history of the correction target: its earlier corrections' VAT breakdowns and lines",
  },
  {
    file: "packages/core/src/correction-history.ts",
    fragment: "eq(sales.correctsSaleId, saleId)",
    lines: 2,
    reason:
      "the partial-refund history of the correction target: its earlier corrections' figures and lines",
  },
  {
    file: "packages/reporting/src/top-sellers.ts",
    fragment: "cs.corrects_sale_id = il.sale_id and cl.corrects_line_id = il.id",
    lines: 1,
    reason: "nets corrective lines against the invoice line they name; a replacement's name none",
  },
];

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry !== "testing") out.push(...sourceFilesIn(full));
    } else if (st.isFile() && full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function productionSources(): string[] {
  return ["apps", "packages"]
    .flatMap((root) =>
      readdirSync(join(repoRoot, root)).map((name) => join(repoRoot, root, name, "src")),
    )
    .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true)
    .flatMap(sourceFilesIn)
    .map((file) => relative(repoRoot, file))
    .sort();
}

/** Every matching line, as `file: line`. */
function correctiveMatches(file: string, source: string): string[] {
  return source
    .split("\n")
    .filter((line) => SQL_EQUALITY.test(line) || DRIZZLE_MATCH.test(line))
    .map((line) => `${file}: ${line.trim()}`);
}

function matchesEntry(match: string, entry: (typeof ALLOWED)[number]): boolean {
  return match.startsWith(`${entry.file}: `) && match.includes(entry.fragment);
}

describe("sums of a sale's correctives go through correctivesOf", () => {
  const matches = productionSources().flatMap((file) =>
    correctiveMatches(file, readFileSync(join(repoRoot, file), "utf8")),
  );

  it("scans a non-empty tree", () => {
    expect(productionSources().length).toBeGreaterThan(500);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("finds no corrective match outside the allowlist", () => {
    expect(matches.filter((match) => !ALLOWED.some((entry) => matchesEntry(match, entry)))).toEqual(
      [],
    );
  });

  it("matches each allowlist entry on exactly as many lines as it names", () => {
    const wrong = ALLOWED.map((entry) => ({
      entry: `${entry.file}: ${entry.fragment}`,
      expected: entry.lines,
      found: matches.filter((match) => matchesEntry(match, entry)).length,
    })).filter(({ expected, found }) => expected !== found);
    expect(wrong).toEqual([]);
  });
});

describe("negative controls", () => {
  it("flags the shapes the readers used before correctivesOf", () => {
    const shapes = [
      "coalesce((select sum(c.total) from sales c where c.corrects_sale_id = s.id),0)",
      "exists (select 1 from sales c where c.corrects_sale_id = r.sale_id)",
      ".where(eq(corrections.correctsSaleId, saleId)),",
      ".innerJoin(correction, eq(correction.correctsSaleId, deferredClosures.saleId))",
      ".where(inArray(sales.correctsSaleId, [...saleIds]))",
      "join sales c on s.id = c.corrects_sale_id",
    ];
    expect(shapes.map((line) => correctiveMatches("x.ts", line).length)).toEqual(
      shapes.map(() => 1),
    );
  });

  it("leaves a filter, a walk to the original and a lookup of the original alone", () => {
    const shapes = [
      "where s.corrects_sale_id is null",
      "select g.sale_id, s.corrects_sale_id from invoice_scope g",
      ".where(eq(sales.id, sale.correctsSaleId))",
      "isNull(sales.correctsSaleId),",
    ];
    expect(shapes.flatMap((line) => correctiveMatches("x.ts", line))).toEqual([]);
  });
});
