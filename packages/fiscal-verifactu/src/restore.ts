import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ProvisionedNode, RestoreHook, RestoreOutcome } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { currentSif, registerSif, type SifRegistration } from "./registro-sif.js";
import { deriveReservedSeriesCodes, liveSeriesBases } from "./reserved-series.js";
import { contadoresInstalacion } from "./schema/sif.js";

const FLOOR_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * The installation-number floor a restore raises the counter to: whole seconds since
 * 2020-01-01T00:00:00Z. The counter row is in the dump, so restoring an artifact older than a
 * previous restore's minting would otherwise re-mint that number; the wall clock is the one
 * monotonic state a sole box has that a restore does not roll back (spec §3.5). Fits `integer`
 * until 2088.
 */
export function installationFloor(now: Date): number {
  return Math.floor((now.getTime() - FLOOR_EPOCH_MS) / 1000);
}

/**
 * Raise `contadores_instalacion` for `(nif, id_sistema_informatico)` to at least `floor`, creating
 * the row when the restored database has none (a promoted standby's backup never wrote the counter:
 * `writeReservedSif` does not touch it). Never lowers it. The next `registerSif` mints `floor` or more.
 */
export async function raiseInstallationFloor(
  tx: Transaction,
  params: { nif: string; idSistemaInformatico: string; floor: number },
): Promise<void> {
  await tx
    .insert(contadoresInstalacion)
    .values({
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      proximoNumero: params.floor,
    })
    .onConflictDoUpdate({
      target: [contadoresInstalacion.nif, contadoresInstalacion.idSistemaInformatico],
      set: {
        proximoNumero: sql`greatest(${contadoresInstalacion.proximoNumero}, ${params.floor})`,
      },
    });
}

/**
 * The fiscal module's restore hook body (spec §6). With a live SIF: read the node's live series bases
 * (refusing one that cannot carry a suffix, before anything is minted), raise the counter floor,
 * `registerSif` under the identity IN USE (the live row's NIF + software id — the counter is keyed by
 * that pair), and return the derived disjoint codes for the orchestrator to open. Without a live SIF
 * the node is not a filing node and the restore does not make it one: nothing minted, `series`
 * absent. Writes nothing to `invoice_series`.
 */
export async function restoreFiscal(
  tx: Transaction,
  node: ProvisionedNode,
  now: Date,
): Promise<RestoreOutcome> {
  let live: SifRegistration;
  try {
    live = await currentSif(tx, node.tenantId, node.nodeId);
  } catch (err) {
    if (isAppError(err) && err.code === "sif.not_registered") {
      return {
        report: `node ${node.nodeId} holds no live SIF; nothing re-registered, series unchanged`,
      };
    }
    throw err;
  }
  const bases = await liveSeriesBases(tx, node);
  await raiseInstallationFloor(tx, {
    nif: live.nif,
    idSistemaInformatico: live.idSistemaInformatico,
    floor: installationFloor(now),
  });
  const fresh = await registerSif(tx, {
    tenantId: node.tenantId,
    nodeId: node.nodeId,
    nif: live.nif,
    idSistemaInformatico: live.idSistemaInformatico,
  });
  const series = deriveReservedSeriesCodes(bases, fresh.numeroInstalacion);
  return {
    report: `SIF ${fresh.id} (installation ${fresh.numeroInstalacion}); series ${series.map((s) => s.code).join(", ")}`,
    series,
  };
}

/** The wired hook: {@link restoreFiscal} with the wall clock. */
export const FISCAL_RESTORE: RestoreHook = (tx, node) => restoreFiscal(tx, node, new Date());
