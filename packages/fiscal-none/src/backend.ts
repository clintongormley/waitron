import type {
  FiscalBackend,
  FiledReceipt,
  FiscalRecordRef,
  IntegrityReport,
  NodeRegistration,
  SaleForFiscalRecord,
} from "@waitron/fiscal";
import type { NodeId, SaleId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";

/**
 * The no-regime backend: a venue under no fiscal obligation. Every method is a pure no-op that
 * writes NOTHING — no tables, no chain, no submission — and returns the empty shape the interface
 * demands.
 *
 * Methods declare only the parameters they use and drop the rest: a no-op needs none of its
 * inputs, and TypeScript's structural typing lets a method with fewer parameters satisfy the
 * interface's fuller signature. The `_tx` retained on the write methods is the interface's leading
 * transaction handle, kept (though unused) so a reader sees these are the same write seam the real
 * regime uses — the none backend simply has nothing to write into it.
 *
 * `state: "recorded"` is deliberate, not a placeholder: the state means "the legally-required
 * record exists locally", which for a venue with no fiscal regime is vacuously true. Reporting it
 * as recorded lets the generic sale path treat a none sale exactly like any other — no branch on
 * the regime — which is the whole point of the swappable slot.
 */
export class NoneBackend implements FiscalBackend {
  readonly id = "none";

  registerNode(_tx: Transaction, nodeId: NodeId): Promise<NodeRegistration> {
    return Promise.resolve({
      backend: "none",
      nodeId,
      registrationId: "",
      registeredAt: new Date(),
    });
  }

  recordSale(_tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    return Promise.resolve(this.recordedRef(sale));
  }

  recordVoid(_tx: Transaction, saleId: SaleId): Promise<FiscalRecordRef> {
    // A void carries no SaleForFiscalRecord — only the annulled sale's id — and the none backend
    // reads nothing back, so it has no issued instant to echo: `now` and a zero offset stand in for
    // a value that pins nothing here.
    const now = new Date();
    return Promise.resolve({
      backend: "none",
      recordId: saleId,
      state: "recorded",
      issuedAt: now,
      offsetMinutes: 0,
      verificationUrl: undefined,
    });
  }

  recordCorrection(_tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    return Promise.resolve(this.recordedRef(sale));
  }

  recordSubstitution(_tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    return Promise.resolve(this.recordedRef(sale));
  }

  filedReceiptFor(): Promise<FiledReceipt | undefined> {
    return Promise.resolve(undefined);
  }

  checkIntegrity(): Promise<IntegrityReport> {
    return Promise.resolve({ ok: true, checked: 0, issues: [] });
  }

  pendingCount(): Promise<number> {
    return Promise.resolve(0);
  }

  /** The recorded ref for a sale-shaped input: its own id and instants, no verification link. */
  private recordedRef(sale: SaleForFiscalRecord): FiscalRecordRef {
    return {
      backend: "none",
      recordId: sale.saleId,
      state: "recorded",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: undefined,
    };
  }
}
