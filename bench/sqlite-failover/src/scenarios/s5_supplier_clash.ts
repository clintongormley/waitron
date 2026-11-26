import assert from "node:assert";
import type { ScenarioResult } from "../scenarios.ts";
import {
  applyTail,
  applyTailSilentDrop,
  applyTailUnisolated,
  diffTail,
  openNode,
  recordSale,
  summarise,
} from "../model.ts";
import type {
  EnvioRow,
  NodeDb,
  RecordRow,
  SaleLineRow,
  SaleRow,
  SupplierInvoiceRow,
  TailBatch,
} from "../model.ts";

const CLASHING_SUPPLIER = "ACME";
const CLASHING_NUMBER = "INV-1";
const SALES = 3;

type Ship = {
  sender: NodeDb;
  receiver: NodeDb;
  senderId: string;
  tail: TailBatch;
  clashId: string;
  cleanId: string;
  receiverRowId: string;
};

function buildShip(slug: string, open: (nodeId: string) => NodeDb): Ship {
  const senderId = `${slug}-box`;
  const receiverId = `${slug}-cloud`;
  const sender = open(senderId);
  const receiver = open(receiverId);
  for (let cents = 0; cents < SALES; cents += 1) recordSale(sender, 100 + cents);

  const clashId = `${slug}-sender-clash`;
  const cleanId = `${slug}-sender-clean`;
  const receiverRowId = `${slug}-receiver-own`;
  insertInvoice(sender, clashId, senderId, CLASHING_SUPPLIER, CLASHING_NUMBER);
  insertInvoice(sender, cleanId, senderId, CLASHING_SUPPLIER, "INV-2");
  insertInvoice(receiver, receiverRowId, receiverId, CLASHING_SUPPLIER, CLASHING_NUMBER);

  const tail = diffTail(sender, summarise(receiver));
  assert.equal(tail.records.length, SALES, `${slug}: the tail carries every record appended`);
  assert.equal(tail.envios.length, SALES, `${slug}: the tail carries their submission rows`);
  assert.equal(tail.sales.length, SALES, `${slug}: the tail carries their sales`);
  assert.equal(tail.saleLines.length, SALES, `${slug}: the tail carries their sale lines`);
  assert.equal(tail.supplierInvoices.length, 2, `${slug}: the tail carries both supplier invoices`);

  return { sender, receiver, senderId, tail, clashId, cleanId, receiverRowId };
}

function insertInvoice(
  db: NodeDb,
  id: string,
  nodeId: string,
  supplier: string,
  invoiceNumber: string,
): void {
  db.handle
    .prepare(
      `INSERT INTO supplier_invoices (id, node_id, supplier, invoice_number) VALUES (?, ?, ?, ?)`,
    )
    .run(id, nodeId, supplier, invoiceNumber);
}

function countRows(db: NodeDb, sql: string, ...params: string[]): number {
  return Number(db.get<{ c: number }>(sql, ...params)?.c ?? -1);
}

function holdsInvoice(db: NodeDb, id: string): number {
  return countRows(db, `SELECT COUNT(*) c FROM supplier_invoices WHERE id = ?`, id);
}

type TailRows = {
  records: RecordRow[];
  envios: EnvioRow[];
  sales: SaleRow[];
  saleLines: SaleLineRow[];
  supplierInvoices: SupplierInvoiceRow[];
};

/**
 * The rows of a shipped tail the receiver now holds — the rows themselves, every column of them,
 * not how many there are. Counting would let a wrong value through: an apply that changed a sale's
 * total on the way in still lands one sale per sale shipped.
 */
function rowsHeldFrom(receiver: NodeDb, senderId: string): TailRows {
  return {
    records: receiver.all<RecordRow>(
      `SELECT node_id, secuencia, huella, huella_anterior, payload FROM records
       WHERE node_id = ? ORDER BY secuencia`,
      senderId,
    ),
    envios: receiver.all<EnvioRow>(
      `SELECT node_id, secuencia, estado, acked FROM envios WHERE node_id = ? ORDER BY secuencia`,
      senderId,
    ),
    sales: receiver.all<SaleRow>(
      `SELECT id, node_id, total_cents FROM sales WHERE node_id = ? ORDER BY id`,
      senderId,
    ),
    saleLines: receiver.all<SaleLineRow>(
      `SELECT id, sale_id, description, amount_cents FROM sale_lines
       WHERE sale_id IN (SELECT id FROM sales WHERE node_id = ?) ORDER BY id`,
      senderId,
    ),
    supplierInvoices: receiver.all<SupplierInvoiceRow>(
      `SELECT id, node_id, supplier, invoice_number FROM supplier_invoices
       WHERE node_id = ? ORDER BY id`,
      senderId,
    ),
  };
}

function rowsShipped(tail: TailBatch, clashId: string): TailRows {
  return {
    records: tail.records,
    envios: tail.envios,
    sales: tail.sales,
    saleLines: tail.saleLines,
    supplierInvoices: tail.supplierInvoices.filter((invoice) => invoice.id !== clashId),
  };
}

const NOTHING_APPLIED: TailRows = {
  records: [],
  envios: [],
  sales: [],
  saleLines: [],
  supplierInvoices: [],
};

/**
 * Every row of every model table, for comparing a database with itself after a second apply.
 *
 * Both the table list and each table's columns are asked of the database rather than written out
 * here, so a table added to the schema later is compared without anyone remembering to add it.
 */
function snapshot(db: NodeDb): string {
  const tables = db
    .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .map((row) => String(row.name));
  return tables
    .map((table) => {
      const order = db
        .all<{ name: string }>(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
        .map((column) => `"${String(column.name)}"`)
        .join(", ");
      return `${table}: ${JSON.stringify(db.all(`SELECT * FROM ${table} ORDER BY ${order}`))}`;
    })
    .join("\n");
}

export default async function supplierClash(): Promise<ScenarioResult> {
  const opened: NodeDb[] = [];
  const open = (nodeId: string): NodeDb => {
    const db = openNode(nodeId);
    opened.push(db);
    return db;
  };

  try {
    const ship = buildShip("s5", open);
    const { receiver, senderId, tail } = ship;
    const applied = applyTail(receiver, senderId, tail);

    assert.equal(applied.skippedClashes.length, 1, "exactly one row is reported as a clash");
    assert.equal(applied.skippedClashes[0]?.id, ship.clashId, "and it is the clashing row");
    assert.equal(applied.refusedForeign, 0, "nothing in the tail was refused as foreign");

    assert.equal(holdsInvoice(receiver, ship.clashId), 0, "the clashing row is not in the table");
    assert.equal(holdsInvoice(receiver, ship.cleanId), 1, "the sender's other invoice applied");

    // The receiver's own row is checked for its OWNER as well as its id: a branch that overwrote
    // the row with the sender's copy while keeping the receiver's id would pass an id-only check
    // having handed the row to the other node.
    const held = receiver.get<{ id: string; node_id: string }>(
      `SELECT id, node_id FROM supplier_invoices WHERE supplier = ? AND invoice_number = ?`,
      CLASHING_SUPPLIER,
      CLASHING_NUMBER,
    );
    assert.deepStrictEqual(
      { id: held?.id, node_id: held?.node_id },
      { id: ship.receiverRowId, node_id: receiver.nodeId },
      "the row the receiver already held is untouched, owner included",
    );

    assert.deepStrictEqual(
      rowsHeldFrom(receiver, senderId),
      rowsShipped(tail, ship.clashId),
      "every other row in the tail applied, with its values intact",
    );

    const before = snapshot(receiver);
    const retried = applyTail(receiver, senderId, tail);
    assert.equal(retried.skippedClashes.length, 1, "the retry reports the same one clash");
    assert.equal(retried.skippedClashes[0]?.id, ship.clashId, "and it is the same row");
    assert.equal(retried.applied, 0, "the retry changed no row");
    assert.equal(snapshot(receiver), before, "the retry left every table byte-identical");

    const dropped = buildShip("s5-drop", open);
    const droppedResult = applyTailSilentDrop(dropped.receiver, dropped.senderId, dropped.tail);
    assert.equal(
      droppedResult.skippedClashes.length,
      0,
      "control: the clash is dropped without a word",
    );
    const droppedClashRows = holdsInvoice(dropped.receiver, dropped.clashId);
    assert.equal(
      droppedClashRows,
      0,
      "control: and the row is not in the table either — it is simply lost",
    );
    const droppedHeld = rowsHeldFrom(dropped.receiver, dropped.senderId);
    assert.deepStrictEqual(
      droppedHeld,
      rowsShipped(dropped.tail, dropped.clashId),
      "control: the rest of the ship landed, which is why nothing looks wrong",
    );

    const lost = buildShip("s5-lost", open);
    let unisolatedRefusal = "nothing was thrown";
    assert.throws(
      () => applyTailUnisolated(lost.receiver, lost.senderId, lost.tail),
      (error: unknown) => {
        unisolatedRefusal = error instanceof Error ? error.message : String(error);
        return /UNIQUE constraint failed/.test(unisolatedRefusal);
      },
      "control: the clash is not caught, so it leaves the apply",
    );
    const lostHeld = rowsHeldFrom(lost.receiver, lost.senderId);
    assert.deepStrictEqual(
      lostHeld,
      NOTHING_APPLIED,
      "control: the whole ship was rolled back — no record, no sale, no line",
    );
    const lostCleanRows = holdsInvoice(lost.receiver, lost.cleanId);
    assert.equal(lostCleanRows, 0, "control: the clean invoice went down with it");
    assert.equal(
      holdsInvoice(lost.receiver, lost.receiverRowId),
      1,
      "control: the receiver keeps its own row, having written it before the ship",
    );

    // A refusal that is NOT about the invoice number has to leave the apply and take the batch with
    // it, whatever rows the receiver happens to hold. That is what the rule's error check is for,
    // and it is the case a rule reading only the table gets wrong: the receiver below already holds
    // the arriving row's id, which is exactly what a table-first reading calls a ship arriving twice.
    const refused = buildShip("s5-refused", open);
    insertInvoice(refused.receiver, refused.cleanId, refused.receiver.nodeId, "OTHER", "X-1");
    refused.receiver.exec(
      `CREATE TRIGGER refuse_one BEFORE INSERT ON supplier_invoices
       WHEN NEW.id = '${refused.cleanId}'
       BEGIN SELECT RAISE(ABORT, 'the receiver refuses this row for its own reasons'); END`,
    );
    let otherRefusal = "nothing was thrown";
    assert.throws(
      () => applyTail(refused.receiver, refused.senderId, refused.tail),
      (error: unknown) => {
        otherRefusal = error instanceof Error ? error.message : String(error);
        return /refuses this row for its own reasons/.test(otherRefusal);
      },
      "a refusal that is not about uniqueness leaves the apply instead of being read as a clash",
    );
    const refusedHeld = rowsHeldFrom(refused.receiver, refused.senderId);
    assert.deepStrictEqual(
      refusedHeld,
      NOTHING_APPLIED,
      "and it takes the batch with it — none of the ship was applied",
    );

    return {
      id: "S5",
      title: "supplier-invoice clash reported and skipped, ship otherwise intact",
      verdict: "PASS",
      critical: false,
      detail:
        `applied=${applied.applied} clashes=${applied.skippedClashes.length} ` +
        `retry-applied=${retried.applied} retry-clashes=${retried.skippedClashes.length}; ` +
        `silent-drop: clashes=${droppedResult.skippedClashes.length} ` +
        `clash-rows-held=${droppedClashRows} ` +
        `records-held=${droppedHeld.records.length}/${dropped.tail.records.length}; ` +
        `unisolated: refused="${unisolatedRefusal}" ` +
        `records-held=${lostHeld.records.length}/${lost.tail.records.length} ` +
        `sales-held=${lostHeld.sales.length}/${lost.tail.sales.length} ` +
        `clean-invoice-rows-held=${lostCleanRows}; ` +
        `not-a-uniqueness-refusal: refused="${otherRefusal}" ` +
        `records-held=${refusedHeld.records.length}/${refused.tail.records.length}`,
    };
  } finally {
    for (const db of opened) db.close();
  }
}
