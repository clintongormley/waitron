// Registers this package's own error codes on the shared registry.
import "./errors.js";
import { sql } from "drizzle-orm";
import { readTenant, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recipientIdentifierResult } from "@waitron/country-packs";
import { AppError, decimal, readSaleOrigin, sumDecimals } from "@waitron/shared";
import type { NodeId, SaleId } from "@waitron/shared";
import type {
  AuthorityTimeSample,
  ClockBehindLatestRecord,
  ClockCheckCloseRequest,
  ClockCheckOpenRequest,
  ClockConfirmation,
  ClockConfirmRequest,
  ClockStepRecorded,
  ClockStepRequest,
  ClockProvedWrong,
  ClockStopState,
  ClockWitness,
  Counterparty,
  FiscalBackend,
  FiledReceipt,
  FiscalRecordRef,
  IntegrityReport,
  MisdatedDetail,
  MisdatedRecords,
  NodeRegistration,
  ReceiptQrText,
  SaleForFiscalRecord,
  TrustedClock,
  VatBreakdownLine,
  WaitingClockCheck,
} from "@waitron/fiscal";
import { formatInvoiceNumber } from "@waitron/core";
import { buildQrPayload } from "@waitron/verifactu";
import type {
  AltaInput,
  AnulacionInput,
  Destinatario,
  DetalleDesgloseInput,
  Environment,
  IDFacturaARInput,
  RegistroAlta,
  SistemaInformatico,
  VerifactuClient,
} from "@waitron/verifactu";
import { appendToChain } from "./chain.js";
import { currentSif } from "./registro-sif.js";
import type { SifRegistration } from "./registro-sif.js";
import { decodeRegistroRow, fromRegistroRow } from "./registro-row.js";
import type { Entorno, RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { verifyChain } from "./verify.js";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import {
  clockBehindChain,
  refuseWhileClockBehind as refuseWhileClockBehindChain,
} from "./clock-behind.js";
import { closeClockCheckByItself, openClockCheck, waitingClockCheck } from "./clock-checks.js";
import { clockStopState, confirmClockStop, noteClockProvedWrong } from "./clock-confirmation.js";
import { confirmClockStep } from "./clock-step.js";
import { misdatedDetail, misdatedRecords } from "./clock-misdated.js";
import { readAuthorityTime } from "./authority-time.js";
import { NOMBRE_RAZON_MAX } from "./venue-fields.js";
import { SOFTWARE_IDENTITY, producerFields, softwareVersion } from "./software-identity.js";
import type { SoftwareIdentity } from "./software-identity.js";

/** `FiscalRecordRef.backend`/`NodeRegistration.backend` — the regime-neutral interface's own
 * "which module produced this" tag. */
const BACKEND_ID = "verifactu";

/** The owner's €3,000 (A741), inside the validator's `F2_AMOUNT_LIMIT` (3,010.00 with its
 * tolerance); ./record-limits.test.ts checks it. */
const SIMPLIFIED_INVOICE_LIMIT = decimal("3000.00");

export interface VerifactuBackendOptions {
  /**
   * Used ONLY by `pendingCount` and `recordVoid`. `recordSale` is handed its caller's instant and
   * must not read the clock a second time.
   */
  clock: TrustedClock;
  /** The connection `pendingCount` queries against — the one `FiscalBackend` method with no `tx`
   * parameter at all, so it cannot participate in a caller's transaction. */
  db: Database;
  /**
   * Accepted but NOT consumed by this class: nothing on the sale path contacts AEAT. Submission is
   * the standalone `drain` (`./drain.ts`).
   */
  resolveClient: () => Promise<VerifactuClient>;
  /** Which QR validation host to build `verificationUrl`-shaped URLs against. Defaults to
   * `"production"`. */
  environment?: Environment;
  /**
   * Which DEPLOYMENT this backend is generating registros for, stamped onto every registro's own
   * `entorno` so `drain` can refuse to submit a record generated for the other deployment. Not the
   * `environment` above, which picks a QR validation host. REQUIRED: a default would silently
   * mis-stamp every registro from a host that forgot to set it.
   */
  deploymentEnvironment: Entorno;
  /** Tests only; production passes none (./slot.ts). */
  identity?: SoftwareIdentity;
  /** Accepted but NOT consumed by this class: the skip-retry cadence belongs to the standalone
   * `drain` (`DrainDeps.skipRetryMs`). */
  skipRetryMs?: number;
}

/** The columns `recordVoid` reads off the alta it voids. */
type OriginalAlta = Pick<
  RegistroRow,
  | "source"
  | "device_id"
  | "node_id"
  | "id_emisor_factura"
  | "num_serie_factura"
  | "fecha_expedicion_factura"
>;

/**
 * The columns `recordCorrection` reads off the alta being corrected. Narrower than `OriginalAlta`
 * in one axis and wider in another: no origin (the corrective's OWN `sale` carries it, unlike a
 * void which must recover it), but `tipo_factura` too — the R-type is derived
 * from it (F2 → R5), so it is read here rather than assumed. The three identity columns feed
 * `FacturasRectificadas` directly, the same shortcut `recordVoid` takes for the anulada identity.
 */
type OriginalAltaForCorrection = Pick<
  RegistroRow,
  "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura" | "tipo_factura"
>;

/**
 * One filed VAT line. "S1" is sujeta y no exenta, sin inversión del sujeto pasivo, the ordinary
 * domestic sale; a rectificativa por diferencias files the same shape with negative figures. No
 * exempt, reverse-charge or recargo de equivalencia line is filed today. `Impuesto` is omitted,
 * which AEAT reads as IVA, and IVA requires a regime: "01" is the general regime (AEAT
 * validation §3.1.3.15.6, enforced by `@waitron/verifactu` from 0.2.0). Not a huella input.
 */
function toDetalleDesglose(line: VatBreakdownLine): DetalleDesgloseInput {
  return {
    ClaveRegimen: "01",
    CalificacionOperacion: "S1",
    BaseImponibleOimporteNoSujeto: line.base,
    TipoImpositivo: line.rate,
    CuotaRepercutida: line.tax,
  };
}

/**
 * The real Veri*Factu `FiscalBackend`. Every record method builds its registro through
 * `appendToChain`, which computes the huella and advances the chain head, then inserts a
 * `pendiente` `envios` row — all on the caller's transaction. Nothing here contacts AEAT.
 */
export class VerifactuBackend implements FiscalBackend {
  readonly id = BACKEND_ID;

  /**
   * Both fixed and never translated: the caption is AEAT's (its QR specification v0.5.0, §3) and
   * the legend is the law's (Orden HAC/1177/2024 art. 20.1.b).
   */
  readonly receiptQrText: ReceiptQrText = { caption: "QR tributario:", legend: "VERI*FACTU" };

  readonly simplifiedInvoiceLimit = SIMPLIFIED_INVOICE_LIMIT;
  readonly recipientNameMaxLength = NOMBRE_RAZON_MAX;

  private readonly db: Database;
  private readonly clock: TrustedClock;
  private readonly environment: Environment;
  private readonly deploymentEnvironment: Entorno;
  private readonly identity: SoftwareIdentity;

  constructor(options: VerifactuBackendOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.environment = options.environment ?? "production";
    this.deploymentEnvironment = options.deploymentEnvironment;
    this.identity = options.identity ?? SOFTWARE_IDENTITY;
  }

  assertRecordableAt(reading: { instant: Date; offsetMinutes: number }): void {
    refuseBeforeFirstIssueDate(reading);
  }

  clockBehindLatestRecord(
    tx: Transaction,
    reading: { instant: Date; offsetMinutes: number },
  ): Promise<ClockBehindLatestRecord | null> {
    return clockBehindChain(tx, reading);
  }

  refuseWhileClockBehind(
    tx: Transaction,
    reading: { instant: Date; offsetMinutes: number },
  ): Promise<void> {
    return refuseWhileClockBehindChain(tx, reading);
  }

  clockStopState(
    tx: Transaction,
    reading: { instant: Date; offsetMinutes: number },
    witnesses: readonly ClockWitness[],
  ): Promise<ClockStopState | null> {
    return clockStopState(tx, reading, witnesses);
  }

  confirmClockStop(
    tx: Transaction,
    input: ClockConfirmRequest,
  ): Promise<{ confirmation: ClockConfirmation | null }> {
    return confirmClockStop(tx, input);
  }

  confirmClockStep(tx: Transaction, input: ClockStepRequest): Promise<ClockStepRecorded> {
    return confirmClockStep(tx, input);
  }

  openClockCheck(tx: Transaction, input: ClockCheckOpenRequest): Promise<{ id: string } | null> {
    return openClockCheck(tx, input);
  }

  closeClockCheckByItself(
    tx: Transaction,
    input: ClockCheckCloseRequest,
  ): Promise<{ confirmation: ClockConfirmation | null }> {
    return closeClockCheckByItself(tx, input);
  }

  waitingClockCheck(
    tx: Transaction,
    reading: { instant: Date; offsetMinutes: number },
  ): Promise<WaitingClockCheck | null> {
    return waitingClockCheck(tx, reading);
  }

  misdatedRecords(tx: Transaction, confirmationId: string): Promise<MisdatedRecords | null> {
    return misdatedRecords(tx, confirmationId);
  }

  misdatedDetail(tx: Transaction, confirmationId: string): Promise<MisdatedDetail | null> {
    return misdatedDetail(tx, confirmationId);
  }

  noteClockProvedWrong(
    tx: Transaction,
    input: ClockProvedWrong,
  ): Promise<{ recorded: string[]; unused: string[]; held: string[] }> {
    return noteClockProvedWrong(tx, input);
  }

  readAuthorityTime(): Promise<AuthorityTimeSample | null> {
    return readAuthorityTime(this.deploymentEnvironment);
  }

  /**
   * Confirms — rather than performs — a node's Veri*Factu provisioning. The generic signature
   * carries no NIF and no `IdSistemaInformatico`, so it cannot mint a SIF identity; it reads back
   * what `registerSif` (`./registro-sif.ts`) established, and `currentSif` throws
   * `sif.not_registered` when there is none.
   */
  async registerNode(tx: Transaction, nodeId: NodeId): Promise<NodeRegistration> {
    const sif = await currentSif(tx, nodeId);
    return {
      backend: this.id,
      nodeId,
      registrationId: `${sif.nif}/${sif.idSistemaInformatico}/${String(sif.numeroInstalacion)}`,
      registeredAt: sif.registradoEn,
    };
  }

  /**
   * Builds the registro via `appendToChain`, inserts it, advances the chain head, and inserts the
   * `envios` row as `pendiente`, all on the caller's own transaction — the atomicity
   * `packages/core`'s `recordSale` depends on.
   *
   * Reads NO clock of its own: `sale.issuedAt`/`sale.offsetMinutes` are the reading the caller
   * took for the sale row, so the sale and its fiscal record carry one instant.
   */
  async recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    const sif = await currentSif(tx, sale.nodeId);
    const tenant = await this.taxpayer(tx);

    const desglose = sale.vatBreakdown.map(toDetalleDesglose);
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));

    // Postal country does not determine the identifier type or its issuing country.
    const destinatarios =
      sale.counterparty !== null ? this.buildDestinatarios(sale.counterparty) : undefined;

    const input: Omit<AltaInput, "Encadenamiento"> = {
      IDEmisorFactura: sif.nif,
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      // "F2" (factura simplificada) when no recipient is named, "F1" (factura completa) when one
      // is. `packages/core`'s `record-sale.ts` passes `counterparty: null`, so every sale it files
      // today is an F2.
      TipoFactura: sale.counterparty === null ? "F2" : "F1",
      Destinatarios: destinatarios,
      DescripcionOperacion: sale.descriptionOfOperation,
      Desglose: desglose,
      CuotaTotal: cuotaTotal,
      ImporteTotal: sale.total,
      SistemaInformatico: this.buildSistemaInformatico(sif, {
        legalName: tenant.legalName,
        nif: sif.nif,
      }),
      generadoEn: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      sale.nodeId,
      {
        tipo: "alta",
        saleId: sale.saleId,
        origin: sale.origin,
        entorno: this.deploymentEnvironment,
        input,
      },
      sif,
    );

    // Every column's default: `pendiente`, nothing sent.
    await tx.insert(envios).values({ registroId: appended.id });

    return {
      backend: this.id,
      recordId: appended.id,
      state: "pending",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: await this.qrPayloadFor(tx, appended.id),
    };
  }

  /**
   * Derives the QR payload from the registro's own STORED columns, never from in-memory values, so
   * a reprint derives the same payload from what was persisted.
   */
  private async qrPayloadFor(tx: Transaction, registroId: string): Promise<string> {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      select * from registros_facturacion where id = ${registroId}
    `);
    const row = rows[0];
    /* v8 ignore start */
    if (row === undefined) {
      // Structurally unreachable: `registroId` is the id `appendToChain` just returned from its
      // own successful insert, on this same transaction.
      throw new Error(`VerifactuBackend: no registro found for ${registroId}`);
    }
    /* v8 ignore stop */
    // Only ever called with the id of an alta this class just inserted.
    return buildQrPayload(
      fromRegistroRow(decodeRegistroRow<RegistroRow>(row)) as RegistroAlta,
      this.environment,
    );
  }

  /** Read the sale's original alta so a receipt repeats its filed issuer, QR and exact VAT amounts.
   * Later void records share the sale id but do not replace those original document facts. */
  async filedReceiptFor(tx: Transaction, saleId: SaleId): Promise<FiledReceipt | undefined> {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      select *
      from registros_facturacion
      where sale_id = ${saleId} and tipo_registro = 'alta'
      limit 1
    `);
    const raw = rows[0];
    if (raw === undefined) {
      return undefined;
    }
    const row = decodeRegistroRow<RegistroRow>(raw);

    const verificationUrl = buildQrPayload(fromRegistroRow(row) as RegistroAlta, this.environment);

    // Inverts the `vatBreakdown` → `Desglose` mapping the record methods write. Every alta filed
    // today is an S1 line with base, rate and cuota present and no recargo, hence the casts; a
    // future exempt or recargo line extends this beside the write side that produces it.
    const desglose = row.desglose as RegistroAlta["Desglose"];
    const vatBreakdown: VatBreakdownLine[] = desglose.map((detalle) => ({
      rate: decimal(detalle.TipoImpositivo as string),
      base: decimal(detalle.BaseImponibleOimporteNoSujeto),
      tax: decimal(detalle.CuotaRepercutida as string),
    }));

    return {
      verificationUrl,
      vatBreakdown,
      issuer: { legalName: row.nombre_razon_emisor, taxId: row.id_emisor_factura },
    };
  }

  /** Voids a previously recorded sale by appending an anulación referencing its identity. */
  async recordVoid(tx: Transaction, saleId: SaleId, reason: string): Promise<FiscalRecordRef> {
    // AEAT's `RegistroAnulacion` has no free-text field, so `reason` is not filed.
    void reason;

    const { rows } = await tx.execute<OriginalAlta>(sql`
      select source, device_id, node_id, id_emisor_factura, num_serie_factura,
        fecha_expedicion_factura
      from registros_facturacion
      where sale_id = ${saleId} and tipo_registro = 'alta'
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }

    // The anulación extends the ORIGINAL's chain, keyed by its node, and inherits its origin.
    const origin = readSaleOrigin(original.source, original.device_id);
    const nodeId = original.node_id as NodeId;
    const sif = await currentSif(tx, nodeId);
    const tenant = await this.taxpayer(tx);
    const now = this.clock.now();

    const input: Omit<AnulacionInput, "Encadenamiento"> = {
      IDEmisorFacturaAnulada: original.id_emisor_factura,
      NumSerieFacturaAnulada: original.num_serie_factura,
      // The original's stored calendar day, reconstructed EXACTLY for any offset `formatDate`
      // accepts. The `date` column dropped the offset that produced it, and the record builder
      // renders this Date shifted by `offsetMinutes` — which must be `now.offsetMinutes` for
      // `FechaHoraHusoGenRegistro`. Anchoring at midnight UTC minus that same shift cancels it.
      FechaExpedicionFacturaAnulada: new Date(
        Date.parse(`${original.fecha_expedicion_factura}T00:00:00Z`) - now.offsetMinutes * 60_000,
      ),
      SistemaInformatico: this.buildSistemaInformatico(sif, {
        legalName: tenant.legalName,
        nif: sif.nif,
      }),
      generadoEn: now.instant,
      offsetMinutes: now.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      nodeId,
      {
        tipo: "anulacion",
        saleId,
        origin,
        entorno: this.deploymentEnvironment,
        nombreRazonEmisor: tenant.legalName,
        input,
      },
      sif,
    );

    await tx.insert(envios).values({ registroId: appended.id });

    return {
      backend: this.id,
      recordId: appended.id,
      state: "pending",
      issuedAt: now.instant,
      offsetMinutes: now.offsetMinutes,
    };
  }

  /**
   * Records a rectificativa (credit note) for a prior sale — a hybrid of `recordSale` (it assembles
   * an `AltaInput` from the corrective's OWN `sale`: its new number, its negative total and
   * breakdown) and `recordVoid` (it reads the ORIGINAL alta registro to point at). A rectificativa
   * is an alta, NOT an anulación: it takes the next `secuencia`, hashes its own huella over the same
   * eight fields (`TipoFactura = R5` and the negative `ImporteTotal`/`CuotaTotal` flow in), and gets
   * its own `pendiente` sidecar.
   *
   * `entorno` travels BESIDE `input` in the `PendingRegistro`, never inside it, so our own metadata
   * never reaches `computeHuella`.
   */
  async recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId },
  ): Promise<FiscalRecordRef> {
    const { rows } = await tx.execute<OriginalAltaForCorrection>(sql`
      select id_emisor_factura, num_serie_factura, fecha_expedicion_factura, tipo_factura
      from registros_facturacion
      where sale_id = ${correction.correctsSaleId} and tipo_registro = 'alta'
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId: correction.correctsSaleId });
    }
    // Only a simplified F2 is corrected (→ R5). Rectifying an F1 is an R1, deferred until B2B F1
    // issuance lands, so refuse rather than file a mis-typed record that cannot be repaired.
    if (original.tipo_factura !== "F2") {
      throw new AppError("fiscal.correction_unsupported", {
        saleId: correction.correctsSaleId,
        // Non-null on every alta; only an anulación stores NULL.
        tipoFactura: original.tipo_factura as string,
      });
    }

    const sif = await currentSif(tx, sale.nodeId);
    const tenant = await this.taxpayer(tx);

    const desglose = sale.vatBreakdown.map(toDetalleDesglose);
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));

    const input: Omit<AltaInput, "Encadenamiento"> = {
      IDEmisorFactura: sif.nif,
      // The corrective's OWN new number and date: a rectificativa is a new invoice.
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      TipoFactura: "R5",
      // "I" (por diferencias). "S" (sustitución) would additionally require ImporteRectificacion
      // (AEAT rule 1118).
      TipoRectificativa: "I",
      FacturasRectificadas: [
        {
          IDEmisorFactura: original.id_emisor_factura,
          NumSerieFactura: original.num_serie_factura,
          // The same offset cancellation as `recordVoid`'s `FechaExpedicionFacturaAnulada`.
          FechaExpedicionFactura: new Date(
            Date.parse(`${original.fecha_expedicion_factura}T00:00:00Z`) -
              sale.offsetMinutes * 60_000,
          ),
        },
      ],
      DescripcionOperacion: sale.descriptionOfOperation,
      Desglose: desglose,
      CuotaTotal: cuotaTotal,
      ImporteTotal: sale.total,
      SistemaInformatico: this.buildSistemaInformatico(sif, {
        legalName: tenant.legalName,
        nif: sif.nif,
      }),
      generadoEn: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      sale.nodeId,
      {
        tipo: "alta",
        saleId: sale.saleId,
        origin: sale.origin,
        entorno: this.deploymentEnvironment,
        input,
      },
      sif,
    );

    await tx.insert(envios).values({ registroId: appended.id });

    return {
      backend: this.id,
      recordId: appended.id,
      state: "pending",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: await this.qrPayloadFor(tx, appended.id),
    };
  }

  /**
   * Records an F3 canje — a full invoice issued in substitution of one or more prior SIMPLIFIED
   * tickets (F2), at a customer's later request. An F3 is an alta, NOT a rectificativa and NOT an
   * anulación: it takes the next `secuencia`, hashes its own huella, and gets its own `pendiente`
   * sidecar.
   *
   * The substituted tickets' own altas are ONLY READ — never rewritten, never annulled. The F3's
   * `FacturasSustituidas` block is what tells AEAT the amount was already declared when the tickets
   * were issued, so it is not counted twice.
   *
   * `entorno` travels BESIDE `input`, never inside it, so our own metadata never reaches
   * `computeHuella`.
   */
  async recordSubstitution(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    substitution: { substitutedSaleIds: SaleId[] },
  ): Promise<FiscalRecordRef> {
    // Checked here as well as by the caller: a wrong filing is unrepairable.
    if (substitution.substitutedSaleIds.length === 0) {
      throw new Error(
        "VerifactuBackend.recordSubstitution: substitutedSaleIds must not be empty — an F3 must name at least one ticket it substitutes",
      );
    }
    if (new Set(substitution.substitutedSaleIds).size !== substitution.substitutedSaleIds.length) {
      throw new Error(
        "VerifactuBackend.recordSubstitution: substitutedSaleIds must not contain duplicates — a ticket may be substituted at most once per F3",
      );
    }
    // A full invoice must ALWAYS name its recipient. Destructured so the narrowing survives the
    // awaits below.
    const { counterparty } = sale;
    if (counterparty === null) {
      throw new Error(
        "VerifactuBackend.recordSubstitution: an F3 must name its recipient, but the sale carried no counterparty",
      );
    }
    // Built before the ledger reads, so an unsupported recipient is refused up front.
    const destinatarios = this.buildDestinatarios(counterparty);

    const substituidas: IDFacturaARInput[] = [];
    for (const substitutedSaleId of substitution.substitutedSaleIds) {
      const { rows } = await tx.execute<OriginalAltaForCorrection>(sql`
        select id_emisor_factura, num_serie_factura, fecha_expedicion_factura, tipo_factura
        from registros_facturacion
        where sale_id = ${substitutedSaleId} and tipo_registro = 'alta'
        limit 1
      `);
      const original = rows[0];
      if (original === undefined) {
        throw new AppError("fiscal.sale_not_recorded", { saleId: substitutedSaleId });
      }
      // A canje exchanges simplified tickets only (F2 → F3).
      if (original.tipo_factura !== "F2") {
        throw new AppError("fiscal.substitution_unsupported", {
          saleId: substitutedSaleId,
          // Non-null on every alta; only an anulación stores NULL.
          tipoFactura: original.tipo_factura as string,
        });
      }
      substituidas.push({
        IDEmisorFactura: original.id_emisor_factura,
        NumSerieFactura: original.num_serie_factura,
        // The same offset cancellation as `recordVoid`'s `FechaExpedicionFacturaAnulada`.
        FechaExpedicionFactura: new Date(
          Date.parse(`${original.fecha_expedicion_factura}T00:00:00Z`) -
            sale.offsetMinutes * 60_000,
        ),
      });
    }

    const sif = await currentSif(tx, sale.nodeId);
    const tenant = await this.taxpayer(tx);

    const desglose = sale.vatBreakdown.map(toDetalleDesglose);
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));

    const input: Omit<AltaInput, "Encadenamiento"> = {
      IDEmisorFactura: sif.nif,
      // The F3's OWN new number and date: a canje is a new full invoice.
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      TipoFactura: "F3",
      FacturasSustituidas: substituidas,
      Destinatarios: destinatarios,
      DescripcionOperacion: sale.descriptionOfOperation,
      Desglose: desglose,
      CuotaTotal: cuotaTotal,
      ImporteTotal: sale.total,
      SistemaInformatico: this.buildSistemaInformatico(sif, {
        legalName: tenant.legalName,
        nif: sif.nif,
      }),
      generadoEn: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      sale.nodeId,
      {
        tipo: "alta",
        saleId: sale.saleId,
        origin: sale.origin,
        entorno: this.deploymentEnvironment,
        input,
      },
      sif,
    );

    await tx.insert(envios).values({ registroId: appended.id });

    return {
      backend: this.id,
      recordId: appended.id,
      state: "pending",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: await this.qrPayloadFor(tx, appended.id),
    };
  }

  /** Delegates to `verifyChain` (art. 7.i), on the node whose chain the caller is about to extend. */
  async checkIntegrity(tx: Transaction, nodeId: NodeId): Promise<IntegrityReport> {
    return verifyChain(tx, nodeId);
  }

  /**
   * How many of this node's records AEAT has not yet confirmed — the art. 16.4 unsent count. Opens
   * its OWN transaction because it takes no caller transaction.
   */
  async pendingCount(nodeId: NodeId): Promise<number> {
    return withTransaction(this.db, async (tx) => {
      const rows = await tx.execute<{ count: number }>(sql`
        select count(*) as count
        from envios e
        join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${nodeId} and e.estado = 'pendiente'
      `);
      return rows.rows[0]!.count;
    });
  }

  private buildDestinatarios(counterparty: Counterparty): { IDDestinatario: Destinatario[] } {
    const checked = recipientIdentifierResult(counterparty);
    if (!checked.valid) {
      if (
        counterparty.countryCode !== "ES" &&
        !("identifierType" in counterparty) &&
        !("identifierCountryCode" in counterparty)
      ) {
        throw new AppError("fiscal.foreign_recipient_unsupported", {
          countryCode: counterparty.countryCode,
        });
      }
      throw new AppError("fiscal.record_invalid", {
        fields: [checked.field],
        codes: ["RECIPIENT_IDENTIFIER_INVALID"],
      });
    }
    const identity = checked.value;
    if (identity.identifierType === undefined || identity.identifierType === "tax-number") {
      return { IDDestinatario: [{ NombreRazon: counterparty.legalName, NIF: identity.taxId }] };
    }
    const idTypes = {
      "vat-number": "02",
      passport: "03",
      "residence-country-id": "04",
      "residence-certificate": "05",
      "other-document": "06",
    } as const;
    return {
      IDDestinatario: [
        {
          NombreRazon: counterparty.legalName,
          IDOtro: {
            CodigoPais: identity.identifierCountryCode!,
            IDType: idTypes[identity.identifierType],
            ID: identity.taxId,
          },
        },
      ],
    };
  }

  private buildSistemaInformatico(
    sif: SifRegistration,
    taxpayer: { legalName: string; nif: string },
  ): SistemaInformatico {
    return {
      ...producerFields(this.identity, taxpayer),
      NombreSistemaInformatico: this.identity.name,
      IdSistemaInformatico: sif.idSistemaInformatico,
      Version: softwareVersion(),
      NumeroInstalacion: String(sif.numeroInstalacion),
      TipoUsoPosibleSoloVerifactu: this.identity.onlyVerifactu,
      TipoUsoPosibleMultiOT: this.identity.multipleTaxpayersPossible,
      IndicadorMultiplesOT: this.identity.multipleTaxpayersNow,
    };
  }

  /**
   * The one taxpayer row, for the `NombreRazonEmisor` every record carries. Read on each filing
   * rather than cached: a legal-name correction must reach the next record.
   *
   * An empty `tenants` table means a corrupt or half-provisioned database, so a plain `Error`
   * rather than a domain code. It must fail LOUDLY: filing under a blank or guessed issuer name is
   * unrepairable.
   */
  private async taxpayer(tx: Transaction): Promise<{ legalName: string }> {
    const row = await readTenant(tx);
    if (row === null) {
      throw new Error("tenants is empty: a venue cannot file a record with no taxpayer to file as");
    }
    return row;
  }
}
