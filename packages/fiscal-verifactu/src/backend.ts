import { eq, sql } from "drizzle-orm";
import { tenants, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { AppError, sumDecimals } from "@waitron/shared";
import type { SaleId, TenantId, TillId } from "@waitron/shared";
import type {
  DrainResult,
  FiscalBackend,
  FiscalRecordRef,
  IntegrityReport,
  ReconcileResult,
  SaleForFiscalRecord,
  TillRegistration,
  TrustedClock,
} from "@waitron/fiscal";
import { formatInvoiceNumber } from "@waitron/core";
import { buildQrPayload } from "@waitron/verifactu";
import type {
  AltaInput,
  AnulacionInput,
  DetalleDesgloseInput,
  Environment,
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

/** `FiscalRecordRef.backend`/`TillRegistration.backend` — the regime-neutral interface's own
 * "which module produced this" tag. */
const BACKEND_ID = "verifactu";

/**
 * Software-identity fields of `SistemaInformatico` that describe THIS PRODUCT rather than any
 * one tenant, till, or sale — Waitron's own claims about what it is and how it may be used.
 * `IdSistemaInformatico` and `NumeroInstalacion` are deliberately absent from this shape: both
 * are per-(NIF, till) facts already minted by `registerSif` and read back from `registro_sif` via
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
   * tillId)` takes no transaction at all, so it needs its OWN `db` handle below rather than one a
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
   * by `recordSale`/`recordVoid`/`registerTill`/`checkIntegrity`/`pendingCount` — none of those
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
  "tenant_id" | "till_id" | "id_emisor_factura" | "num_serie_factura" | "fecha_expedicion_factura"
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
 * `registerTill`/`recordVoid`/`checkIntegrity`/`pendingCount` complete the interface (TypeScript
 * requires every one of them) but are secondary to that deliverable; see each method's own doc
 * comment for what it does and does not cover, and this task's report for what remains unverified
 * about them.
 */
export class VerifactuBackend implements FiscalBackend {
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
   * Confirms — rather than performs — a till's Veri*Factu provisioning.
   *
   * The generic `FiscalBackend.registerTill(tx, tillId, { tenantId })` signature carries no NIF
   * and no `IdSistemaInformatico`, so it cannot mint a NEW SIF identity: `registerSif`
   * (`./registro-sif.ts`) genuinely needs both, and both are regime-specific provisioning
   * inputs the generic interface has no room for. `registerSif`'s own doc comment already frames
   * first-time (and re-)registration as a rare, sequential, admin-only action performed once,
   * outside the ordinary sale flow — so this method reads back whatever `registerSif` already
   * established via `currentSif`, and reports `sif.not_registered` (thrown by `currentSif`
   * itself) exactly like any other caller that reaches a till with no live SIF identity.
   */
  async registerTill(
    tx: Transaction,
    tillId: TillId,
    params: { tenantId: TenantId },
  ): Promise<TillRegistration> {
    const sif = await currentSif(tx, params.tenantId, tillId);
    return {
      backend: BACKEND_ID,
      tillId,
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
    const sif = await currentSif(tx, sale.tenantId, sale.tillId);
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
      sale.tillId,
      { tipo: "alta", saleId: sale.saleId, entorno: this.deploymentEnvironment, input },
      sif,
    );

    // Step 6. `pendiente`, `intentos: 0`, `csv: null` are every one of this column's own
    // defaults (`./schema/envios.ts`) — nothing here has been sent anywhere, which is the whole
    // point of a write path that must never contact AEAT.
    await tx.insert(envios).values({ registroId: appended.id, tenantId: sale.tenantId });

    return {
      backend: BACKEND_ID,
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
      select tenant_id, till_id, id_emisor_factura, num_serie_factura, fecha_expedicion_factura
      from registros_facturacion
      where sale_id = ${saleId} and tipo_registro = 'alta'
      limit 1
    `);
    const original = rows[0];
    if (original === undefined) {
      throw new AppError("fiscal.sale_not_recorded", { saleId });
    }

    const tenantId = original.tenant_id as TenantId;
    const tillId = original.till_id as TillId;
    const sif = await currentSif(tx, tenantId, tillId);
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
      tillId,
      { tipo: "anulacion", saleId, entorno: this.deploymentEnvironment, input },
      sif,
    );

    await tx.insert(envios).values({ registroId: appended.id, tenantId });

    return {
      backend: BACKEND_ID,
      recordId: appended.id,
      state: "pending",
      issuedAt: now.instant,
      offsetMinutes: now.offsetMinutes,
    };
  }

  /**
   * Delegates to `verifyChain` (art. 7.i). `tenantId` is supplied by the caller (always inside a
   * `withTenant`-scoped transaction), so there is no `tenants`/`tills` lookup to recover it.
   */
  async checkIntegrity(
    tx: Transaction,
    tenantId: TenantId,
    tillId: TillId,
  ): Promise<IntegrityReport> {
    return verifyChain(tx, tenantId, tillId);
  }

  /**
   * How many of this till's records AEAT has not yet confirmed — the art. 16.4 unsent count.
   *
   * Filters on `tenant_id` explicitly (defense-in-depth alongside the RLS policy). `withTenant`
   * sets `app.tenant_id` (transaction-local) so `current_tenant_id()` resolves and the RLS
   * tenant-isolation policy matches this tenant's rows. Without it, a non-superuser deployment
   * role sees NULL and counts zero — the art. 16.4 gap. On PGlite (superuser) the GUC is set but
   * irrelevant; the count is correct either way, which is why only real Postgres proves this
   * (`pending-count.rls.test.ts`).
   */
  async pendingCount(tenantId: TenantId, tillId: TillId): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.execute<{ count: string }>(sql`
        select count(*)::text as count
        from envios e
        join registros_facturacion r on r.id = e.registro_id
        where r.till_id = ${tillId} and e.tenant_id = ${tenantId} and e.estado = 'pendiente'
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
