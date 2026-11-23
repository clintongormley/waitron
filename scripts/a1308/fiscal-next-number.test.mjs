import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, rewriteSource } from "./fiscal-next-number.mjs";

const file = "apps/server/src/series.test.ts";

describe("invoice counter references", () => {
  it("rewrites a selected column, adds its import once and leaves other values alone", () => {
    const before = [
      'import { invoiceSeries } from "@waitron/db";',
      "db.select({ code: invoiceSeries.code, next: invoiceSeries.nextNumber }).from(invoiceSeries);",
      "expect(reading).toEqual({ nextNumber: 7 });",
    ].join("\n");
    const expected = [
      'import { invoiceSeries, nextInvoiceNumberOf } from "@waitron/db";',
      "db.select({ code: invoiceSeries.code, next: nextInvoiceNumberOf(invoiceSeries.id) }).from(invoiceSeries);",
      "expect(reading).toEqual({ nextNumber: 7 });",
    ].join("\n");
    expect(rewriteSource(file, before)).toEqual({ text: expected, manual: [], refused: [] });
    expect(rewriteSource(file, expected)).toEqual({ text: expected, manual: [], refused: [] });
  });

  it("removes only default counters in new series inserts", () => {
    const before = [
      'db.insert(invoiceSeries).values({ nodeId, nextNumber: 1, code: "A" });',
      'db.insert(invoiceSeries).values([{ nodeId, code: "B", nextNumber: 1 }]);',
      'db.insert(other).values({ code: "C", nextNumber: 1 });',
      'db.insert(invoiceSeries).values({ nodeId, code: "D", nextNumber: 23 });',
    ].join("\n");
    const expected = [
      'db.insert(invoiceSeries).values({ nodeId, code: "A" });',
      'db.insert(invoiceSeries).values([{ nodeId, code: "B" }]);',
      'db.insert(other).values({ code: "C", nextNumber: 1 });',
      'db.insert(invoiceSeries).values({ nodeId, code: "D", nextNumber: 23 });',
    ].join("\n");
    expect(rewriteSource(file, before)).toEqual({
      text: expected,
      manual: [4],
      refused: [],
    });
  });

  it.each([
    "const query = sql`(select max(${sales.invoiceNumber}) from ${sales} where ${sales.seriesId} = ${invoiceSeries.id})`;",
    'const series = alias(invoiceSeries, "s"); const query = sql`(select max(invoice_number) from sales where series_id = ${series.id})`;',
  ])("refuses an unqualified series column in a sales subquery", (query) => {
    expect(rewriteSource(file, "\n" + query).refused).toEqual([2]);
  });

  it("passes a read through the qualified helper", () => {
    const query = "db.select({ next: nextInvoiceNumberOf(invoiceSeries.id) }).from(invoiceSeries);";
    expect(rewriteSource(file, query)).toEqual({ text: query, manual: [], refused: [] });
  });

  it("adds the helper import for a local series alias and removes a sole default property", () => {
    const source =
      'import { invoiceSeries as series } from "./schema.js";\n' +
      "db.select({ next: series.nextNumber }).from(series);\n" +
      "db.insert(series).values({nextNumber: 1});";
    expect(rewriteSource(file, source)).toEqual({
      text:
        'import { nextInvoiceNumberOf } from "@waitron/db";\n' +
        'import { invoiceSeries as series } from "./schema.js";\n' +
        "db.select({ next: nextInvoiceNumberOf(series.id) }).from(series);\n" +
        "db.insert(series).values({});",
      manual: [],
      refused: [],
    });
  });
});

it("checks and rewrites tracked series fixtures and preserves a file with a refused query", () => {
  const scratch = mkdtempSync(join(tmpdir(), "fiscal-next-number-"));
  try {
    const path = join(scratch, file);
    const manualFile = "apps/server/src/manual.ts";
    const manualPath = join(scratch, manualFile);
    const original =
      'import { invoiceSeries } from "@waitron/db";\n' +
      "db.select({ next: invoiceSeries.nextNumber }).from(invoiceSeries);";
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const git = (...args) => execFileSync("git", args, { cwd: scratch, env });
    git("init", "-q");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, original);
    writeFileSync(join(dirname(path), "unrelated.ts"), "const nextNumber = 7;");
    writeFileSync(join(dirname(path), "ignore.mjs"), original);
    git("add", ".");

    const messages = [];
    const errors = [];
    const output = { log: (line) => messages.push(line), error: (line) => errors.push(line) };
    expect(main(["--check"], scratch, output)).toBe(1);
    expect(errors).toEqual([file + ": supported series counter rewrites remain"]);
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(main([], scratch, output)).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("nextInvoiceNumberOf(invoiceSeries.id)");
    expect(readFileSync(join(dirname(path), "ignore.mjs"), "utf8")).toBe(original);
    expect(main(["--check"], scratch, output)).toBe(0);

    const manual = [
      original,
      "db.where(eq(invoiceSeries.nextNumber, 7));",
      "db.insert(invoiceSeries).values(prepare({ nextNumber: 7 }));",
      "sql`(select max(invoice_number) from sales where series_id = ${invoiceSeries.id})`;",
    ].join("\n");
    writeFileSync(manualPath, manual);
    git("add", manualFile);
    errors.length = 0;
    expect(main([], scratch, output)).toBe(1);
    expect(messages).toEqual([
      manualFile + ":3: series counter needs a hand edit",
      manualFile + ":4: series counter needs a hand edit",
    ]);
    expect(errors).toEqual([
      manualFile + ":5: qualify the outer series column with nextInvoiceNumberOf",
    ]);
    expect(readFileSync(manualPath, "utf8")).toBe(manual);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
