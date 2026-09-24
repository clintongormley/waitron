// Registers this package's own error codes on the shared registry.
import "./errors.js";
import { sql } from "drizzle-orm";
import { readTenant, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { AppError, decimal, sumDecimals } from "@waitron/shared";
import type { NodeId, SaleId, TillId } from "@waitron/shared";
import type {
  Counterparty,
  FiscalBackend,
  FiledReceipt,
  FiscalRecordRef,
  IntegrityReport,
  NodeRegistration,
  SaleForFiscalRecord,
  TrustedClock,
  VatBreakdownLine,
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
  SiNo,
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

/** `FiscalRecordRef.backend`/`NodeRegistration.backend` — the regime-neutral interface's own
 * "which module produced this" tag. */
const BACKEND_ID = "verifactu";

/**
 * Software-identity fields of `SistemaInformatico` that describe THIS PRODUCT rather than any
 * one venue, till, or sale — Waitron's own claims about what it is and how it may be used.
 * `IdSistemaInformatico` and `NumeroInstalacion` are deliberately absent from this shape: both
 * are per-(NIF, node) facts already minted by `registerSif` and read back from `registro_sif` via
 * `currentSif`, never configuration.
 *
 * **Unverified**: `tipoUsoPosibleSoloVerifactu`/`tipoUsoPosibleMultiOT`/`indicadorMultiplesOT`
 * describe how this product may be used under Veri*Factu. The defaults below are a plausible
 * starting point for a one-taxpayer-per-installation POS, not a value taken from a primary source,
 * and are overridable via `VerifactuBackendOptions.systemInfo` for exactly that reason.
 */
interface SystemInfoDefaults {
  nombreSistemaInformatico: string;
  version: string;
  tipoUsoPosibleSoloVerifactu: SiNo;
  tipoUsoPosibleMultiOT: SiNo;
  indicadorMultiplesOT: SiNo;
}

const DEFAULT_SYSTEM_INFO: SystemInfoDefaults = {
  nombreSistemaInformatico: "Waitron POS",
  version: "0.0.0",
  tipoUsoPosibleSoloVerifactu: "S",
  tipoUsoPosibleMultiOT: "S",
  indicadorMultiplesOT: "N",
};

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
  /** Overrides for this installation's software-identity claims. See `SystemInfoDefaults`'s own
   * doc comment for why these are configuration rather than hardcoded constants. */
  systemInfo?: Partial<SystemInfoDefaults>;
  /** Accepted but NOT consumed by this class: the skip-retry cadence belongs to the standalone
   * `drain` (`DrainDeps.skipRetryMs`). */
  skipRetryMs?: number;
}

/** The columns `recordVoid` reads off the alta it voids. */
type OriginalAlta = Pick<
  RegistroRow,
  "till_id" | "node_id" | "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura"
>;

/**
 * The columns `recordCorrection` reads off the alta being corrected. Narrower than `OriginalAlta`
 * in one axis and wider in another: no `till_id` (the corrective's OWN `sale` carries it, unlike a
 * void which must recover it), but `tipo_factura` too — the R-type is derived
 * from it (F2 → R5), so it is read here rather than assumed. The three identity columns feed
 * `FacturasRectificadas` directly, the same shortcut `recordVoid` takes for the anulada identity.
 */
type OriginalAltaForCorrection = Pick<
  RegistroRow,
  "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura" | "tipo_factura"
>;

/**
 * The real Veri*Factu `FiscalBackend`. Every record method builds its registro through
 * `appendToChain`, which computes the huella and advances the chain head, then inserts a
 * `pendiente` `envios` row — all on the caller's transaction. Nothing here contacts AEAT.
 */
export class VerifactuBackend implements FiscalBackend {
  readonly id = BACKEND_ID;

  private readonly db: Database;
  private readonly clock: TrustedClock;
  private readonly environment: Environment;
  private readonly deploymentEnvironment: Entorno;
  private readonly systemInfo: SystemInfoDefaults;

  constructor(options: VerifactuBackendOptions) {
    this.db = options.db;
    this.clock = options.clock;
    this.environment = options.environment ?? "production";
    this.deploymentEnvironment = options.deploymentEnvironment;
    this.systemInfo = { ...DEFAULT_SYSTEM_INFO, ...options.systemInfo };
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

    const desglose: DetalleDesgloseInput[] = sale.vatBreakdown.map((line) => ({
      BaseImponibleOimporteNoSujeto: line.base,
      TipoImpositivo: line.rate,
      CuotaRepercutida: line.tax,
      // "S1" — sujeta y no exenta, sin inversión del sujeto pasivo: the ordinary domestic retail
      // sale. No exempt, reverse-charge or recargo de equivalencia line is filed today.
      CalificacionOperacion: "S1",
    }));
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));

    // An F1 must name its recipient and an F2 must NOT carry one. `buildDestinatarios` is the one
    // place that refuses a foreign recipient; no country test is repeated here, so "foreign
    // customers are not supported yet" never reads as "an F1 with no recipient".
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
      SistemaInformatico: this.buildSistemaInformatico(sif, tenant.legalName),
      generadoEn: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      sale.nodeId,
      {
        tipo: "alta",
        saleId: sale.saleId,
        tillId: sale.tillId,
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
      select till_id, node_id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura
      from registros_facturacion
      where sale_id = ${saleId} and tipo_registro = 'alta'
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }

    // The anulación extends the ORIGINAL's chain, keyed by its node, and inherits its `till_id`.
    const tillId = original.till_id as TillId;
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
      SistemaInformatico: this.buildSistemaInformatico(sif, tenant.legalName),
      generadoEn: now.instant,
      offsetMinutes: now.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      nodeId,
      { tipo: "anulacion", saleId, tillId, entorno: this.deploymentEnvironment, input },
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

    const desglose: DetalleDesgloseInput[] = sale.vatBreakdown.map((line) => ({
      BaseImponibleOimporteNoSujeto: line.base,
      TipoImpositivo: line.rate,
      CuotaRepercutida: line.tax,
      // Same S1 (sujeta y no exenta) qualification `recordSale` applies — a rectificativa por
      // diferencias carries the identical breakdown shape, its figures merely negative.
      CalificacionOperacion: "S1",
    }));
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
      SistemaInformatico: this.buildSistemaInformatico(sif, tenant.legalName),
      generadoEn: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      sale.nodeId,
      {
        tipo: "alta",
        saleId: sale.saleId,
        tillId: sale.tillId,
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

    const desglose: DetalleDesgloseInput[] = sale.vatBreakdown.map((line) => ({
      BaseImponibleOimporteNoSujeto: line.base,
      TipoImpositivo: line.rate,
      CuotaRepercutida: line.tax,
      CalificacionOperacion: "S1",
    }));
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
      SistemaInformatico: this.buildSistemaInformatico(sif, tenant.legalName),
      generadoEn: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      sale.nodeId,
      {
        tipo: "alta",
        saleId: sale.saleId,
        tillId: sale.tillId,
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

  /**
   * Maps the generic `Counterparty` onto an AEAT `Destinatario` for every record that names a
   * recipient — an F1 from `recordSale` and an F3 from `recordSubstitution` alike. A domestic
   * recipient is named by NIF.
   *
   * A FOREIGN recipient would need `IDOtro` (CodigoPais + IDType + ID), and which IDType a given
   * non-resident takes is a fiscal decision nobody here has made. This is the ONE place that
   * decision is encoded: a non-`ES` recipient is refused, deliberately, because a guessed IDType
   * would be filed into an append-only, hash-chained record and could never be unfiled. Open with
   * the asesor: `docs/compliance/asesor-questions.md`, Q17(a).
   */
  private buildDestinatarios(counterparty: Counterparty): { IDDestinatario: Destinatario[] } {
    if (counterparty.countryCode !== "ES") {
      // `countryCode` is a country code, not operator data, so it may travel in params — the
      // registry's rule is that an operator's own values never do (they reach `waitron.log`, which
      // the unauthenticated recovery page renders on the venue's LAN).
      throw new AppError("fiscal.foreign_recipient_unsupported", {
        countryCode: counterparty.countryCode,
      });
    }
    return {
      IDDestinatario: [{ NombreRazon: counterparty.legalName, NIF: counterparty.taxId }],
    };
  }

  private buildSistemaInformatico(sif: SifRegistration, legalName: string): SistemaInformatico {
    return {
      NombreRazon: legalName,
      NIF: sif.nif,
      NombreSistemaInformatico: this.systemInfo.nombreSistemaInformatico,
      IdSistemaInformatico: sif.idSistemaInformatico,
      Version: this.systemInfo.version,
      NumeroInstalacion: String(sif.numeroInstalacion),
      TipoUsoPosibleSoloVerifactu: this.systemInfo.tipoUsoPosibleSoloVerifactu,
      TipoUsoPosibleMultiOT: this.systemInfo.tipoUsoPosibleMultiOT,
      IndicadorMultiplesOT: this.systemInfo.indicadorMultiplesOT,
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
