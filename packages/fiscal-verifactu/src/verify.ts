import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { NodeId, TenantId } from "@waitron/shared";
import type { IntegrityIssue, IntegrityReport } from "@waitron/fiscal";
import { computeHuella, verifyHuella } from "@waitron/verifactu";
import { lockChainHead } from "./chain.js";
import { fromRegistroRow, type RegistroRow } from "./registro-row.js";

/**
 * Orden HAC/1177/2024 art. 7.i: before generating record n, verify that record n−1 is itself
 * correctly chained.
 *
 * Two checks, deliberately more than the letter of the rule:
 *
 *   1. AEAT's own: n−1's stored predecessor huella (`anterior_huella`) equals n−2's own huella —
 *      i.e. the predecessor really is chained onto what it claims to be chained onto.
 *   2. Ours: n−1's huella recomputes from n−1's own stored inputs. Free, since hashing is a pure
 *      function of values already read, and it catches tampering with n−1's content that check 1
 *      is structurally blind to (an edit to n−1's `importe_total` moves nothing that check 1 looks
 *      at). It does not extend to `Desglose`, which is not a huella input at all (huella.ts's
 *      `buildCadena` hashes exactly eight alta fields / five anulación fields) — an edit there is
 *      the immutability control's job (revoked UPDATE, trigger backstop), not this one's.
 *
 * NEVER throws on a verification failure. A throw here would propagate out of the sale
 * transaction and roll back the sale — exactly what AEAT forbids: «será preciso generar el
 * siguiente RF, ya que la facturación por este motivo NUNCA debe interrumpirse». Failures are
 * RETURNED as `{ ok: false, ... }` for the caller to record as an incident and carry on. An
 * earlier draft of this design had a verification failure halt the till; that was wrong in the
 * specific way that reads as caution, and this function's one job is not to repeat it. Genuine
 * database errors (a lost connection, a missing table) DO propagate — those are ordinary
 * operational failures and should stop a sale like any other failed write.
 *
 * Both start-of-chain states are normal, not failures, and are reflected in `checked` rather than
 * in `ok`: `checked: 0` when n is itself the first record (no predecessor, neither check runs),
 * `checked: 1` when n−1 carries `PrimerRegistro=S` (no n−2, so the link check is vacuously true
 * and only the recomputation applies), `checked: 2` once both n−1 and n−2 exist. The chain is
 * per-NODE (node-id rekey, 2026-08-03), so `checked: 0` is the genesis record of a node's chain —
 * the first sale ever recorded on a fresh node, whichever till rings it up — NOT every till's
 * first sale: a second till's first sale on the SAME node has a predecessor and is already
 * `checked: 1`/`2`. A verifier that reported `ok: false` on that genesis record would raise an
 * incident on the first record of every node's chain.
 */
export async function verifyChain(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<IntegrityReport> {
  // Under the same lock, in the same transaction, as the append that follows. Verifying a
  // predecessor another writer is concurrently replacing verifies nothing; re-acquiring the lock
  // inside appendToChain afterwards is free (chain.ts's own doc comment on lockChainHead).
  await lockChainHead(tx, tenantId, nodeId);

  // (tenant_id, node_id, secuencia) is already uniquely indexed (node-id rekey, 2026-08-03's
  // registros_tenant_node_secuencia_uq) — this is the same index, no new one. Ordered by chain
  // POSITION, never by invoice number: AEAT's own sample chains invoice 12345 to predecessor
  // invoice 44, so sorting on num_serie_factura would compare the wrong pair and report a failure
  // on an intact chain.
  const { rows } = await tx.execute<RegistroRow>(sql`
    select * from registros_facturacion
    where tenant_id = ${tenantId} and node_id = ${nodeId}
    order by secuencia desc
    limit 2
  `);

  const previous = rows[0];
  // n is itself the first record of the chain: no predecessor, neither check applies. Normal, not
  // a failure.
  if (previous === undefined) return { ok: true, checked: 0, issues: [] };

  const issues: IntegrityIssue[] = [];

  const rebuilt = fromRegistroRow(previous);
  if (!verifyHuella(rebuilt)) {
    issues.push({
      code: "predecessor-hash-mismatch",
      recordId: previous.id,
      // expected: what n−1's own stored content actually hashes to (the reference — this is what
      // a correct huella for this row's content IS). found: what is actually sitting in n−1's own
      // huella column, which may have been overwritten independently of its content.
      params: { expected: computeHuella(rebuilt), found: previous.huella },
    });
  }

  // n−1 opened the chain: there is no n−2, so the link check is vacuously true. Also normal — one
  // record examined, not two.
  if (previous.primer_registro) {
    return { ok: issues.length === 0, checked: 1, issues };
  }

  const beforePrevious = rows[1];
  if (beforePrevious === undefined) {
    // n−1 points at a predecessor that is not there. `params` is empty rather than carrying
    // undefined values — there is no pair to compare, so there is nothing to name as expected or
    // found. Only n−1 could be examined, so `checked` is 1.
    issues.push({ code: "predecessor-missing", recordId: previous.id, params: {} });
    return { ok: false, checked: 1, issues };
  }

  if (previous.anterior_huella !== beforePrevious.huella) {
    issues.push({
      code: "predecessor-link-mismatch",
      recordId: previous.id,
      // expected: n−2's own huella, read live off its row — the ground truth this check validates
      // the pointer against. found: what n−1's own stored predecessor pointer actually says, which
      // may not agree with it. No `?? ""` fallback needed: `previous.primer_registro` was already
      // false to reach this line, and registros_encadenamiento_ck (./schema/registros.ts)
      // guarantees `anterior_huella` is NOT NULL whenever that is the case. `params` is
      // `Record<string, unknown>` (packages/fiscal's own IntegrityIssue), so the `string | null`
      // static type here needs no cast either.
      params: { expected: beforePrevious.huella, found: previous.anterior_huella },
    });
  }

  return { ok: issues.length === 0, checked: 2, issues };
}
