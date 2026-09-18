// S5: the one clash the design still resolves by a person looking at it — the same supplier invoice
// number typed on both nodes while they are apart (spec §4, S5). When A's tail is shipped to B that
// row cannot be applied: B already holds that (supplier, invoice number) pair under a different id.
//
// What this scenario measures is what happens to the REST of the ship. The clashing row must be
// named in the apply's result and left out of the table, and everything else in the tail — the
// ledger records, their submission rows, the sales, the sale lines and the sender's other supplier
// invoice — must land as if the clash had never been in the batch. Then the same tail is shipped
// again, because a ship is retried whenever its confirmation is lost.
//
// Spec §4's S5 rules out three outcomes in one line: the clashing row must be "not applied, not
// silently dropped, not crashing the whole ship". The first is what the assertions below check
// directly; the other two get a control each, both `ClashRule` settings of the same apply
// (`src/model.ts`). `silent-drop` reproduces a row silently dropped, `unisolated` a refusal that
// crashes the whole ship.
//
// Everything here is the rig's MODEL of the ledger (`src/model.ts`); no result here is a statement
// about `packages/fiscal-verifactu`. What this scenario's runs establish, and the savepoint the
// apply turns out not to need, are in the README section "What S5 measures, and the savepoint it
// does not need".
//
// Like S2 and unlike the rest, this scenario takes no `ScenarioContext`: the ship it models happens
// between two in-memory SQLite databases, so it starts no MinIO container and opens no object store.
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

/** The pair typed on both nodes while they were apart. */
const CLASHING_SUPPLIER = "ACME";
const CLASHING_NUMBER = "INV-1";
/** How many sales the sender records before the ship, so the tail carries more than invoices. */
const SALES = 3;

type Ship = {
  sender: NodeDb;
  receiver: NodeDb;
  senderId: string;
  tail: TailBatch;
  /** The sender row whose (supplier, invoice number) the receiver already holds under another id. */
  clashId: string;
  /** The sender's other supplier invoice, which nothing on the receiver conflicts with. */
  cleanId: string;
  /** The receiver's own row for the clashing pair. */
  receiverRowId: string;
};

/**
 * Two nodes that both typed the same supplier invoice number while apart, and A's tail ready to
 * ship. `slug` names every node and every row, so a control's rows can never be read as the real
 * run's.
 */
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

  // A real diff of a real tail, not a hand-built batch: "everything else applied" is only worth
  // asserting over the rows a ship would actually carry.
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
 *
 * Each read is ordered the way `diffTail` orders the tail it builds, because SQLite promises no row
 * order and two lists differing only in order would read as a difference.
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

/**
 * The same five lists as the sender shipped them, to compare the receiver's rows against, minus
 * `clashId` — the one row the apply is expected to leave out of the table. Every other shipped
 * supplier invoice is expected there in full, which is what makes this the check on the table S5
 * exists for rather than a count of it.
 */
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
 * Rows are ordered by every column the table has: SQLite promises no row order, and a snapshot
 * differing only in row order would read as a change. `ORDER BY 1, 2` would say that shorter and
 * would hold only for tables of two columns or more — asked for it over a one-column table, SQLite
 * 3.53.4 under node v26.7.0 answered "2nd ORDER BY term out of range - should be between 1 and 1".
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

    // Everything else in the tail landed, and landed unaltered: the rows the receiver holds are
    // compared field by field with the rows the sender shipped — the supplier invoices among them,
    // minus the clashing row — so a value changed on the way in fails here rather than passing as
    // one more row.
    assert.deepStrictEqual(
      rowsHeldFrom(receiver, senderId),
      rowsShipped(tail, ship.clashId),
      "every other row in the tail applied, with its values intact",
    );

    // The retry. The clash is reported again, being still a clash, and nothing else moves. An apply
    // treating every refused insert as a clash would report the clean invoice here too, its id
    // being held already.
    const before = snapshot(receiver);
    const retried = applyTail(receiver, senderId, tail);
    assert.equal(retried.skippedClashes.length, 1, "the retry reports the same one clash");
    assert.equal(retried.skippedClashes[0]?.id, ship.clashId, "and it is the same row");
    assert.equal(retried.applied, 0, "the retry changed no row");
    assert.equal(snapshot(receiver), before, "the retry left every table byte-identical");

    // CONTROL A — the plain `ON CONFLICT DO NOTHING` write. It reproduces the failure spec §4's S5
    // rules out with "not silently dropped": the ship survives, so every assertion above about the
    // rest of the tail is green here too, and what is gone is the report. Nobody is told a row was
    // lost, and the row is in neither the table nor the result.
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

    // CONTROL B — the same insert with nothing catching its refusal. It reproduces the failure the
    // same spec line rules out with "not crashing the whole ship": one clashing row costs the whole
    // batch, the apply throws, and the receiver is left holding none of the tail, records and sales
    // included.
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
    //
    // The refusal is a trigger's RAISE(ABORT) — the same device the model already uses to stand in
    // for the real ledger's append-only defence. A BEFORE INSERT trigger fires ahead of the primary
    // key check, so the row is refused for a reason that has nothing to do with uniqueness:
    // measured on SQLite 3.53.4 (`process.versions.sqlite` under node v26.7.0), inserting a held id
    // against such a trigger gave errcode 1811 and the trigger's own message, not the 1555 a
    // primary key gives. The receiver's own row goes in BEFORE the trigger is created, or the
    // trigger refuses that insert too.
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
