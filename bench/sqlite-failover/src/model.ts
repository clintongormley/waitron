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
CREATE TABLE IF NOT EXISTS records (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  huella TEXT NOT NULL, huella_anterior TEXT, payload TEXT NOT NULL,
  PRIMARY KEY (node_id, secuencia)
);
-- The model of the ledger's defence: the real table is REVOKE ALL plus an append-only trigger
-- (CLAUDE.md §5), and SQLite's equivalent of that trigger is RAISE(ABORT). The rig's own writes
-- never reach them: applyTail re-inserts with ON CONFLICT DO NOTHING, which fires neither trigger.
-- The s_smoke scenario is what runs them, over every path SQLite offers for changing a row.
CREATE TRIGGER IF NOT EXISTS records_reject_update BEFORE UPDATE ON records
BEGIN SELECT RAISE(ABORT, 'records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS records_reject_delete BEFORE DELETE ON records
BEGIN SELECT RAISE(ABORT, 'records is append-only'); END;
-- MODEL of cadenas (packages/fiscal-verifactu/src/schema/cadenas.ts:44). Per-node chain tip,
-- updated in place by the owner.
CREATE TABLE IF NOT EXISTS chain_head (
  node_id TEXT PRIMARY KEY, last_secuencia INTEGER NOT NULL, last_huella TEXT NOT NULL
);
-- MODEL of envios (+ acks folded to \`acked\`). Submission state; child of records.
CREATE TABLE IF NOT EXISTS envios (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','enviando','enviado')),
  acked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, secuencia),
  FOREIGN KEY (node_id, secuencia) REFERENCES records(node_id, secuencia)
);
-- MODEL of a non-fiscal ledger: parent carries node_id, child hangs off the parent.
CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, total_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sale_lines (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id),
  description TEXT NOT NULL, amount_cents INTEGER NOT NULL
);
-- MODEL of the one residual natural-key clash (outbox-swap design §4.2): a supplier invoice number.
CREATE TABLE IF NOT EXISTS supplier_invoices (
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
  /**
   * Per node, the highest `secuencia` held with NO gap below it, counting up from 1 (a chain's
   * first record is secuencia 1). A receiver holding 1, 2, 5 reports 2, not 5: `MAX(secuencia)`
   * would report 5 and 3 and 4 would never be shipped again, and nothing downstream looks for a
   * hole. Re-shipping 5 is the price, and it costs nothing because `applyTail` is idempotent.
   *
   * Sparse, not one entry per node: `summarise` only creates a key for a `node_id` that appears in
   * `records`, so a chain the receiver holds nothing for is `undefined` here, which `diffTail` reads
   * as 0 — ship the chain from its first record.
   */
  contiguousTo: Record<string, number>;
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
  /**
   * Release the SQLite handle. Every node a scenario opens is closed, a `:memory:` one included:
   * the handle is unusable afterwards (`ERR_INVALID_STATE`), so the close belongs in a `finally`
   * after the scenario's last read. A node opened on a real file path is closed before anything
   * replaces that file.
   */
  close(): void;
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
  // This pragma is what closes the INSERT OR REPLACE path past the append-only triggers below:
  // that statement deletes the conflicting row INTERNALLY, and at SQLite's default OFF an internal
  // delete fires no BEFORE DELETE trigger. Measured on node v26.7.0 against this schema, one ledger
  // row, the same statement: OFF -> not refused, the row's huella and payload were rewritten;
  // ON -> refused, "records is append-only". `s_smoke` asserts all four refusals.
  handle.exec("PRAGMA recursive_triggers = ON");
  handle.exec(SCHEMA);
  return {
    nodeId,
    handle,
    exec: (sql) => handle.exec(sql),
    get: <Row>(sql: string, ...params: SQLInputValue[]) =>
      handle.prepare(sql).get(...params) as Row | undefined,
    close: () => handle.close(),
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
 * `recordSale` writes exactly ONE line per sale: `sale_lines` is here only so `applyTail` has a
 * child row whose parent must be inserted first. A scenario needing more than one line per sale has
 * to widen this function.
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
  // The contiguous run is walked in JavaScript over one ordered read rather than asked of SQL: the
  // whole model ledger is a scenario's worth of rows, so scanning it costs nothing and the loop
  // says what it means where a recursive CTE would not. A node holding no secuencia 1 reports 0.
  const held = db.handle
    .prepare(`SELECT node_id, secuencia FROM records ORDER BY node_id, secuencia`)
    .all() as unknown as { node_id: string; secuencia: number }[];
  const contiguousTo: Record<string, number> = {};
  for (const row of held) {
    const nodeId = String(row.node_id);
    contiguousTo[nodeId] ??= 0;
    if (Number(row.secuencia) === contiguousTo[nodeId] + 1) contiguousTo[nodeId] += 1;
  }

  const saleIds = (
    db.handle.prepare(`SELECT id FROM sales`).all() as unknown as { id: string }[]
  ).map((row) => String(row.id));
  const supplierInvoiceIds = (
    db.handle.prepare(`SELECT id FROM supplier_invoices`).all() as unknown as { id: string }[]
  ).map((row) => String(row.id));

  return { contiguousTo, saleIds, supplierInvoiceIds };
}

/**
 * The rows the SENDER owns that the receiver lacks.
 *
 * Records are selected by a high-water mark rather than row by row, and the mark is the receiver's
 * highest CONTIGUOUS `secuencia` for this chain, so everything at or below it is certainly held and
 * everything above it is shipped. A row above the mark that the receiver already holds is shipped
 * again, which changes nothing: `applyTail` is idempotent.
 *
 * The narrow claim the design rests on is about the SENDER'S OWN chain, not about `records` as a
 * whole: the only writer of a node's own chain is `recordSale`, appending 1, 2, 3, …. `applyTail`
 * also writes `records`, but only for the FOREIGN `senderNodeId` it was handed — it refuses a row
 * whose `node_id` is not that one — and this diff reads only `sender.nodeId`'s rows.
 *
 * Sales and supplier invoices carry no order, so those are diffed by id.
 */
export function diffTail(sender: NodeDb, receiverHeld: HeldSummary): TailBatch {
  const watermark = Number(receiverHeld.contiguousTo[sender.nodeId] ?? 0);
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
  // The only writer of a node's OWN chain is `recordSale`, appending 1, 2, 3, … (see `diffTail`).
  // A tail claiming to come from the receiver itself is refused before any of it is written, and
  // what that prevents is a chain FORK rather than a hole: the record inserts below are ON CONFLICT
  // DO NOTHING, so such a batch fills gaps instead of appending past them, but the chain_head
  // upsert at the end of this function would then move THIS node's own tip onto a huella it never
  // computed — and `recordSale` reads that tip as the next record's huella_anterior.
  if (senderNodeId === receiver.nodeId) {
    throw new Error(`applyTail: node ${receiver.nodeId} was handed a tail from its own chain`);
  }

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

    // A sale line carries no node of its own: its owner is its parent sale's node. Ownership is
    // read back from the RECEIVER's own `sales` rows, after the parent inserts above have run in
    // this transaction — never from the batch's claim. A batch claiming a sale id the receiver
    // already holds under a DIFFERENT node inserts nothing (the insert conflicts), so trusting the
    // claim would hang the batch's line off that other node's sale.
    const senderSaleIds = new Set(
      (
        receiver.handle
          .prepare(`SELECT id FROM sales WHERE node_id = ?`)
          .all(senderNodeId) as unknown as { id: string }[]
      ).map((row) => String(row.id)),
    );
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
 * One drain pass over every pending submission this node holds. Two SHAPES are borrowed from the
 * real drain; what triggers the second is the model's own stand-in, not a mirror:
 *
 *  1. It claims across EVERY chain with no node filter — the real `claimBatch` takes no node
 *    argument (packages/fiscal-verifactu/src/drain.ts:542), which is why a record shipped from
 *    another node can be submitted by the receiver before the ship is confirmed.
 *  2. A per-pass in-memory blocked-chain set, skipping the rest of a blocked chain and re-examining
 *    it next pass (`blockedSifIds`, drain.ts:304 and 583 — the real key is `sif_id`, the model's is
 *    `node_id`).
 *
 * The real set is added to in exactly one place, drain.ts:583: the claim-time environment guard,
 * when a row's `entorno` is NULL or disagrees with `WAITRON_ENV`. The model has no `entorno`, so it
 * blocks a chain on a `submit` throw instead. The real drain's answer to a `submit` throw is a
 * different thing the model does not have: drain.ts:359-370 backs the claimed batch off (rows to
 * `pendiente`, an incidencia, a later `proximo_intento_en`) and ends the pass for EVERY chain.
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
