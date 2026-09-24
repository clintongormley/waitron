// Keeps errors.ts's codes reachable from the throwing file (scripts/errors-reachable.test.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { UNIQUE_VIOLATION, checkFailed, isRefusal, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { PrintTransport } from "@waitron/print-agent";
import type { CharacterSet } from "./charset.js";
import type { PaperWidth, Resolution } from "./layout.js";

/**
 * Maps a refused printer write to a domain code, or rethrows. The CHECK branch names its constraint
 * because `printers` has other CHECKs (e.g. `printers_character_table_ck`) that are not a missing
 * transport field. The unique branch needs no name: the only other unique key is the `id` primary key,
 * which neither write here supplies.
 */
function translatePrinterWriteError(error: unknown, localKey: string | undefined): never {
  if (localKey !== undefined && isRefusal(error, UNIQUE_VIOLATION)) {
    throw new AppError("printer.already_registered", { localKey });
  }
  if (checkFailed(error, "printers_transport_fields_ck")) {
    throw new AppError("printer.invalid_config", { reason: "transport_fields" });
  }
  throw error;
}

/** The venue scope, resolved by the route and never derived from client input. */
export interface PrintConfig {
  locationId: string;
}

/** How a printer is reached — the `print_transport` column; the union lives in `@waitron/print-agent`. */
export type { PrintTransport } from "@waitron/print-agent";

export interface CreatePrinterInput {
  name: string;
  transport: PrintTransport;
  host?: string;
  port?: number;
  localKey?: string;
  pollId?: string;
  paperWidth?: PaperWidth;
  resolution?: Resolution;
  characterSet?: CharacterSet;
  characterTable?: number;
}

/**
 * Mirrors the `printers_transport_fields_ck` CHECK, which stays the backstop; checking first lets the
 * refusal name the missing field.
 */
const REQUIRED_FIELDS: Record<PrintTransport, readonly (keyof CreatePrinterInput)[]> = {
  usb: ["localKey"],
  bluetooth: ["localKey"],
  network_tcp: ["host"],
  cloud_poll: ["pollId"],
};

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
        locationId: cfg.locationId,
        name: input.name,
        transport: input.transport,
        // drizzle omits an undefined field, so it takes its column default.
        host: input.host,
        port: input.port,
        localKey: input.localKey,
        pollId: input.pollId,
        paperWidth: input.paperWidth,
        resolution: input.resolution,
        characterSet: input.characterSet,
        characterTable: input.characterTable,
      })
      .returning({ id: printers.id });
    return { id: row!.id };
  } catch (error) {
    return translatePrinterWriteError(error, input.localKey);
  }
}

/** An absent field is left unchanged; an explicit `null` clears a connection field. */
export interface UpdatePrinterInput {
  name?: string;
  transport?: PrintTransport;
  host?: string | null;
  port?: number | null;
  localKey?: string | null;
  pollId?: string | null;
  ticketScope?: "station" | "order";
  paperWidth?: PaperWidth;
  resolution?: Resolution;
  characterSet?: CharacterSet;
  characterTable?: number;
  active?: boolean;
}

export interface PrinterRow {
  id: string;
  name: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  localKey: string | null;
  pollId: string | null;
  ticketScope: "station" | "order";
  paperWidth: PaperWidth;
  resolution: Resolution;
  characterSet: CharacterSet;
  characterTable: number;
  active: boolean;
}

/** One tenant per database, so the id alone selects the row. */
export async function updatePrinter(
  tx: Transaction,
  cfg: PrintConfig,
  id: string,
  patch: UpdatePrinterInput,
): Promise<void> {
  void cfg;
  // Undefined keys are dropped here so a `{ name: undefined }` patch still takes the empty-patch path.
  const set: Record<string, unknown> = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );

  // drizzle's `.set({})` throws ("No values to set"), so an empty patch is an existence check.
  if (Object.keys(set).length === 0) {
    const [exists] = await tx.select({ id: printers.id }).from(printers).where(eq(printers.id, id));
    if (exists === undefined) throw new AppError("printer.not_found", { id });
    return;
  }

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(printers)
      .set(set)
      .where(eq(printers.id, id))
      .returning({ id: printers.id });
  } catch (error) {
    return translatePrinterWriteError(error, patch.localKey ?? undefined);
  }
  if (updated.length === 0) throw new AppError("printer.not_found", { id });
}

/**
 * Never a hard delete: `print_jobs.printer_id` references the row. A deactivated printer refuses new
 * jobs and its queued ones wait, unclaimed, until it is reactivated.
 */
export async function deactivatePrinter(
  tx: Transaction,
  cfg: PrintConfig,
  id: string,
): Promise<void> {
  void cfg;
  const updated = await tx
    .update(printers)
    .set({ active: false })
    .where(eq(printers.id, id))
    .returning({ id: printers.id });
  if (updated.length === 0) throw new AppError("printer.not_found", { id });
}

/** Includes deactivated printers, so the dashboard can show and reactivate them. */
export async function listPrinters(tx: Transaction, cfg: PrintConfig): Promise<PrinterRow[]> {
  void cfg;
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
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      characterSet: printers.characterSet,
      characterTable: printers.characterTable,
      active: printers.active,
    })
    .from(printers)
    .orderBy(printers.name);
}
