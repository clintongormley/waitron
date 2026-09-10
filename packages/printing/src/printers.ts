// Side-effect only: keeps this package's `printer.*` codes (errors.ts) reachable from the file that
// throws them — the reachability convention every code-throwing file in the tree follows, guarded
// tree-wide by scripts/errors-reachable.test.ts. See errors.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { isPgError, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { PrintTransport } from "@waitron/print-agent";

/** The pg SQLSTATEs a printer write may raise once the app-layer required-field pre-check passes, so a
 * driver error becomes a friendly domain code instead of an opaque 500. `23514` is the
 * `printers_transport_fields_ck` CHECK (a transport whose required fields are absent — the DB backstop
 * behind `REQUIRED_FIELDS`); `23505` is the partial UNIQUE `printers_local_key_key` on
 * `(tenant_id, location_id, local_key)` (a create/re-key whose device id already names a printer in
 * this venue). Both are matched down the cause chain by `@waitron/db`'s shared `isPgError` (Drizzle
 * wraps every failed query in a `DrizzleQueryError` whose own `.code` is undefined — the SQLSTATE lives
 * on `.cause.code` under node-postgres, or one level deeper under PGlite). */
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

/**
 * Translate a printer write's driver error into a friendly domain code, or rethrow. A unique violation
 * on `printers_local_key_key` (the device id in this write already names a printer in this venue)
 * becomes `printer.already_registered`; the transport-fields CHECK violation becomes
 * `printer.invalid_config`. Anything else propagates unchanged (the route boundary opaques it to a
 * 500). `localKey` is echoed on `printer.already_registered` so the dashboard can point at the existing
 * registration; a CHECK violation carries the stable `transport_fields` reason (the specific missing
 * field is unknowable from the SQLSTATE alone — `createPrinter`'s pre-check names it precisely on the
 * common path).
 */
function translatePrinterWriteError(error: unknown, localKey: string | undefined): never {
  if (localKey !== undefined && isPgError(error, UNIQUE_VIOLATION)) {
    throw new AppError("printer.already_registered", { localKey });
  }
  if (isPgError(error, CHECK_VIOLATION)) {
    throw new AppError("printer.invalid_config", { reason: "transport_fields" });
  }
  throw error;
}

/**
 * The tenant + venue scope every central printing verb (`createPrinter`, `enqueuePrintJob`) runs
 * under. The route resolves it (single-tenant deli deployment, `deps.tenantId` + the location) and
 * passes it down, so these verbs never derive scope from client input — the same discipline
 * `PrintAgentConfig` (agent.ts) states for the agent verbs, and structurally identical to it.
 */
export interface PrintConfig {
  tenantId: string;
  locationId: string;
}

/** How a printer is reached — the `print_transport` pgEnum; the union lives in `@waitron/print-agent`. */
export type { PrintTransport } from "@waitron/print-agent";

/**
 * The minimal shape `createPrinter` accepts (printing subsystem, §2b). The connection fields are all
 * transport-specific and optional at the type level; which ones a given transport REQUIRES is checked
 * before the write (see `createPrinter`). `port` defaults to 9100 in the DB when omitted. `ticket_scope`
 * (Slice B) and `poll_token_hash` (cloud_poll auth) are deliberately NOT here — this is the minimal
 * create verb Task 4's outbox needs; richer printer config is Task 6/7.
 */
export interface CreatePrinterInput {
  name: string;
  transport: PrintTransport;
  host?: string;
  port?: number;
  localKey?: string;
  pollId?: string;
}

/**
 * The connection fields each transport's adapter REQUIRES present (printing subsystem §2b) — the
 * app-layer mirror of the `printers_transport_fields_ck` CHECK in
 * packages/db/drizzle/0014_central_printer_provisioning_sql.sql: usb/bluetooth need `local_key` (the
 * USB serial / Bluetooth MAC — the stable device id an agent matches at run time); network_tcp needs a
 * `host` (port defaults to 9100); cloud_poll needs a `poll_id` (no agent — it self-polls). No transport
 * requires an agent binding: which agent serves a printer is discovered at run time from the devices it
 * can see, never stored (schema/printers.ts). The DB CHECK + the partial UNIQUE remain the INTEGRITY
 * backstop; this pre-check exists only to turn a missing field into a friendly `printer.invalid_config`
 * instead of a raw 23514 constraint violation. It asserts required fields are PRESENT, not that the
 * others are absent — matching the CHECK exactly.
 */
const REQUIRED_FIELDS: Record<PrintTransport, readonly (keyof CreatePrinterInput)[]> = {
  usb: ["localKey"],
  bluetooth: ["localKey"],
  network_tcp: ["host"],
  cloud_poll: ["pollId"],
};

/**
 * Create a managed printer (printing subsystem, §2b) — a single INSERT into `printers`. This is the
 * MINIMAL create verb Task 4's outbox test needs (Controller Ruling 1); update/deactivate/list are
 * Task 6 and the config UI is Task 7.
 *
 * The only app-layer validation is a required-field presence pre-check (`REQUIRED_FIELDS`), which
 * throws `printer.invalid_config` with a stable English `reason` (e.g. `network_tcp_missing_host`).
 * Everything else — the transport CHECK, the local_key uniqueness — is enforced by the DB
 * (`printers_transport_fields_ck` + the partial UNIQUE `printers_local_key_key`), proven in
 * packages/db's printing.test.ts, so this verb stays a thin insert.
 */
export async function createPrinter(
  tx: Transaction,
  cfg: PrintConfig,
  input: CreatePrinterInput,
): Promise<{ id: string }> {
  const missing = REQUIRED_FIELDS[input.transport].find((field) => input[field] === undefined);
  if (missing !== undefined) {
    throw new AppError("printer.invalid_config", {
      reason: `${input.transport}_missing_${missing}`,
    });
  }

  try {
    const [row] = await tx
      .insert(printers)
      .values({
        tenantId: cfg.tenantId,
        locationId: cfg.locationId,
        name: input.name,
        transport: input.transport,
        // Undefined connection fields are OMITTED by drizzle, so each falls to its column default —
        // NULL for the transport-specific columns, 9100 for `port` (schema/printers.ts).
        host: input.host,
        port: input.port,
        localKey: input.localKey,
        pollId: input.pollId,
      })
      .returning({ id: printers.id });
    return { id: row!.id };
  } catch (error) {
    // A local_key that already names a printer in this venue raises the partial UNIQUE's 23505,
    // mapped to a friendly `printer.already_registered` rather than an opaque 500.
    return translatePrinterWriteError(error, input.localKey);
  }
}

/**
 * The fields a `printer.manage` operator may edit on an existing printer (design §6, the Impresoras
 * config form). Every field is OPTIONAL — a PATCH touches only what it names — and the connection
 * fields accept an explicit `null` to CLEAR them (e.g. de-registering a device before re-pairing),
 * which `undefined` (absent) does not. `transport`/`ticketScope`/`active` round out the editable
 * config. The transport-fields CHECK and the partial local_key UNIQUE remain the DB INTEGRITY
 * backstop, so a partial edit that leaves a transport short of a required field surfaces as
 * `printer.invalid_config` (23514) and a re-key to an already-registered device as
 * `printer.already_registered` (23505), never a raw constraint 500.
 */
export interface UpdatePrinterInput {
  name?: string;
  transport?: PrintTransport;
  host?: string | null;
  port?: number | null;
  localKey?: string | null;
  pollId?: string | null;
  ticketScope?: "station" | "order";
  active?: boolean;
}

/** One printer's config row as the management surface lists/reads it (design §6). */
export interface PrinterRow {
  id: string;
  name: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  localKey: string | null;
  pollId: string | null;
  ticketScope: "station" | "order";
  active: boolean;
}

/**
 * Apply a partial edit to a printer (design §6). Only the fields PRESENT in `patch` are written —
 * an absent field is left unchanged, an explicit `null` clears a nullable one — so the caller's
 * screen decides what changes. `0` rows updated (an unknown id or one excluded by the tenant
 * predicate) → `printer.not_found`. The transport-fields CHECK / local_key UNIQUE are the DB backstop,
 * translated to `printer.invalid_config` / `printer.already_registered` (`createPrinter`'s reasoning,
 * for the update path). The explicit tenant predicate limits the update to `cfg.tenantId`; all values
 * bind as `$n`.
 */
export async function updatePrinter(
  tx: Transaction,
  cfg: PrintConfig,
  id: string,
  patch: UpdatePrinterInput,
): Promise<void> {
  // The SET is `patch` with every undefined-valued key dropped, so it carries ONLY the fields the edit
  // names — an absent field is left untouched, an explicit `null` is written to clear a nullable one.
  // Filtering here (rather than trusting the caller to omit undefined keys) keeps the empty-patch
  // short-circuit below correct for ANY caller: a future `{ name: maybeUndef }` would otherwise spread
  // `name: undefined` into `.set(...)` and defeat it → a drizzle "No values to set" 500 instead of the
  // clean no-op/404.
  const set: Record<string, unknown> = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );

  // An empty patch (no field named) is a legitimate no-op — but drizzle's `.set({})` THROWS ("No
  // values to set"), so short-circuit to an existence check: a missing id is still a clean 404, a
  // present one a no-op. `printers` carries no `updated_at`, so there is nothing an empty edit would
  // touch anyway.
  if (Object.keys(set).length === 0) {
    const [exists] = await tx
      .select({ id: printers.id })
      .from(printers)
      .where(and(eq(printers.tenantId, cfg.tenantId), eq(printers.id, id)));
    if (exists === undefined) throw new AppError("printer.not_found", { id });
    return;
  }

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(printers)
      .set(set)
      .where(and(eq(printers.tenantId, cfg.tenantId), eq(printers.id, id)))
      .returning({ id: printers.id });
  } catch (error) {
    return translatePrinterWriteError(error, patch.localKey ?? undefined);
  }
  if (updated.length === 0) throw new AppError("printer.not_found", { id });
}

/**
 * Deactivate a printer (design §2b/§6) — flip `active = false`, NEVER a hard DELETE: a
 * `print_jobs` history references it and `app_user` holds no DELETE on `printers`. `0` rows
 * (unknown id or one excluded by the tenant predicate) → `printer.not_found`. The explicit tenant
 * predicate limits the update to `cfg.tenantId`; values bind as `$n`.
 *
 * `active = false` DISABLES the printer for both directions, not a soft-hide from the list: enqueue
 * rejects it as `printer.not_found` (`enqueuePrintJob`'s `active = true` pre-check) and the agent stops
 * pulling AND lease-reclaiming its jobs (`claimPrintJobs`'s `p.active = true` conjunct), so any
 * queued/in-flight jobs simply wait, unclaimed, until it is reactivated (via `updatePrinter`).
 */
export async function deactivatePrinter(
  tx: Transaction,
  cfg: PrintConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(printers)
    .set({ active: false })
    .where(and(eq(printers.tenantId, cfg.tenantId), eq(printers.id, id)))
    .returning({ id: printers.id });
  if (updated.length === 0) throw new AppError("printer.not_found", { id });
}

/**
 * List this tenant's printers by name (design §6, the Impresoras surface). `printers` carries no
 * created_at, so the stable order for a config list is `name` rather than an insertion proxy. The
 * explicit tenant predicate limits the read to `cfg.tenantId`, matching `authenticateAgent` and
 * `enqueuePrintJob`. Returns both active and deactivated printers so the surface can show and
 * reactivate them.
 */
export async function listPrinters(tx: Transaction, cfg: PrintConfig): Promise<PrinterRow[]> {
  return tx
    .select({
      id: printers.id,
      name: printers.name,
      transport: printers.transport,
      host: printers.host,
      port: printers.port,
      localKey: printers.localKey,
      pollId: printers.pollId,
      ticketScope: printers.ticketScope,
      active: printers.active,
    })
    .from(printers)
    .where(eq(printers.tenantId, cfg.tenantId))
    .orderBy(printers.name);
}
