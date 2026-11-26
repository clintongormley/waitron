/**
 * A MODEL of the fiscal ledger the failover loop moves around — never the ledger itself.
 */
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";

const SCHEMA = `
-- MODEL of verifactu_records (packages/fiscal-verifactu/src/schema/verifactu-records.ts).
-- Append-only, hash-chained, keyed (node_id, secuencia). NOT the real ledger.
CREATE TABLE IF NOT EXISTS records (
  node_id TEXT NOT NULL, secuencia INTEGER NOT NULL,
  huella TEXT NOT NULL, huella_anterior TEXT, payload TEXT NOT NULL,
  PRIMARY KEY (node_id, secuencia)
);
-- The model of the ledger's defence: the real table is REVOKE ALL plus an append-only trigger
-- (CLAUDE.md §5), and SQLite's equivalent of that trigger is RAISE(ABORT). The rig's own writes
-- never reach them: applyTail re-inserts a RECORDS row with ON CONFLICT DO NOTHING, which fires
-- neither trigger. Its envios write does update a row already there (see EnvioRule below), and
-- envios carries no such trigger.
-- The s_smoke scenario is what runs them, over every path SQLite offers for changing a row.
CREATE TRIGGER IF NOT EXISTS records_reject_update BEFORE UPDATE ON records
BEGIN SELECT RAISE(ABORT, 'records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS records_reject_delete BEFORE DELETE ON records
BEGIN SELECT RAISE(ABORT, 'records is append-only'); END;
-- MODEL of the former cadenas table. Waitron now reads the head from verifactu_records.
CREATE TABLE IF NOT EXISTS chain_head (
  node_id TEXT PRIMARY KEY, last_secuencia INTEGER NOT NULL, last_huella TEXT NOT NULL
);
-- MODEL of verifactu_submissions. The acked flag marks a recorded filing reply.
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

export type HeldSummary = {
  /**
   * Per node, the highest `secuencia` held with NO gap below it, counting up from 1 (a chain's
   * first record is secuencia 1). A receiver holding 1, 2, 5 reports 2, not 5: `MAX(secuencia)`
   * would report 5 and 3 and 4 would never be shipped again, and nothing downstream looks for a
   * hole. Re-shipping 5 is the price. Its `records` row is re-inserted `ON CONFLICT DO NOTHING` and
   * nothing about it changes; its `envios` row is not inert, because a re-shipped copy whose
   * `estado` has advanced IS adopted — the `terminal-state-wins` rule, `EnvioRule` below.
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

export type NodeDb = {
  nodeId: string;
  handle: DatabaseSync;
  exec(sql: string): void;
  get<Row = Record<string, SQLOutputValue>>(
    sql: string,
    ...params: SQLInputValue[]
  ): Row | undefined;
  all<Row = Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]): Row[];
  close(): void;
};

export function toyHuella(prev: string | null, payload: string): string {
  return createHash("sha256")
    .update(`${prev ?? ""}|${payload}`)
    .digest("hex");
}

export function openNode(nodeId: string, path?: string): NodeDb {
  const handle = new DatabaseSync(path ?? ":memory:");
  handle.exec("PRAGMA foreign_keys = ON");
  // This pragma is what closes the INSERT OR REPLACE path past the append-only triggers below:
  // that statement deletes the conflicting row internally, which needs recursive triggers to fire
  // the BEFORE DELETE trigger.
  handle.exec("PRAGMA recursive_triggers = ON");
  handle.exec("PRAGMA busy_timeout = 5000");
  handle.exec(SCHEMA);
  return {
    nodeId,
    handle,
    exec: (sql) => handle.exec(sql),
    get: <Row>(sql: string, ...params: SQLInputValue[]) =>
      handle.prepare(sql).get(...params) as Row | undefined,
    all: <Row>(sql: string, ...params: SQLInputValue[]) =>
      handle.prepare(sql).all(...params) as unknown as Row[],
    close: () => handle.close(),
  };
}

/**
 * Every caller writes, so the write lock is asked for at BEGIN rather than partway through.
 */
function withTx<T>(handle: DatabaseSync, body: () => T): T {
  handle.exec("BEGIN IMMEDIATE");
  try {
    const out = body();
    handle.exec("COMMIT");
    return out;
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

function changed(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

/**
 * Append one hash-linked record with its pending submission row and the sale it describes, in one
 * transaction: a chain tip read that is not in the same transaction as the append it decides is the
 * chain fork the whole rig exists to look for.
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

export function summarise(db: NodeDb): HeldSummary {
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
 *  - `terminal-state-wins` — the rule, and it has two sides. A receiver row that is already
 *    `enviado` and acked is never walked back by a re-shipped copy taken before it was submitted;
 *    a receiver row that is not yet terminal ADOPTS the shipped state, terminal included. The first
 *    side keeps the receiver from filing a record it has itself filed, the second keeps it from
 *    filing a record the record's OWNER has already filed — neither side implies the other, so S2
 *    drives both.
 */
type EnvioRule = "terminal-state-wins" | "regressing" | "insert-only";

const ENVIO_UPSERT: Record<EnvioRule, string> = {
  "terminal-state-wins": `INSERT INTO envios (node_id, secuencia, estado, acked) VALUES (?, ?, ?, ?)
     ON CONFLICT(node_id, secuencia) DO UPDATE SET estado = excluded.estado, acked = excluded.acked
     WHERE envios.estado <> 'enviado' AND envios.acked = 0
       AND (envios.estado <> excluded.estado OR envios.acked <> excluded.acked)`,
  regressing: `INSERT INTO envios (node_id, secuencia, estado, acked) VALUES (?, ?, ?, ?)
     ON CONFLICT(node_id, secuencia) DO UPDATE SET estado = excluded.estado, acked = excluded.acked`,
  "insert-only": `INSERT INTO envios (node_id, secuencia, estado, acked) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
};

type ClashRule = "report-and-skip" | "silent-drop" | "unisolated";

const CLASH_INSERT: Record<ClashRule, string> = {
  "report-and-skip": `INSERT INTO supplier_invoices (id, node_id, supplier, invoice_number)
     VALUES (?, ?, ?, ?)`,
  "silent-drop": `INSERT INTO supplier_invoices (id, node_id, supplier, invoice_number)
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  unisolated: `INSERT INTO supplier_invoices (id, node_id, supplier, invoice_number)
     VALUES (?, ?, ?, ?)`,
};

/**
 * The same probe is why `errstr` cannot do this job, and a reader will reach for it: all four
 * refusals carry the errstr "constraint failed", so classifying on it would let a NOT NULL refusal
 * or a trigger's refusal be treated as a clash.
 */
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_UNIQUE = 2067;

function isUniquenessRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { errcode } = error as { errcode?: unknown };
  return errcode === SQLITE_CONSTRAINT_PRIMARYKEY || errcode === SQLITE_CONSTRAINT_UNIQUE;
}

type ShipRules = { envio: EnvioRule; clash: ClashRule };

export function applyTail(receiver: NodeDb, senderNodeId: string, tail: TailBatch): ApplyResult {
  return applyShippedTail(receiver, senderNodeId, tail, {
    envio: "terminal-state-wins",
    clash: "report-and-skip",
  });
}

export function applyTailRegressing(
  receiver: NodeDb,
  senderNodeId: string,
  tail: TailBatch,
): ApplyResult {
  return applyShippedTail(receiver, senderNodeId, tail, {
    envio: "regressing",
    clash: "report-and-skip",
  });
}

export function applyTailInsertOnly(
  receiver: NodeDb,
  senderNodeId: string,
  tail: TailBatch,
): ApplyResult {
  return applyShippedTail(receiver, senderNodeId, tail, {
    envio: "insert-only",
    clash: "report-and-skip",
  });
}

export function applyTailSilentDrop(
  receiver: NodeDb,
  senderNodeId: string,
  tail: TailBatch,
): ApplyResult {
  return applyShippedTail(receiver, senderNodeId, tail, {
    envio: "terminal-state-wins",
    clash: "silent-drop",
  });
}

export function applyTailUnisolated(
  receiver: NodeDb,
  senderNodeId: string,
  tail: TailBatch,
): ApplyResult {
  return applyShippedTail(receiver, senderNodeId, tail, {
    envio: "terminal-state-wins",
    clash: "unisolated",
  });
}

function applyShippedTail(
  receiver: NodeDb,
  senderNodeId: string,
  tail: TailBatch,
  rules: ShipRules,
): ApplyResult {
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

    const insertEnvio = receiver.handle.prepare(ENVIO_UPSERT[rules.envio]);
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

    const insertSupplierInvoice = receiver.handle.prepare(CLASH_INSERT[rules.clash]);
    const invoiceHoldingPair = receiver.handle.prepare(
      `SELECT id FROM supplier_invoices WHERE supplier = ? AND invoice_number = ?`,
    );
    const invoiceById = receiver.handle.prepare(`SELECT id FROM supplier_invoices WHERE id = ?`);
    for (const row of tail.supplierInvoices) {
      if (row.node_id !== senderNodeId) {
        refusedForeign += 1;
        continue;
      }
      if (rules.clash !== "report-and-skip") {
        applied += changed(
          insertSupplierInvoice.run(row.id, row.node_id, row.supplier, row.invoice_number),
        );
        continue;
      }
      try {
        applied += changed(
          insertSupplierInvoice.run(row.id, row.node_id, row.supplier, row.invoice_number),
        );
      } catch (error) {
        // Classify by the ERROR before looking at the table: a refusal that is not a uniqueness
        // one — a NOT NULL value missing, a trigger's RAISE(ABORT) — is no clash, whatever rows
        // happen to sit there, and reading the table first would swallow it.
        if (!isUniquenessRefusal(error)) throw error;
        const holder = invoiceHoldingPair.get(row.supplier, row.invoice_number) as
          { id: string } | undefined;
        if (holder) {
          if (String(holder.id) !== row.id) skippedClashes.push(row);
          continue;
        }
        if (invoiceById.get(row.id)) continue;
        throw error;
      }
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

const fencedNodes = new WeakSet<NodeDb>();

export function fence(db: NodeDb): void {
  fencedNodes.add(db);
}

export type ReturnBatch = {
  records: RecordRow[];
  envios: EnvioRow[];
  returnedFromEnviando: number[];
};

/**
 *  - `full-state` — records after the receiver's reported head, EVERY `envios` row the sender
 *    holds for its chain, and each `enviando` row carried as `pendiente`.
 */
type ReturnRule = "full-state" | "missing-only" | "keeps-enviando";

function buildReturn(
  sender: NodeDb,
  reportedHeads: Readonly<Record<string, number>>,
  rule: ReturnRule,
): ReturnBatch {
  const head = Number(reportedHeads[sender.nodeId] ?? 0);
  const records = sender.handle
    .prepare(
      `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
       WHERE node_id = ? AND secuencia > ? ORDER BY secuencia`,
    )
    .all(sender.nodeId, head) as unknown as RecordRow[];
  const held = sender.handle
    .prepare(
      `SELECT node_id, secuencia, estado, acked FROM envios
       WHERE node_id = ? AND secuencia > ? ORDER BY secuencia`,
    )
    .all(sender.nodeId, rule === "missing-only" ? head : 0) as unknown as EnvioRow[];
  const returnedFromEnviando: number[] = [];
  const envios = held.map((row): EnvioRow => {
    const copy: EnvioRow = {
      node_id: String(row.node_id),
      secuencia: Number(row.secuencia),
      estado: row.estado,
      acked: Number(row.acked),
    };
    if (rule !== "keeps-enviando" && copy.estado === "enviando") {
      returnedFromEnviando.push(copy.secuencia);
      copy.estado = "pendiente";
    }
    return copy;
  });
  return {
    records: records.map((row) => ({
      node_id: String(row.node_id),
      secuencia: Number(row.secuencia),
      huella: String(row.huella),
      huella_anterior: row.huella_anterior === null ? null : String(row.huella_anterior),
      payload: String(row.payload),
    })),
    envios,
    returnedFromEnviando,
  };
}

export function buildReturnBatch(
  sender: NodeDb,
  reportedHeads: Readonly<Record<string, number>>,
): ReturnBatch {
  return buildReturn(sender, reportedHeads, "full-state");
}

export function buildReturnBatchMissingOnly(
  sender: NodeDb,
  reportedHeads: Readonly<Record<string, number>>,
): ReturnBatch {
  return buildReturn(sender, reportedHeads, "missing-only");
}

export function buildReturnBatchKeepsEnviando(
  sender: NodeDb,
  reportedHeads: Readonly<Record<string, number>>,
): ReturnBatch {
  return buildReturn(sender, reportedHeads, "keeps-enviando");
}

export function chainsOf(batch: ReturnBatch): string[] {
  return [...new Set([...batch.records, ...batch.envios].map((row) => row.node_id))].sort();
}

export function applyReturnBatch(
  receiver: NodeDb,
  senderNodeId: string,
  batch: ReturnBatch,
): ApplyResult {
  return applyTail(receiver, senderNodeId, {
    records: batch.records,
    envios: batch.envios,
    sales: [],
    saleLines: [],
    supplierInvoices: [],
  });
}

/**
 * `submit` stands in for the AEAT call. A throw returns the row to `pendiente`, so the pass records
 * a refusal rather than losing the row.
 */
export function drainPass(
  db: NodeDb,
  submit: (nodeId: string, secuencia: number) => void,
  paused: ReadonlySet<string> = new Set(),
): void {
  if (fencedNodes.has(db)) return;
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
    // `paused` is read per row, not copied at the top, so a pause lifted mid-pass takes effect for
    // the rows after it.
    if (blockedChains.has(nodeId) || paused.has(nodeId)) continue;
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
