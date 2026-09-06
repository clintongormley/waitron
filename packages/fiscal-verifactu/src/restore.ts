import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ProvisionedNode, RestoreHook, RestoreOutcome } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { currentSif, registerSif, type SifRegistration } from "./registro-sif.js";
import { deriveReservedSeriesCodes, liveSeriesBases } from "./reserved-series.js";
import { contadoresInstalacion } from "./schema/sif.js";

const FLOOR_EPOCH_MS = Date.UTC(2020, 0, 1);

/**
 * Whole seconds since 2020-01-01T00:00:00Z, used to raise the restored counter's floor.
 * A restore in the same second, or on a clock behind the prior restore, can compute the same floor
 * (spec §3.5). `greatest` keeps a higher stored counter; `registro_sif_instalacion_uq` refuses reuse
 * of an installation number still in the database. Neither protects history absent from an older
 * dump when the clock has not advanced beyond it. Fits `integer` until 2088.
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
 * With a live SIF, read the node's live series bases, raise the counter floor, and call `registerSif`
 * under the live row's NIF + software id: that pair identifies the counter. Return derived codes for
 * the orchestrator to open. An overlong base throws inside the restore transaction; on rollback,
 * nothing the hook wrote persists. Without a live SIF, mint nothing and omit `series`:
 * the restore does not make the node a filing node. Writes nothing to `invoice_series`.
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
