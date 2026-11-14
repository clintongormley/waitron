import { correctionAdmissionFor } from "./correction-admission.js";
import { hasReturnedInvoices, returnedInvoices } from "./returned-invoices.js";
import { filedFiguresFor } from "./filed-figures.js";
import { readDeviceReceiptEvidence } from "./device-receipt-evidence.js";
// Registers this package's own error codes on the shared registry.
import "./errors.js";
import { eq, sql } from "drizzle-orm";
import { readTenant, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recipientIdentifierResult } from "@waitron/country-packs";
import { AppError, decimal, readSaleOrigin, sumDecimals } from "@waitron/shared";
import type { NodeId, SaleId } from "@waitron/shared";
import type {
  ClockStep,
  ClockStepRecorded,
  ClockStepRequest,
  CorrectionAdmission,
  Counterparty,
  FiscalBackend,
  FiledFigures,
  FiledReceipt,
  FiledInvoiceEvidence,
  FiscalRecordRef,
  IntegrityReport,
  NodeRegistration,
  ReceiptQrText,
  SaleForFiscalRecord,
  TrustedClock,
  VatBreakdownLine,
} from "@waitron/fiscal";
import { formatInvoiceNumber } from "@waitron/core";
import { buildQrPayload, formatDate } from "@waitron/verifactu";
import type { SignedMembershipDocument } from "@waitron/membership";
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
import { appendToChain, refuseUnlessServingPrimary } from "./chain.js";
import { currentSif } from "./registro-sif.js";
import { assertNoActiveConflict } from "./conflict-evidence.js";
import type { SifRegistration } from "./registro-sif.js";
import { decodeRegistroRow, fromRegistroRow, toAeatDate } from "./registro-row.js";
import type { Entorno, RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { verifyChain } from "./verify.js";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { chainHeads, refuseUntilRecordable } from "./clock-behind.js";
import { confirmClockStep, latestClockStep } from "./clock-step.js";
import { NOMBRE_RAZON_MAX } from "./venue-fields.js";
import {
  PRODUCER_PENDING,
  SOFTWARE_IDENTITY,
  producerFields,
  softwareVersion,
} from "./software-identity.js";
import type { SoftwareIdentity } from "./software-identity.js";
import { refuseProducerChange } from "./producer-change.js";

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
  /** ./slot.ts passes the producer read from the settings; with none given, the taxpayer is named. */
  identity?: SoftwareIdentity;
  /** Accepted but NOT consumed by this class: the skip-retry cadence belongs to the standalone
   * `drain` (`DrainDeps.skipRetryMs`). */
  skipRetryMs?: number;
}

/** The columns `recordVoid` reads off the alta it voids. */
type OriginalAlta = Pick<
  RegistroRow,
  "source" | "device_id" | "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura"
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
  | "id"
  | "id_emisor_factura"
  | "num_serie_factura"
  | "fecha_expedicion_factura"
  | "tipo_factura"
  | "tipo_rectificativa"
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
    this.identity = options.identity ?? { ...SOFTWARE_IDENTITY, producer: PRODUCER_PENDING };
  }

  assertRecordableAt(reading: { instant: Date; offsetMinutes: number }): void {
    refuseBeforeFirstIssueDate(reading);
  }

  async refuseNewIssuance(tx: Transaction, nodeId: NodeId): Promise<void> {
    await this.admitIssuance(tx, nodeId);
  }

  /** `refuseNewIssuance`, returning the chart it read so the append checks it without a reread. */
  private async admitIssuance(
    tx: Transaction,
    nodeId: NodeId,
  ): Promise<SignedMembershipDocument | null> {
    const chart = await refuseUnlessServingPrimary(tx, nodeId);
    await assertNoActiveConflict(tx, nodeId);
    return chart;
  }

  refuseNewRefund(tx: Transaction, nodeId: NodeId): Promise<void> {
    return assertNoActiveConflict(tx, nodeId);
  }

  refuseUntilRecordable(
    tx: Transaction,
    reading: { instant: Date; offsetMinutes: number },
  ): Promise<void> {
    return refuseUntilRecordable(tx, reading);
  }

  confirmClockStep(tx: Transaction, input: ClockStepRequest): Promise<ClockStepRecorded> {
    return confirmClockStep(tx, input);
  }

  latestClockStep(tx: Transaction): Promise<ClockStep | null> {
    return latestClockStep(tx);
  }

  recordHeads(tx: Transaction): Promise<Record<string, number>> {
    return chainHeads(tx);
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
    const chart = await this.admitIssuance(tx, sale.nodeId);
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
      { sif, chart },
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

  private async deliveryState(tx: Transaction, registroId: string): Promise<string | undefined> {
    const [delivery] = await tx
      .select({ estado: envios.estado })
      .from(envios)
      .where(eq(envios.registroId, registroId));
    return delivery?.estado;
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
      from registros_facturacion indexed by registros_sale_idx
      where sale_id = ${saleId} and tipo_registro = 'alta'
        and corrects_registro_id is null
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

  async invoiceEvidenceFor(
    tx: Transaction,
    saleId: SaleId,
  ): Promise<FiledInvoiceEvidence | undefined> {
    return readDeviceReceiptEvidence(tx, saleId);
  }

  correctionAdmissionFor(
    tx: Transaction,
    saleId: SaleId,
    issuingNodeId: NodeId,
  ): Promise<CorrectionAdmission> {
    return correctionAdmissionFor(tx, saleId, issuingNodeId);
  }

  hasReturnedInvoices(tx: Transaction) {
    return hasReturnedInvoices(tx);
  }

  returnedInvoices(tx: Transaction, page: { offset: number; limit: number }) {
    return returnedInvoices(tx, page);
  }

  filedFiguresFor(
    tx: Transaction,
    saleIds: readonly SaleId[],
  ): Promise<ReadonlyMap<SaleId, FiledFigures>> {
    return filedFiguresFor(tx, saleIds);
  }

  /** Voids a previously recorded sale by appending an anulación referencing its identity. */
  async recordVoid(
    tx: Transaction,
    saleId: SaleId,
    reason: string,
    issuingNodeId: NodeId,
  ): Promise<FiscalRecordRef> {
    // AEAT's `RegistroAnulacion` has no free-text field, so `reason` is not filed.
    void reason;

    const { rows } = await tx.execute<OriginalAlta>(sql`
      select source, device_id, id_emisor_factura, num_serie_factura,
        fecha_expedicion_factura
      from registros_facturacion indexed by registros_sale_idx
      where sale_id = ${saleId} and tipo_registro = 'alta'
        and corrects_registro_id is null
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }

    // The anulación extends the ISSUING box's chain, under that box's SIF, and inherits the
    // original's origin and invoice identity.
    const origin = readSaleOrigin(original.source, original.device_id);
    const chart = await this.admitIssuance(tx, issuingNodeId);
    const sif = await currentSif(tx, issuingNodeId);
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
      issuingNodeId,
      {
        tipo: "anulacion",
        saleId,
        origin,
        entorno: this.deploymentEnvironment,
        nombreRazonEmisor: tenant.legalName,
        input,
      },
      { sif, chart },
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

  async recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId; replaces?: true; operationDate?: string },
  ): Promise<FiscalRecordRef> {
    const chart = await this.admitIssuance(tx, sale.nodeId);
    const { rows } = await tx.execute<OriginalAltaForCorrection>(sql`
      select id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura, tipo_factura,
        tipo_rectificativa
      from registros_facturacion
      where sale_id = ${correction.correctsSaleId} and tipo_registro = 'alta'
        and not exists (
          select 1 from registros_facturacion replacement
          where replacement.corrects_registro_id = registros_facturacion.id
        )
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId: correction.correctsSaleId });
    }
    // An R5 by replacement stands in for the simplified invoice it replaced, so a later correction
    // names it by differences, as for an F2.
    const replacement = original.tipo_factura === "R5" && original.tipo_rectificativa === "S";
    // A replacement files the sale's full amounts with nothing rectified, which is right only
    // while AEAT holds nothing for the original: its latest version was refused.
    const replacesRefusedF2 =
      correction.replaces === true &&
      original.tipo_factura === "F2" &&
      (await this.deliveryState(tx, original.id)) === "rechazado";
    if (
      correction.replaces === true
        ? !replacesRefusedF2
        : original.tipo_factura !== "F2" && !replacement
    ) {
      throw new AppError("fiscal.correction_unsupported", {
        saleId: correction.correctsSaleId,
        // Non-null on every alta; only an anulación stores NULL.
        tipoFactura: original.tipo_factura as string,
        ...(correction.replaces === true ? { replaces: true as const } : {}),
      });
    }

    const sif = await currentSif(tx, sale.nodeId);
    const tenant = await this.taxpayer(tx);

    const desglose = sale.vatBreakdown.map(toDetalleDesglose);
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));
    const { operationDate } = correction;
    const fechaOperacion =
      replacesRefusedF2 &&
      operationDate !== undefined &&
      toAeatDate(operationDate) !== formatDate(sale.issuedAt, sale.offsetMinutes)
        ? // The same offset cancellation as `recordVoid`'s `FechaExpedicionFacturaAnulada`.
          new Date(Date.parse(`${operationDate}T00:00:00Z`) - sale.offsetMinutes * 60_000)
        : undefined;

    const input: Omit<AltaInput, "Encadenamiento"> = {
      IDEmisorFactura: sif.nif,
      // The corrective's OWN new number and date: a rectificativa is a new invoice.
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      TipoFactura: "R5",
      TipoRectificativa: replacesRefusedF2 ? "S" : "I",
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
      // Zero: AEAT holds no amount for the refused original, so there is none to take out.
      ...(replacesRefusedF2 && {
        ImporteRectificacion: { BaseRectificada: "0.00", CuotaRectificada: "0.00" },
      }),
      ...(fechaOperacion !== undefined && { FechaOperacion: fechaOperacion }),
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
      { sif, chart },
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
    const chart = await this.admitIssuance(tx, sale.nodeId);
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
          and not exists (
            select 1 from registros_facturacion replacement
            where replacement.corrects_registro_id = registros_facturacion.id
          )
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
      { sif, chart },
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

  checkFilingIdentity(tx: Transaction, nodeId: NodeId): Promise<void> {
    return refuseProducerChange(tx, nodeId, this.identity, this.deploymentEnvironment);
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
