// The NDJSON wire format for a sync batch (design §4b). One JSON object per line. Two rules make the
// byte-identity guarantee structural: seq travels as a decimal STRING (a JS number loses precision
// past 2^53), and row_image travels as a STRING field carrying the source's raw `row_image::text`,
// NEVER an inlined object — so a numeric inside it is inside a JSON string and JS never parses it.
import type { SyncLogRow } from "./apply.js";

interface WireRow {
  seq: string;
  originId: string;
  table: string;
  op: SyncLogRow["op"];
  tenantId: string;
  rowImage: string; // the source's raw jsonb text, as a JSON string
  txid?: string;
}

export function encodeBatch(rows: readonly SyncLogRow[]): string {
  return rows
    .map((r) => {
      const wire: WireRow = {
        seq: r.seq.toString(),
        originId: r.originId,
        table: r.table,
        op: r.op,
        tenantId: r.tenantId,
        rowImage: r.rowImage,
        ...(r.txid === undefined ? {} : { txid: r.txid }),
      };
      return JSON.stringify(wire);
    })
    .join("\n");
}

export function decodeBatch(body: string): SyncLogRow[] {
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const wire = JSON.parse(line) as WireRow;
      return {
        seq: BigInt(wire.seq),
        originId: wire.originId,
        table: wire.table,
        op: wire.op,
        tenantId: wire.tenantId,
        rowImage: wire.rowImage,
        ...(wire.txid === undefined ? {} : { txid: wire.txid }),
      };
    });
}
