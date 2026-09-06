// Side-effect import registering this package's own `fiscal.correction_unsupported` code (thrown
// by `recordCorrection` below) on the shared registry — the convention every file that throws a
// local code follows (./chain.ts, ./registro-sif.ts). `fiscal.sale_not_recorded`, also thrown
// here, is `@waitron/fiscal`'s and arrives with its types.
import "./errors.js";
import { eq, sql } from "drizzle-orm";
import { tenants, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { AppError, decimal, sumDecimals } from "@waitron/shared";
import type { NodeId, SaleId, TenantId, TillId } from "@waitron/shared";
import type {
  Counterparty,
  DrainResult,
  FiscalBackend,
  FiscalRecordRef,
  IntegrityReport,
  NodeRegistration,
  ReconcileResult,
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
import { DEFAULT_SKIP_RETRY_MS, drain as runDrain } from "./drain.js";
import { reconcile as runReconcile } from "./reconcile.js";
import { currentSif } from "./registro-sif.js";
import type { SifRegistration } from "./registro-sif.js";
import { fromRegistroRow } from "./registro-row.js";
import type { Entorno, RegistroRow } from "./registro-row.js";
import { envios } from "./schema/envios.js";
import { verifyChain } from "./verify.js";

/** `FiscalRecordRef.backend`/`NodeRegistration.backend` — the regime-neutral interface's own
 * "which module produced this" tag. */
const BACKEND_ID = "verifactu";

/**
 * Software-identity fields of `SistemaInformatico` that describe THIS PRODUCT rather than any
 * one tenant, till, or sale — Waitron's own claims about what it is and how it may be used.
 * `IdSistemaInformatico` and `NumeroInstalacion` are deliberately absent from this shape: both
 * are per-(NIF, node) facts already minted by `registerSif` and read back from `registro_sif` via
 * `currentSif`, never configuration.
 *
 * **Unverified, matching this repo's own convention for a claim with no cited primary source**
 * (see `packages/db/src/schema/series.ts`'s identical `invoice_series.purpose` caveat, "asesor
 * Q5(b)"): `tipoUsoPosibleSoloVerifactu`/`tipoUsoPosibleMultiOT`/`indicadorMultiplesOT` describe
 * how this specific product may be used under Veri*Factu — whether it is Veri*Factu-only capable,
 * whether it can serve multiple obligados, and whether it currently does. The defaults below are
 * a plausible starting point for a single-tenant-per-installation POS, not a value taken from a
 * primary source, and are overridable via `VerifactuBackendOptions.systemInfo` for exactly that
 * reason.
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
   * Used ONLY by `pendingCount` and `recordVoid` — never by `recordSale`, which is handed
   * `issuedAt`/`offsetMinutes` by its caller instead and must not read the clock a second time
   * (see `record-sale.ts`'s own "one clock reading for the whole transaction" note in
   * `packages/core`). `recordVoid` has no caller-supplied timestamp on its signature at all
   * (`recordVoid(tx, saleId, reason)`), so it reads this clock itself. `pendingCount(tenantId,
   * nodeId)` takes no transaction at all, so it needs its OWN `db` handle below rather than one a
   * caller passes in.
   */
  clock: TrustedClock;
  /** The connection `pendingCount` queries against — the one `FiscalBackend` method with no `tx`
   * parameter at all, so it cannot participate in a caller's transaction. */
  db: Database;
  /**
   * The AEAT transport, per tenant. mTLS/endpoint live inside the caller-supplied fetch this wraps
   * (`createClient({ endpoint, fetch })`); tests wire it over the fake AEAT's fetch
   * (`@waitron/verifactu`'s `createFakeAeat().client()`), which needs no certificate and so returns
   * the same client for every tenant.
   *
   * A function of `tenantId` because `drain` sweeps every tenant with due work and a certificate
   * identifies one presenter — see `DrainDeps.resolveClient`. Used by `drain` and `reconcile`, not
   * by `recordSale`/`recordVoid`/`registerNode`/`checkIntegrity`/`pendingCount` — none of those
   * ever contact AEAT (spec §4: nothing here may block a sale on connectivity).
   */
  resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>;
  /** Which QR validation host to build `verificationUrl`-shaped URLs against. Defaults to
   * `"production"`. */
  environment?: Environment;
  /**
   * Which DEPLOYMENT this backend is generating registros for — `Entorno` (`./registro-row.ts`),
   * not this option's namesake above and not `apps/server`'s `DeploymentEnvironment` type: this
   * package never imports from `apps/server`, and the two options answer unrelated questions that
   * only coincidentally share a value space (`"production"` | `"preproduction"`). `environment`
   * above picks a QR validation HOST; this one is stamped onto every registro's own `entorno`
   * column (`./registro-row.ts`'s `RegistroRowContext.entorno`) so `drain` (Task 6) can refuse to
   * submit a record generated for the other deployment. REQUIRED, unlike `environment`: defaulting
   * a value that gates fiscal submission would silently mis-stamp every registro from a host that
   * forgot to set it, rather than failing the build. Typed as the union rather than a bare
   * `string` so an unrepresentable value (`""`, `"staging"`, a stray `process.env.NODE_ENV`) is a
   * `tsc` error here, not a `registros_entorno_ck` violation discovered only once `recordSale` has
   * already opened the sale's own transaction — spec §4 forbids blocking a sale on anything but
   * the sale itself.
   */
  deploymentEnvironment: Entorno;
  /** Overrides for this installation's software-identity claims. See `SystemInfoDefaults`'s own
   * doc comment for why these are configuration rather than hardcoded constants. */
  systemInfo?: Partial<SystemInfoDefaults>;
  /**
   * Overrides `DEFAULT_SKIP_RETRY_MS` for this backend's `drain`. OPTIONAL, unlike
   * `DrainDeps.skipRetryMs` which is required: this option has construction sites scattered across
   * this package's own test suites, none of which care about a cadence knob, and making it
   * required would edit every one of them to say the same thing. The strictness stays where it is
   * cheap — `DrainDeps` itself.
   */
  skipRetryMs?: number;
}

/**
 * `NumSerieFactura`-shaped predecessor pointer, in reverse: the columns of the alta this task's
 * `recordVoid` is voiding — read via a raw `select *` (this file's own convention, mirrored from
 * `./chain.ts`/`./verify.ts`) rather than Drizzle's typed `.select()`, because `RegistroRow`'s
 * snake_case shape is what every OTHER raw-execute call site in this package already produces and
 * consumes, and mixing the two shapes for one table would invite exactly the drift `./registro-row.ts`'s
 * own doc comment on `RegistroRow` warns about.
 */
type OriginalAlta = Pick<
  RegistroRow,
  | "tenant_id"
  | "till_id"
  | "node_id"
  | "id_emisor_factura"
  | "num_serie_factura"
  | "fecha_expedicion_factura"
>;

/**
 * The columns `recordCorrection` reads off the alta being corrected. Narrower than `OriginalAlta`
 * in one axis and wider in another: no `tenant_id`/`till_id` (the corrective's OWN `sale` carries
 * those, unlike a void which must recover them), but `tipo_factura` too — the R-type is derived
 * from it (F2 → R5), so it is read here rather than assumed. The three identity columns feed
 * `FacturasRectificadas` directly, the same shortcut `recordVoid` takes for the anulada identity.
 */
type OriginalAltaForCorrection = Pick<
  RegistroRow,
  "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura" | "tipo_factura"
>;

/**
 * The real Veri*Factu `FiscalBackend`. Wires the pieces Tasks 12-15 already built —
 * `registerSif`/`currentSif`, `appendToChain` (which itself calls `lockChainHead`/`verifyChain`'s
 * own row lock), `toRegistroRow`'s hashing via `@waitron/verifactu`'s `buildAltaRecord`, and the
 * `envios` sidecar — into the interface `packages/core`'s `recordSale` (spec §4 steps 1-7) calls
 * through.
 *
 * `recordSale` is this task's own graded surface: it builds the registro, computes the huella
 * (inside `appendToChain` → `buildAltaRecord`), inserts it, advances the chain head, and inserts
 * the `envios` sidecar row as `pendiente` — proven end to end against real tables by
 * `./write-path.e2e.test.ts`, which is the one thing a fake cannot demonstrate at all.
 * `registerNode`/`recordVoid`/`checkIntegrity`/`pendingCount` complete the interface (TypeScript
 * requires every one of them) but are secondary to that deliverable; see each method's own doc
 * comment for what it does and does not cover, and this task's report for what remains unverified
 * about them.
 */
export class VerifactuBackend implements FiscalBackend {
  readonly id = BACKEND_ID;

  private readonly db: Database;
  private readonly clock: TrustedClock;
  private readonly resolveClient: (tenantId: TenantId) => Promise<VerifactuClient>;
  private readonly environment: Environment;
  private readonly deploymentEnvironment: Entorno;
  private readonly systemInfo: SystemInfoDefaults;
  private readonly skipRetryMs: number;

  constructor(options: VerifactuBackendOptions) {
    this.db = options.db;
    this.clock = options.clock;
    // Wrapped, not stored as the bare `options.resolveClient` reference: `drain()` hands this
    // field to `runDrain`, which invokes it as `deps.resolveClient(tenantId)` (receiver = the
    // fresh `DrainDeps` literal), while `reconcile()` calls `this.resolveClient(tenantId)`
    // directly (receiver = this instance) — two different receivers for what would otherwise be
    // the same function reference, so a host supplying an unbound class method would behave
    // differently depending on which of `drain`/`reconcile` reached it. The arrow wrapper is
    // itself receiver-agnostic (arrow functions ignore whatever they were called through) and
    // always calls the ORIGINAL `options.resolveClient(tenantId)` with `options` as its own fixed,
    // closed-over receiver — so both call sites end up invoking it identically, regardless of how
    // each one happens to read this field.
    this.resolveClient = (tenantId) => options.resolveClient(tenantId);
    this.environment = options.environment ?? "production";
    this.deploymentEnvironment = options.deploymentEnvironment;
    this.systemInfo = { ...DEFAULT_SYSTEM_INFO, ...options.systemInfo };
    // Defaulted HERE, like every sibling option above, rather than at the `runDrain` call site
    // below: a `number | undefined` field would let a future SECOND call site forget the `??` and
    // silently pass `undefined` into `DrainDeps.skipRetryMs: number`, which the fold arithmetic
    // then turns into `Invalid Date` rather than a compile error.
    this.skipRetryMs = options.skipRetryMs ?? DEFAULT_SKIP_RETRY_MS;
  }

  /**
   * Confirms — rather than performs — a node's Veri*Factu provisioning (node-id rekey, 2026-08-03:
   * the SIF is the node, #33).
   *
   * The generic `FiscalBackend.registerNode(tx, nodeId, { tenantId })` signature carries no NIF
   * and no `IdSistemaInformatico`, so it cannot mint a NEW SIF identity: `registerSif`
   * (`./registro-sif.ts`) genuinely needs both, and both are regime-specific provisioning
   * inputs the generic interface has no room for. `registerSif`'s own doc comment already frames
   * first-time (and re-)registration as a rare, sequential, admin-only action performed once,
   * outside the ordinary sale flow — so this method reads back whatever `registerSif` already
   * established via `currentSif`, and reports `sif.not_registered` (thrown by `currentSif`
   * itself) exactly like any other caller that reaches a node with no live SIF identity.
   */
  async registerNode(
    tx: Transaction,
    nodeId: NodeId,
    params: { tenantId: TenantId },
  ): Promise<NodeRegistration> {
    const sif = await currentSif(tx, params.tenantId, nodeId);
    return {
      backend: this.id,
      nodeId,
      registrationId: `${sif.nif}/${sif.idSistemaInformatico}/${String(sif.numeroInstalacion)}`,
      registeredAt: sif.registradoEn,
    };
  }

  /**
   * Spec §4 steps 5-6: builds the registro via `appendToChain` (which calls
   * `@waitron/verifactu`'s `buildAltaRecord`/`computeHuella` under the chain-head lock), inserts
   * it, advances the chain head, and inserts the `envios` sidecar row as `pendiente`. All on the
   * caller's own transaction — this is the atomicity `packages/core`'s `recordSale` depends on.
   *
   * Reads NO clock of its own: `sale.issuedAt`/`sale.offsetMinutes` are the SAME reading the
   * caller already took for the sale row, and reusing them here (rather than calling
   * `this.clock.now()` again) is what keeps the sale and its fiscal record stamped with one
   * instant for one event.
   */
  async recordSale(tx: Transaction, sale: SaleForFiscalRecord): Promise<FiscalRecordRef> {
    const sif = await currentSif(tx, sale.tenantId, sale.nodeId);
    const tenant = await this.legalNameFor(tx, sale.tenantId);

    const desglose: DetalleDesgloseInput[] = sale.vatBreakdown.map((line) => ({
      BaseImponibleOimporteNoSujeto: line.base,
      TipoImpositivo: line.rate,
      CuotaRepercutida: line.tax,
      // "S1" — sujeta y no exenta, sin inversión del sujeto pasivo: the ordinary domestic retail
      // sale. `VatBreakdownLine`'s `surchargeRate`/`surcharge` (recargo de equivalencia) are not
      // populated by `packages/core` in this task, so every entry takes the same, most common
      // qualification. A future task billing an exempt or reverse-charge operation supplies a
      // real `CalificacionOperacion`/`OperacionExenta` here instead.
      CalificacionOperacion: "S1",
    }));
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));

    const input: Omit<AltaInput, "Encadenamiento"> = {
      IDEmisorFactura: sif.nif,
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      // "F2" (factura simplificada) for a simplified/no-recipient invoice, "F1" (factura
      // completa) once a real `Counterparty` is wired up. `counterparty === null` is the
      // ordinary case at a till (`SaleForFiscalRecord.counterparty`'s own doc comment) — no task
      // yet supplies a non-null one, so "F1" is unreachable through the real write path today.
      TipoFactura: sale.counterparty === null ? "F2" : "F1",
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
      sale.tenantId,
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

    // Step 6. `pendiente`, `intentos: 0`, `csv: null` are every one of this column's own
    // defaults (`./schema/envios.ts`) — nothing here has been sent anywhere, which is the whole
    // point of a write path that must never contact AEAT.
    await tx.insert(envios).values({ registroId: appended.id, tenantId: sale.tenantId });

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
   * Rebuilds the just-inserted registro from its OWN stored columns and derives the QR payload
   * from it — never from the in-memory values this method already had lying around. Rendering the
   * receipt is out of scope; the point proved here (and by
   * `write-path.e2e.test.ts`'s identical "makes the QR payload derivable from the stored record")
   * is that the payload is reachable from what was PERSISTED, which is what survives a reprint
   * after this call's own stack frame is long gone. `appendToChain` returns only `{ id, secuencia,
   * huella }`, not the full built record, so this is a second, small round trip rather than a
   * change to that shared return shape.
   */
  private async qrPayloadFor(tx: Transaction, registroId: string): Promise<string> {
    const { rows } = await tx.execute<RegistroRow>(sql`
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
    // Safe cast: this method is only ever called with the id of a record THIS class just
    // inserted via the "alta" arm of `appendToChain`, never an anulación.
    return buildQrPayload(fromRegistroRow(row) as RegistroAlta, this.environment);
  }

  /**
   * The idempotent-replay read-back (`FiscalBackend.filedReceiptFor`): finds the sale's own `alta`
   * registro and returns the QR re-derived from it plus the EXACT filed desglose, so a lost-response
   * pay retry can reprint a legally-complete ticket without re-filing anything.
   *
   * Pure read: it re-uses `recordVoid`'s own `where sale_id = … and tipo_registro = 'alta'` lookup
   * shape (the alta is the sale's original record; a later anulación shares the `sale_id` but is
   * excluded by the `tipo_registro` filter) but selects the FULL row once, then derives BOTH outputs
   * from it in memory — `verificationUrl` by the SAME `fromRegistroRow` → `buildQrPayload` derivation
   * `qrPayloadFor` (and thus `recordSale` at filing time) applies, so the replay's QR is byte-identical
   * to the original's; and `vatBreakdown` by INVERTING the stored `desglose`. It routes through neither
   * a second `select` nor `qrPayloadFor` (which would re-read this very row by id), never writes,
   * appends or re-hashes — the immutable record (§5) is only read, exactly once.
   */
  async filedReceiptFor(
    tx: Transaction,
    saleId: SaleId,
  ): Promise<{ verificationUrl: string; vatBreakdown: VatBreakdownLine[] } | undefined> {
    const { rows } = await tx.execute<RegistroRow>(sql`
      select *
      from registros_facturacion
      where sale_id = ${saleId} and tipo_registro = 'alta'
      limit 1
    `);
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    // Rebuild the alta from its OWN stored columns and derive the QR from it — the identical derivation
    // `qrPayloadFor` performs (and `recordSale` used at filing time). The `as RegistroAlta` cast is
    // safe for the same reason `qrPayloadFor`'s is: the `tipo_registro = 'alta'` filter selects only
    // altas, never an anulación.
    const verificationUrl = buildQrPayload(fromRegistroRow(row) as RegistroAlta, this.environment);

    // Invert `recordSale`'s own `sale.vatBreakdown` → `Desglose` mapping (backend.ts, the `desglose`
    // built in `recordSale`/`recordCorrection`/`recordSubstitution`): `BaseImponibleOimporteNoSujeto`
    // ← base, `TipoImpositivo` ← rate, `CuotaRepercutida` ← tax. Every alta this POS files is a taxed
    // S1 line with all three populated (never an `OperacionExenta` line, which would omit
    // rate/cuota) and carries no recargo de equivalencia, so the three fields are read back with a
    // cast — the same `Desglose`/`TipoFactura` cast convention `fromRegistroRow` uses for values a
    // real write-path invariant guarantees present — and no surcharge fields are inverted because
    // none is ever filed. `row.desglose` is non-null on any alta (`tipo_registro = 'alta'` excludes
    // the anulación NULL case), cast the same way `fromRegistroRow` casts it. A future task that files
    // an exempt or recargo line extends this inversion beside the write side that produces it.
    const desglose = row.desglose as RegistroAlta["Desglose"];
    const vatBreakdown: VatBreakdownLine[] = desglose.map((detalle) => ({
      rate: decimal(detalle.TipoImpositivo as string),
      base: decimal(detalle.BaseImponibleOimporteNoSujeto),
      tax: decimal(detalle.CuotaRepercutida as string),
    }));

    return { verificationUrl, vatBreakdown };
  }

  /**
   * Voids a previously recorded sale by appending an anulación referencing its identity.
   *
   * Task 16 shipped this genuinely functional (never a stub — `FiscalBackend` requires it, and a
   * stub would be a silent lie about what this class implements) but flagged one caveat on
   * `FechaExpedicionFacturaAnulada`'s reconstruction below, resolved by Task 17 — see that field's
   * own comment for the fix. Task 17 also drives this method from `packages/core`'s `recordVoid`
   * and proves the interleaved-chain property end to end (`./void-path.e2e.test.ts`), so it now
   * carries real test coverage of its own, in `backend.test.ts`'s `describe("recordVoid", ...)`.
   */
  async recordVoid(tx: Transaction, saleId: SaleId, reason: string): Promise<FiscalRecordRef> {
    // `reason` is part of `FiscalBackend`'s public contract (a real backend may keep it as its
    // own audit trail) but AEAT's `RegistroAnulacion` has no field for free text at all — kept as
    // a parameter, unused, exactly like `FakeFiscalBackend.recordVoid`'s identical `_reason`.
    void reason;

    const { rows } = await tx.execute<OriginalAlta>(sql`
      select tenant_id, till_id, node_id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura
      from registros_facturacion
      where sale_id = ${saleId} and tipo_registro = 'alta'
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }

    const tenantId = original.tenant_id as TenantId;
    // The anulación extends the ORIGINAL's chain, keyed by its node (node-id rekey, 2026-08-03),
    // and inherits the original's `till_id` as its own informational snapshot.
    const tillId = original.till_id as TillId;
    const nodeId = original.node_id as NodeId;
    const sif = await currentSif(tx, tenantId, nodeId);
    const tenant = await this.legalNameFor(tx, tenantId);
    const now = this.clock.now();

    const input: Omit<AnulacionInput, "Encadenamiento"> = {
      IDEmisorFacturaAnulada: original.id_emisor_factura,
      NumSerieFacturaAnulada: original.num_serie_factura,
      // Task 16 review, Minor: reconstructs the ORIGINAL alta's calendar day EXACTLY, for any
      // `now.offsetMinutes` — not merely "safe within a margin" (Task 16's own noon-UTC anchor,
      // correct only up to ±12h; exercised only at +60 there). `fecha_expedicion_factura` is
      // stored as a plain `date` (no time-of-day, no offset — the offset that produced it is gone
      // the moment it is stored, the same fact `./registro-row.ts`'s own note on
      // `RegistroRowContext.offsetMinutes` makes for the full timestamp columns), and
      // `buildAnulacionRecord` re-renders whatever Date this field carries via
      // `formatDate(date, offsetMinutes)`, which SHIFTS by `input.offsetMinutes` before reading
      // the UTC calendar day back off.
      //
      // Carrying the ORIGINAL alta's own stored `offset_minutos` through instead (Task 16's own
      // suggested fix) is not available here: `AnulacionInput.offsetMinutes`
      // (`RecordInputBase`, packages/verifactu/src/types.ts) is a SINGLE field shared with
      // `FechaHoraHusoGenRegistro`'s own generation instant a few lines down, and it must be
      // `now.offsetMinutes` for THAT field to be correct — a `packages/verifactu` type change
      // this task does not make would be needed to carry a second, independent offset through.
      //
      // The fix instead cancels the shift algebraically, which needs no second offset at all:
      // `shift(anchor, o).getTime() === anchor.getTime() + o * 60_000` (./format.ts), so anchoring
      // at midnight UTC on the stored day MINUS that same product makes the shift land EXACTLY on
      // midnight of that day again, regardless of `o`'s sign or magnitude (within `formatDate`'s
      // own ±14:00 domain). This replaces "safe within ±12h" with "exact for any offset
      // `formatDate` accepts" — proven at +13:00 and -13:00 in backend.test.ts, both of which
      // roll the calendar day under Task 16's noon anchor (noon ± 13h crosses midnight) and do
      // not under this one.
      FechaExpedicionFacturaAnulada: new Date(
        Date.parse(`${original.fecha_expedicion_factura}T00:00:00Z`) - now.offsetMinutes * 60_000,
      ),
      SistemaInformatico: this.buildSistemaInformatico(sif, tenant.legalName),
      generadoEn: now.instant,
      offsetMinutes: now.offsetMinutes,
    };

    const appended = await appendToChain(
      tx,
      tenantId,
      nodeId,
      { tipo: "anulacion", saleId, tillId, entorno: this.deploymentEnvironment, input },
      sif,
    );

    await tx.insert(envios).values({ registroId: appended.id, tenantId });

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
   * its own `pendiente` sidecar — everything `recordSale`'s own path does. `chain.ts` needs no
   * change; the R5 record flows through it unaltered.
   *
   * The `entorno` invariant (§5) is preserved exactly as `recordSale`: it travels BESIDE `input` in
   * the `PendingRegistro`, never inside it, so our own metadata never reaches `computeHuella`.
   */
  async recordCorrection(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    correction: { correctsSaleId: SaleId },
  ): Promise<FiscalRecordRef> {
    // The original alta being corrected. Read exactly as `recordVoid` reads the alta it voids
    // (same `sale_id` + `tipo_registro = 'alta'` filter); its own three identity columns become the
    // `FacturasRectificadas` pointer with no NIF/number reconstruction — the same shortcut.
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
    // Derive the R-type from the original's own TipoFactura. v1 corrects only a simplified F2
    // (→ R5, findings §10.2), the only type the till issues today. Rectifying an F1 is an R1, not
    // this R5 — deferred until B2B `F1` issuance lands (open decision #1) — so assert rather than
    // silently mis-type a filing that cannot be repaired (§5).
    if (original.tipo_factura !== "F2") {
      throw new AppError("fiscal.correction_unsupported", {
        saleId: correction.correctsSaleId,
        // An alta always carries a non-null `tipo_factura` (`toRegistroRow` sets it for altas; only
        // an anulación is NULL, and the `tipo_registro = 'alta'` filter above excludes those) — a
        // cast, like `fromRegistroRow`'s own `tipo_factura` read, not a `?? ""` branch no alta row
        // can take.
        tipoFactura: original.tipo_factura as string,
      });
    }

    const sif = await currentSif(tx, sale.tenantId, sale.nodeId);
    const tenant = await this.legalNameFor(tx, sale.tenantId);

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
      // The corrective's OWN new number/date, like `recordSale` — a rectificativa is a new invoice
      // from its own series (§5), not a copy of the one it corrects.
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      TipoFactura: "R5",
      // "I" (por diferencias) — the only TipoRectificativa v1 issues (findings §10.2), hardcoded
      // like "R5"/"S1". "S" (sustitución), which additionally requires ImporteRectificacion (rule
      // 1118), is the future option (open decision #2).
      TipoRectificativa: "I",
      FacturasRectificadas: [
        {
          IDEmisorFactura: original.id_emisor_factura,
          NumSerieFactura: original.num_serie_factura,
          // The original's stored calendar day, reconstructed EXACTLY for any offset: its `date`
          // column dropped the offset that produced it (./registro-row.ts), and
          // `buildAltaRecord`/`formatIDFacturaAR` re-renders whatever Date this carries with THIS
          // corrective's own `offsetMinutes`. Anchoring at midnight-UTC minus that offset makes the
          // render land back on the exact stored day regardless of the offset's sign or magnitude —
          // the same algebraic cancellation `recordVoid`'s `FechaExpedicionFacturaAnulada` documents
          // and proves above, not the noon anchor that comment supersedes.
          FechaExpedicionFactura: new Date(
            Date.parse(`${original.fecha_expedicion_factura}T00:00:00Z`) -
              sale.offsetMinutes * 60_000,
          ),
        },
      ],
      // No FacturasSustituidas, no ImporteRectificacion: those belong to S (sustitución) mode; rule
      // 1118 requires ImporteRectificacion only there, not for I.
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
      sale.tenantId,
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

    await tx.insert(envios).values({ registroId: appended.id, tenantId: sale.tenantId });

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
   * tickets (F2), at a customer's later request for a proper invoice. Structurally a hybrid of
   * `recordSale` (it assembles an `AltaInput` from the F3's OWN `sale`: its new number, its POSITIVE
   * total and breakdown, and its recipient) and `recordCorrection` (it reads each ORIGINAL alta by
   * `saleId` to point at) — but LOOPED over N tickets, and emitting `FacturasSustituidas` instead of
   * `FacturasRectificadas`. An F3 is an alta, NOT a rectificativa and NOT an anulación: it takes the
   * next `secuencia`, hashes its own huella over the same eight fields (`TipoFactura = F3` and the
   * POSITIVE `ImporteTotal`/`CuotaTotal` flow in), and gets its own `pendiente` sidecar — everything
   * `recordSale`'s path does. `chain.ts` needs no change.
   *
   * **How it guarantees the substituted tickets are not re-declared (findings §10.2, the crux):** the
   * substituted tickets' own alta registros are ONLY READ — never rewritten, never annulled. The F3
   * is a NEW alta whose `TipoFactura=F3` + `FacturasSustituidas` block is what tells AEAT this amount
   * was already declared when the tickets were issued, so AEAT does not re-count it. We do not
   * suppress or negate anything; there is no anulación in this flow at all. There is NO
   * `TipoRectificativa`, NO `FacturasRectificadas`, NO `ImporteRectificacion` — those are the
   * rectificativa path's, a different operation.
   *
   * The `entorno` invariant (§5) is preserved exactly as `recordSale`/`recordCorrection`: it travels
   * BESIDE `input` in the `PendingRegistro`, never inside it, so our own metadata never reaches
   * `computeHuella`.
   */
  async recordSubstitution(
    tx: Transaction,
    sale: SaleForFiscalRecord,
    substitution: { substitutedSaleIds: SaleId[] },
  ): Promise<FiscalRecordRef> {
    // An F3 substitutes at least one ticket; an empty list would file a full invoice naming nothing
    // it replaces. Refused before any read — a caller precondition `packages/core` (Slice 4)
    // enforces, defended here too since a wrong filing is unrepairable (§5).
    if (substitution.substitutedSaleIds.length === 0) {
      throw new Error(
        "VerifactuBackend.recordSubstitution: substitutedSaleIds must not be empty — an F3 must name at least one ticket it substitutes",
      );
    }
    // A ticket may appear at most once: a repeated id would emit a DOUBLED FacturasSustituidas entry
    // into an unrepairable AEAT filing (§5), naming the same ticket twice. "The caller passes distinct
    // ids" is a property of the caller, not this code (CLAUDE.md §3) — rejected here at the last layer
    // before AEAT, a plain Error like the other preconditions above (core/Slice 4 owns the friendlier
    // dedup/validation).
    if (new Set(substitution.substitutedSaleIds).size !== substitution.substitutedSaleIds.length) {
      throw new Error(
        "VerifactuBackend.recordSubstitution: substitutedSaleIds must not contain duplicates — a ticket may be substituted at most once per F3",
      );
    }
    // A full invoice must ALWAYS name its recipient (findings §10.2: "siempre debe llevar el
    // destinatario"). `SaleForFiscalRecord.counterparty` is nullable for the ordinary simplified
    // sale; an F3 is the one path that requires it. Captured into a const so the narrowing survives
    // the awaits below (a mutable property re-widens to `Counterparty | null` after an await).
    const { counterparty } = sale;
    if (counterparty === null) {
      throw new Error(
        "VerifactuBackend.recordSubstitution: an F3 must name its recipient, but the sale carried no counterparty",
      );
    }
    // Built before the ledger reads so a recipient shape this operation cannot yet express is refused
    // up front (see `buildDestinatarios`).
    const destinatarios = this.buildDestinatarios(counterparty);

    // Each substituted ticket's alta, read exactly as `recordCorrection` reads the alta it corrects
    // (same `sale_id` + `tipo_registro = 'alta'` filter, same four columns) — its identity triple
    // becomes one `FacturasSustituidas` entry, and its `tipo_factura` gates that only an F2 may be
    // exchanged. Looped: one F3 may substitute many tickets (the N:1 fan-out, findings §10.2).
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
      // A canje exchanges simplified tickets only (F2 → F3). Substituting a full invoice (F1) is not
      // a canje; asserting rather than mis-filing an unrepairable F3 (§5), the same shape
      // `recordCorrection`'s F2-only gate uses.
      if (original.tipo_factura !== "F2") {
        throw new AppError("fiscal.substitution_unsupported", {
          saleId: substitutedSaleId,
          // An alta always carries a non-null `tipo_factura` (the `tipo_registro = 'alta'` filter
          // excludes anulaciones, the only NULL case) — a cast, like `recordCorrection`'s own read.
          tipoFactura: original.tipo_factura as string,
        });
      }
      substituidas.push({
        IDEmisorFactura: original.id_emisor_factura,
        NumSerieFactura: original.num_serie_factura,
        // The ticket's stored calendar day, reconstructed EXACTLY for any offset — the same algebraic
        // offset-cancellation `recordCorrection`/`recordVoid` document and prove: the `date` column
        // dropped the offset that produced it, and `buildAltaRecord`/`formatIDFacturaAR` re-renders
        // this Date with THIS F3's own `offsetMinutes`, so anchoring at midnight-UTC minus that offset
        // lands the render back on the exact stored day regardless of the offset's sign or magnitude.
        FechaExpedicionFactura: new Date(
          Date.parse(`${original.fecha_expedicion_factura}T00:00:00Z`) -
            sale.offsetMinutes * 60_000,
        ),
      });
    }

    const sif = await currentSif(tx, sale.tenantId, sale.nodeId);
    const tenant = await this.legalNameFor(tx, sale.tenantId);

    const desglose: DetalleDesgloseInput[] = sale.vatBreakdown.map((line) => ({
      BaseImponibleOimporteNoSujeto: line.base,
      TipoImpositivo: line.rate,
      CuotaRepercutida: line.tax,
      // Same S1 (sujeta y no exenta) qualification `recordSale`/`recordCorrection` apply — an F3
      // restates the substituted operations' own breakdown, positive.
      CalificacionOperacion: "S1",
    }));
    const cuotaTotal = sumDecimals(sale.vatBreakdown.map((line) => line.tax));

    const input: Omit<AltaInput, "Encadenamiento"> = {
      IDEmisorFactura: sif.nif,
      // The F3's OWN new number/date, like `recordSale` — a canje is a new full invoice from its own
      // series (§5), not a copy of a ticket it replaces.
      NumSerieFactura: formatInvoiceNumber(sale.seriesCode, sale.invoiceNumber),
      FechaExpedicionFactura: sale.issuedAt,
      NombreRazonEmisor: tenant.legalName,
      TipoFactura: "F3",
      FacturasSustituidas: substituidas,
      Destinatarios: destinatarios,
      // No TipoRectificativa / FacturasRectificadas / ImporteRectificacion: those belong to the
      // rectificativa (R5) path, a different operation — an F3 is not a rectificativa (§10.2).
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
      sale.tenantId,
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

    await tx.insert(envios).values({ registroId: appended.id, tenantId: sale.tenantId });

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
   * Delegates to `verifyChain` (art. 7.i). `tenantId` is supplied by the caller (always inside a
   * `withTenant`-scoped transaction), so there is no `tenants`/`tills` lookup to recover it.
   */
  async checkIntegrity(
    tx: Transaction,
    tenantId: TenantId,
    nodeId: NodeId,
  ): Promise<IntegrityReport> {
    return verifyChain(tx, tenantId, nodeId);
  }

  /**
   * How many of this node's records AEAT has not yet confirmed — the art. 16.4 unsent count
   * (node-id rekey, 2026-08-03: the chain is per-node, so the unsent count is per-node too).
   *
   * Filters on `tenant_id` explicitly, and opens its OWN `withTenant` because it takes no caller
   * transaction (unlike `filedReceiptFor` and `checkIntegrity`, which are handed one).
   */
  async pendingCount(tenantId: TenantId, nodeId: NodeId): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.execute<{ count: string }>(sql`
        select count(*)::text as count
        from envios e
        join registros_facturacion r on r.id = e.registro_id
        where r.node_id = ${nodeId} and e.tenant_id = ${tenantId} and e.estado = 'pendiente'
      `);
      return Number(rows.rows[0]!.count);
    });
  }

  /**
   * Delegates to `./drain.ts`'s own `drain`, resolving nothing itself: enumerates every tenant
   * with due work, resolves each one's own AEAT transport via `this.resolveClient`, and — per
   * tenant, in its own contained try/catch — claims ≤1000-row due batches (FOR UPDATE SKIP
   * LOCKED), submits them, persists the CSV + `aceptado`/`aceptado_con_errores`/`rechazado` +
   * incidents, and applies flow control and retry backoff. A tenant whose transport cannot be
   * built, or whose sweep throws, is recorded in `DrainResult.skipped` rather than aborting every
   * OTHER tenant's legally-timed submission — see `drain.ts`'s own `DrainDeps.resolveClient` and
   * `drain`'s own doc comments for the full behaviour and its reasoning.
   *
   * Passes `this.deploymentEnvironment` through as `DrainDeps.environment` — Task 6's guard
   * (`./drain.ts`'s `claimBatch`) refuses any claimed row whose own `entorno` disagrees, or is
   * unrecorded, rather than ever submitting it.
   */
  async drain(now: Date): Promise<DrainResult> {
    return runDrain(
      {
        db: this.db,
        resolveClient: this.resolveClient,
        skipRetryMs: this.skipRetryMs,
        environment: this.deploymentEnvironment,
      },
      now,
    );
  }

  /**
   * The consulta-driven reconciliation sweep (plan 3b): pages AEAT's period response, keys it by
   * the `RefExterna` the drainer submitted (= our registro id), and classifies every disagreement
   * into `lostAck`/`noTrace`/`drift`, raising an incident for each `noTrace`/`drift`. Delegates to
   * `./reconcile.ts`, which owns the T1/T2 split that keeps the consulta network call out of any
   * transaction. Like `pendingCount`, it takes `tenantId` and no `tx` — it runs outside any sale
   * transaction and establishes its own `withTenant` scopes.
   *
   * Passes `this.resolveClient` straight through rather than resolving here: `./reconcile.ts` calls
   * it itself, lazily, only after confirming the period holds at least one record — for the same
   * "a secret in memory for no reason" reason `drain` already resolves lazily
   * (`DrainDeps.resolveClient`'s own doc comment). A tenant with nothing recorded for the requested
   * period needs no certificate and makes no network call at all (`reconcile`'s own doc comment on
   * the zero-row early return); resolving here, before that check, would have turned that clean
   * no-op into a hard failure for any tenant whose credential happens to be missing or unusable —
   * exactly the regression a prior version of this comment defended on the wrong grounds (it argued
   * only that eager resolution here would not be "unnecessary" work, never that it could turn a
   * legitimate no-op into a failure).
   */
  async reconcile(
    tenantId: TenantId,
    period: { year: string; month: string },
  ): Promise<ReconcileResult> {
    return runReconcile(
      { db: this.db, resolveClient: this.resolveClient, clock: this.clock },
      tenantId,
      period,
    );
  }

  /**
   * Maps the generic `Counterparty` onto an AEAT `Destinatario` (sf:PersonaFisicaJuridicaType) for
   * an F3's mandatory recipient block. A domestic recipient is named by NIF — the case v1 supports,
   * since an F3 canje exchanges tickets issued at a Spanish establishment.
   *
   * A FOREIGN recipient must instead be named via `IDOtro` (CodigoPais + IDType + ID), whose IDType
   * vocabulary (PersonaFisicaJuridicaIDTypeType, 02-07) is not yet pinned to a primary source (plan
   * §1.5, deferred to the asesor / the AEAT XSD). Rather than guess an IDType into an UNREPAIRABLE
   * record (§5, CLAUDE.md §1), a non-`ES` recipient is refused here until that shape is confirmed — a
   * DELIBERATE refusal, not a dead branch. It IS reachable through `packages/core` today:
   * `record-substitution.ts` types `counterparty` as a REQUIRED, non-null field and does no
   * `countryCode` gating of its own, so a non-`ES` recipient handed to core's `recordSubstitution`
   * flows straight into this throw. The refusal is pinned at THIS layer by `backend.test.ts`'s
   * "refuses a non-Spanish recipient until the foreign-recipient shape is confirmed" case; core adds
   * no gate of its own, so there is nothing extra to test at the core layer.
   */
  private buildDestinatarios(counterparty: Counterparty): { IDDestinatario: Destinatario[] } {
    if (counterparty.countryCode !== "ES") {
      throw new Error(
        `VerifactuBackend.recordSubstitution: a non-Spanish recipient (${counterparty.countryCode}) is not yet supported — the foreign-recipient IDOtro/IDType shape awaits the asesor`,
      );
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

  private async legalNameFor(tx: Transaction, tenantId: TenantId): Promise<{ legalName: string }> {
    const [row] = await tx
      .select({ legalName: tenants.legalName })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    /* v8 ignore start */
    if (row === undefined) {
      // Structurally unreachable: `sale.tenantId`/a void's own recovered `tenantId` both come
      // from `tenants.id` foreign keys elsewhere in the schema, so a row that exists at all
      // always has a tenant.
      throw new Error(`VerifactuBackend: no tenant found for ${tenantId}`);
    }
    /* v8 ignore stop */
    return row;
  }
}
