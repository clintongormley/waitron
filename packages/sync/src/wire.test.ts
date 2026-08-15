import { describe, expect, it } from "vitest";
import { decodeBatch, encodeBatch } from "./wire.js";
import type { SyncLogRow } from "./apply.js";

describe("the NDJSON sync wire codec", () => {
  it("round-trips seq as a string and row_image as raw text, preserving a numeric 1.50", () => {
    // Byte-identity across the wire (design §4b): row_image is carried as a STRING field, never an
    // inlined object, so a numeric inside it (1.50) is inside a JSON string and is never parsed as a
    // number. seq is carried as a decimal string so it survives past 2^53.
    const rows: SyncLogRow[] = [
      {
        seq: 9007199254740993n,
        originId: "11111111-1111-4111-8111-111111111111",
        table: "sales",
        op: "insert",
        tenantId: "22222222-2222-4222-8222-222222222222",
        rowImage: '{"total": 1.50, "id": "33333333-3333-4333-8333-333333333333"}',
        txid: "42",
      },
    ];
    const decoded = decodeBatch(encodeBatch(rows));
    expect(decoded).toEqual(rows); // exact, including the bigint seq and the raw rowImage text
    expect(decoded[0]!.rowImage).toContain("1.50"); // never collapsed to 1.5
    expect(typeof decoded[0]!.seq).toBe("bigint");
  });

  it("emits one JSON object per line and ignores a trailing newline / blank lines on decode", () => {
    const rows: SyncLogRow[] = [
      {
        seq: 1n,
        originId: "11111111-1111-4111-8111-111111111111",
        table: "sales",
        op: "insert",
        tenantId: "22222222-2222-4222-8222-222222222222",
        rowImage: '{"id":"a"}',
      },
      {
        seq: 2n,
        originId: "11111111-1111-4111-8111-111111111111",
        table: "sale_lines",
        op: "insert",
        tenantId: "22222222-2222-4222-8222-222222222222",
        rowImage: '{"id":"b"}',
      },
    ];
    const body = encodeBatch(rows);
    expect(body.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
    expect(decodeBatch(body + "\n\n")).toEqual(rows); // blank/trailing lines tolerated
  });

  it("decodes an empty body to an empty batch", () => {
    expect(decodeBatch("")).toEqual([]);
  });
});
