/**
 * A MODEL of the fiscal ledger the failover loop moves around — never the ledger itself.
 *
 * Nothing here is imported by a product package, and nothing here may be read as a statement about
 * what `packages/fiscal-verifactu` does. Each table below names the real table it stands in for so a
 * reader can check the shape is faithful; the spec's §2 lists what the model deliberately leaves out.
 */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";

const SCHEMA = `
-- MODEL of registros_facturacion (packages/fiscal-verifactu/src/schema/registros.ts:35,148).
-- Append-only, hash-chained, keyed (node_id, secuencia). NOT the real ledger.
CREATE TABLE records (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  huella TEXT NOT NULL, huella_anterior TEXT, payload TEXT NOT NULL,
  PRIMARY KEY (node_id, secuencia)
);
-- MODEL of cadenas (packages/fiscal-verifactu/src/schema/cadenas.ts:44). Per-node chain tip,
-- updated in place by the owner.
CREATE TABLE chain_head (
  node_id TEXT PRIMARY KEY, last_secuencia INTEGER NOT NULL, last_huella TEXT NOT NULL
);
-- MODEL of envios (+ acks folded to \`acked\`). Submission state; child of records.
CREATE TABLE envios (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','enviando','enviado')),
  acked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, secuencia),
  FOREIGN KEY (node_id, secuencia) REFERENCES records(node_id, secuencia)
);
-- MODEL of a non-fiscal ledger: parent carries node_id, child hangs off the parent.
CREATE TABLE sales (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, total_cents INTEGER NOT NULL);
CREATE TABLE sale_lines (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  description TEXT NOT NULL, amount_cents INTEGER NOT NULL
);
-- MODEL of the one residual natural-key clash (outbox-swap design §4.2): a supplier invoice number.
CREATE TABLE supplier_invoices (
  id TEXT PRIMARY KEY, node_id TEXT NOT NULL,
  supplier TEXT NOT NULL, invoice_number TEXT NOT NULL,
  UNIQUE (supplier, invoice_number)
);
`;

export type RecordRow = {
  node_id: string;
  secuencia: number;
  huella: string;
  huella_anterior: string | null;
  payload: string;
};

export type EnvioEstado = "pendiente" | "enviando" | "enviado";

export type EnvioRow = {
  node_id: string;
  secuencia: number;
  estado: EnvioEstado;
  acked: number;
};

export type SaleRow = { id: string; node_id: string; total_cents: number };

export type SaleLineRow = {
  id: string;
  sale_id: string;
  description: string;
  amount_cents: number;
};

export type SupplierInvoiceRow = {
  id: string;
  node_id: string;
  supplier: string;
  invoice_number: string;
};

/** What a receiver already holds, as the sender needs to see it to compute a tail. */
export type HeldSummary = {
  /** Per node, the highest `secuencia` the receiver holds for that node's chain. */
  maxSecuencia: Record<string, number>;
  saleIds: string[];
  supplierInvoiceIds: string[];
};

export type TailBatch = {
  records: RecordRow[];
  envios: EnvioRow[];
  sales: SaleRow[];
  saleLines: SaleLineRow[];
  supplierInvoices: SupplierInvoiceRow[];
};

export type ApplyResult = {
  applied: number;
  skippedClashes: SupplierInvoiceRow[];
  refusedForeign: number;
};

/**
 * One node: its SQLite database plus the id whose chain it owns. `handle` is the raw
 * `node:sqlite` database, because later scenarios reach past these helpers into plain SQL.
 */
export type NodeDb = {
  nodeId: string;
  handle: DatabaseSync;
  exec(sql: string): void;
  get<Row = Record<string, SQLOutputValue>>(
    sql: string,
    ...params: SQLInputValue[]
  ): Row | undefined;
};

/**
 * The model's hash. It is NOT `computeHuella` (packages/verifactu/src/huella.ts:99), which hashes a
 * field-ordered AEAT record, not an opaque string. Nothing computed here is evidence about the real
 * chain: what the scenarios use it for is that a chain link is checkable, not that it is AEAT's.
 */
export function toyHuella(prev: string | null, payload: string): string {
  return createHash("sha256")
    .update(`${prev ?? ""}|${payload}`)
    .digest("hex");
}

export function openNode(nodeId: string, path?: string): NodeDb {
  const handle = new DatabaseSync(path ?? ":memory:");
  handle.exec("PRAGMA foreign_keys = ON");
  handle.exec(SCHEMA);
  return {
    nodeId,
    handle,
    exec: (sql) => handle.exec(sql),
    get: <Row>(sql: string, ...params: SQLInputValue[]) =>
      handle.prepare(sql).get(...params) as Row | undefined,
  };
}

function withTx<T>(handle: DatabaseSync, body: () => T): T {
  handle.exec("BEGIN");
  try {
    const out = body();
    handle.exec("COMMIT");
    return out;
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

/** `changes` is `number | bigint` depending on the statement's configuration. */
function changed(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

/**
 * Append one hash-linked record with its pending submission row and the sale it describes, in one
 * transaction: a chain tip read that is not in the same transaction as the append it decides is the
 * chain fork the whole rig exists to look for.
 *
 * The sale gets exactly ONE line. `sale_lines` is here only so `applyTail` has a child row whose
 * parent must be inserted first; no scenario creates a second line.
 */
export function recordSale(
  db: NodeDb,
  payloadCents: number,
): { secuencia: number; huella: string } {
  return withTx(db.handle, () => {
    const head = db.handle
      .prepare(`SELECT last_secuencia, last_huella FROM chain_head WHERE node_id = ?`)
      .get(db.nodeId) as { last_secuencia: number; last_huella: string } | undefined;
    const secuencia = (head ? Number(head.last_secuencia) : 0) + 1;
    const huellaAnterior = head ? String(head.last_huella) : null;

    const saleId = randomUUID();
    const payload = `${saleId}:${payloadCents}`;
    const huella = toyHuella(huellaAnterior, payload);

    db.handle
      .prepare(
        `INSERT INTO records (node_id, secuencia, huella, huella_anterior, payload)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(db.nodeId, secuencia, huella, huellaAnterior, payload);
    db.handle
      .prepare(
        `INSERT INTO envios (node_id, secuencia, estado, acked) VALUES (?, ?, 'pendiente', 0)`,
      )
      .run(db.nodeId, secuencia);
    db.handle
      .prepare(`INSERT INTO sales (id, node_id, total_cents) VALUES (?, ?, ?)`)
      .run(saleId, db.nodeId, payloadCents);
    db.handle
      .prepare(
        `INSERT INTO sale_lines (id, sale_id, description, amount_cents) VALUES (?, ?, ?, ?)`,
      )
      .run(randomUUID(), saleId, `sale ${secuencia}`, payloadCents);
    db.handle
      .prepare(
        `INSERT INTO chain_head (node_id, last_secuencia, last_huella) VALUES (?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           last_secuencia = excluded.last_secuencia, last_huella = excluded.last_huella`,
      )
      .run(db.nodeId, secuencia, huella);

    return { secuencia, huella };
  });
}

/** What this node holds right now, for every chain — not only its own. */
export function summarise(db: NodeDb): HeldSummary {
  const heads = db.handle
    .prepare(`SELECT node_id, MAX(secuencia) AS max_secuencia FROM records GROUP BY node_id`)
    .all() as unknown as { node_id: string; max_secuencia: number }[];
  const maxSecuencia: Record<string, number> = {};
  for (const row of heads) maxSecuencia[String(row.node_id)] = Number(row.max_secuencia);

  const saleIds = (
    db.handle.prepare(`SELECT id FROM sales`).all() as unknown as { id: string }[]
  ).map((row) => String(row.id));
  const supplierInvoiceIds = (
    db.handle.prepare(`SELECT id FROM supplier_invoices`).all() as unknown as { id: string }[]
  ).map((row) => String(row.id));

  return { maxSecuencia, saleIds, supplierInvoiceIds };
}

/**
 * The rows the SENDER owns that the receiver lacks.
 *
 * Records are selected by a high-water mark rather than row by row: `recordSale` is the only writer
 * of `records` and it appends 1, 2, 3, … per node, so the rows above the receiver's highest
 * `secuencia` for this chain are exactly the ones it is missing. Sales and supplier invoices carry no
 * order, so those are diffed by id.
 */
export function diffTail(sender: NodeDb, receiverHeld: HeldSummary): TailBatch {
  const watermark = Number(receiverHeld.maxSecuencia[sender.nodeId] ?? 0);
  const heldSales = new Set(receiverHeld.saleIds);
  const heldSupplierInvoices = new Set(receiverHeld.supplierInvoiceIds);

  const records = sender.handle
    .prepare(
      `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
       WHERE node_id = ? AND secuencia > ? ORDER BY secuencia`,
    )
    .all(sender.nodeId, watermark) as unknown as RecordRow[];
  const envios = sender.handle
    .prepare(
      `SELECT node_id, secuencia, estado, acked FROM envios
       WHERE node_id = ? AND secuencia > ? ORDER BY secuencia`,
    )
    .all(sender.nodeId, watermark) as unknown as EnvioRow[];

  const sales = (
    sender.handle
      .prepare(`SELECT id, node_id, total_cents FROM sales WHERE node_id = ? ORDER BY id`)
      .all(sender.nodeId) as unknown as SaleRow[]
  ).filter((sale) => !heldSales.has(String(sale.id)));
  const shippedSaleIds = new Set(sales.map((sale) => String(sale.id)));
  const saleLines = (
    sender.handle
      .prepare(`SELECT id, sale_id, description, amount_cents FROM sale_lines ORDER BY id`)
      .all() as unknown as SaleLineRow[]
  ).filter((line) => shippedSaleIds.has(String(line.sale_id)));

  const supplierInvoices = (
    sender.handle
      .prepare(
        `SELECT id, node_id, supplier, invoice_number FROM supplier_invoices
         WHERE node_id = ? ORDER BY id`,
      )
      .all(sender.nodeId) as unknown as SupplierInvoiceRow[]
  ).filter((invoice) => !heldSupplierInvoices.has(String(invoice.id)));

  return { records, envios, sales, saleLines, supplierInvoices };
}

/**
 * Apply a shipped tail to the receiver, in one transaction.
 *
 * Task 1 scope. Two branches are deliberately NOT here yet, and a scenario that needs them will fail
 * until they are:
 *   - `envios` terminal-state-wins (Task 4, S2). Today the envio insert is plain: a row the receiver
 *     has already advanced past keeps its state only because the insert conflicts and does nothing,
 *     which is not the same rule as "a terminal row is never regressed" and does not survive the
 *     upsert Task 4 puts here.
 *   - the `supplier_invoices` savepoint-isolated clash branch (Task 5, S5). Today a natural-key
 *     clash is absorbed by `ON CONFLICT DO NOTHING` and lands in neither the table nor
 *     `skippedClashes` — it is dropped without a word, which is exactly what S5 exists to change.
 */
export function applyTail(receiver: NodeDb, senderNodeId: string, tail: TailBatch): ApplyResult {
  return withTx(receiver.handle, () => {
    let applied = 0;
    let refusedForeign = 0;
    const skippedClashes: SupplierInvoiceRow[] = [];

    // Idempotent by construction: a ship is retried whenever its confirmation is lost, so a second
    // apply of rows already held must be a no-op rather than an error.
    const insertRecord = receiver.handle.prepare(
      `INSERT INTO records (node_id, secuencia, huella, huella_anterior, payload)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    );
    for (const row of tail.records) {
      if (row.node_id !== senderNodeId) {
        refusedForeign += 1;
        continue;
      }
      applied += changed(
        insertRecord.run(row.node_id, row.secuencia, row.huella, row.huella_anterior, row.payload),
      );
    }

    // Parents before children, or the FK to `records` rejects the envio.
    const insertEnvio = receiver.handle.prepare(
      `INSERT INTO envios (node_id, secuencia, estado, acked) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    );
    for (const row of tail.envios) {
      if (row.node_id !== senderNodeId) {
        refusedForeign += 1;
        continue;
      }
      applied += changed(insertEnvio.run(row.node_id, row.secuencia, row.estado, row.acked));
    }

    const insertSale = receiver.handle.prepare(
      `INSERT INTO sales (id, node_id, total_cents) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    );
    for (const row of tail.sales) {
      if (row.node_id !== senderNodeId) {
        refusedForeign += 1;
        continue;
      }
      applied += changed(insertSale.run(row.id, row.node_id, row.total_cents));
    }

    // A sale line carries no node of its own: its owner is its parent sale's node. The parent is
    // either in this batch or already on the receiver, so both are consulted.
    const senderSaleIds = new Set(
      tail.sales.filter((sale) => sale.node_id === senderNodeId).map((sale) => String(sale.id)),
    );
    for (const row of receiver.handle
      .prepare(`SELECT id FROM sales WHERE node_id = ?`)
      .all(senderNodeId) as unknown as { id: string }[]) {
      senderSaleIds.add(String(row.id));
    }
    const insertSaleLine = receiver.handle.prepare(
      `INSERT INTO sale_lines (id, sale_id, description, amount_cents) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    );
    for (const row of tail.saleLines) {
      if (!senderSaleIds.has(String(row.sale_id))) {
        refusedForeign += 1;
        continue;
      }
      applied += changed(
        insertSaleLine.run(row.id, row.sale_id, row.description, row.amount_cents),
      );
    }

    const insertSupplierInvoice = receiver.handle.prepare(
      `INSERT INTO supplier_invoices (id, node_id, supplier, invoice_number) VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    );
    for (const row of tail.supplierInvoices) {
      if (row.node_id !== senderNodeId) {
        refusedForeign += 1;
        continue;
      }
      applied += changed(
        insertSupplierInvoice.run(row.id, row.node_id, row.supplier, row.invoice_number),
      );
    }

    // The receiver's view of a foreign chain's tip is derived from the rows it holds, and only ever
    // moves forward — a re-shipped older batch must not walk it back.
    const head = receiver.handle
      .prepare(
        `SELECT secuencia, huella FROM records WHERE node_id = ? ORDER BY secuencia DESC LIMIT 1`,
      )
      .get(senderNodeId) as { secuencia: number; huella: string } | undefined;
    if (head) {
      receiver.handle
        .prepare(
          `INSERT INTO chain_head (node_id, last_secuencia, last_huella) VALUES (?, ?, ?)
           ON CONFLICT(node_id) DO UPDATE SET
             last_secuencia = excluded.last_secuencia, last_huella = excluded.last_huella
           WHERE excluded.last_secuencia > chain_head.last_secuencia`,
        )
        .run(senderNodeId, Number(head.secuencia), String(head.huella));
    }

    return { applied, skippedClashes, refusedForeign };
  });
}

/**
 * One drain pass over every pending submission this node holds, mirroring the two behaviours of the
 * real drain the failover loop depends on and no others:
 *
 *  1. It claims across EVERY chain with no node filter — the real `claimBatch` takes no node
 *    argument (packages/fiscal-verifactu/src/drain.ts:542), which is why a record shipped from
 *    another node can be submitted by the receiver before the ship is confirmed.
 *  2. A per-pass in-memory blocked-chain set: a chain whose submit throws is skipped for the rest of
 *    this pass, and re-examined on the next one (`blockedSifIds`, drain.ts:304,547 — the real key is
 *    `sif_id`; the model's chain key is `node_id`).
 *
 * `submit` stands in for the AEAT call. A throw returns the row to `pendiente`, so the pass records
 * a refusal rather than losing the row.
 */
export function drainPass(db: NodeDb, submit: (nodeId: string, secuencia: number) => void): void {
  const blockedChains = new Set<string>();
  const due = db.handle
    .prepare(
      `SELECT node_id, secuencia FROM envios WHERE estado = 'pendiente' ORDER BY node_id, secuencia`,
    )
    .all() as unknown as { node_id: string; secuencia: number }[];

  const claim = db.handle.prepare(
    `UPDATE envios SET estado = 'enviando' WHERE node_id = ? AND secuencia = ? AND estado = 'pendiente'`,
  );
  const accept = db.handle.prepare(
    `UPDATE envios SET estado = 'enviado', acked = 1 WHERE node_id = ? AND secuencia = ?`,
  );
  const release = db.handle.prepare(
    `UPDATE envios SET estado = 'pendiente' WHERE node_id = ? AND secuencia = ?`,
  );

  for (const row of due) {
    const nodeId = String(row.node_id);
    const secuencia = Number(row.secuencia);
    if (blockedChains.has(nodeId)) continue;
    if (changed(claim.run(nodeId, secuencia)) === 0) continue;
    try {
      submit(nodeId, secuencia);
      accept.run(nodeId, secuencia);
    } catch {
      release.run(nodeId, secuencia);
      blockedChains.add(nodeId);
    }
  }
}
