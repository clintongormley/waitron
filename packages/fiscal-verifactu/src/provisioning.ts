import { tenants, type Transaction } from "@waitron/db";
import type { ModuleProvisioning, StandbyReservation } from "@waitron/module";
import { AppError } from "@waitron/shared";
// Side-effect only: registers this package's `sif.*` codes on the shared registry. See ./errors.ts.
import "./errors.js";
import {
  currentSif,
  ID_SISTEMA_MAX_LENGTH,
  registerSif,
  reserveInstallationNumber,
  writeReservedSif,
} from "./registro-sif.js";
import { deriveReservedSeriesCodes, liveSeriesBases } from "./reserved-series.js";

/** Waitron's own AEAT-registered software identifier (FAQ §4, ≤ 2 chars): a product constant, never
 * operator input. It reaches `registro_sif.id_sistema_informatico` through `registerSif` and, from
 * there, `IdSistemaInformatico` on every registro the node files. */
export const WAITRON_ID_SISTEMA = "W1";

/** The obligado's NIF: the `tax_id` of the one taxpayer row. Read here, never an argument — an
 * operator-supplied NIF would file a real venue's sales under someone else's.
 *
 * An empty `tenants` table is a database with no taxpayer at all. Provisioning writes that row
 * before it seeds any module, and no foreign key enforces it any more (they went with the tenant
 * columns), so this is reachable only by a corrupt or half-provisioned database: a plain `Error`
 * naming that state, not a domain code, for the same reason `readStandardSeriesIdTx`
 * (`@waitron/db`) uses one. */
async function obligadoNif(tx: Transaction): Promise<string> {
  const [row] = await tx.select({ taxId: tenants.taxId }).from(tenants).limit(1);
  if (row === undefined) {
    throw new Error("fiscal seed: tenants is empty, so there is no taxpayer to file under");
  }
  return row.taxId;
}

/** The dormant identity the primary reserves for a standby; rides the mirror bundle as opaque state. */
interface ReservedSifState {
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: number;
}

function parseReservedState(state: unknown): ReservedSifState {
  if (state === undefined) {
    throw new AppError("sif.reservation_invalid", {
      reason: "no reservation state for the fiscal module",
    });
  }
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new AppError("sif.reservation_invalid", { reason: "reservation state is not an object" });
  }
  const { nif, idSistemaInformatico, numeroInstalacion } = state as Record<string, unknown>;
  if (typeof nif !== "string" || nif.length === 0) {
    throw new AppError("sif.reservation_invalid", { reason: "nif is not a non-empty string" });
  }
  // The same length rule `registerSif` applies, because this is the OTHER write path into
  // `registro_sif.id_sistema_informatico` and the column carries no CHECK. Refused as a malformed
  // RESERVATION rather than as `sif.id_sistema_invalid`: the value arrived over the mirror bundle,
  // so what failed is the primary's state, not a local argument.
  if (
    typeof idSistemaInformatico !== "string" ||
    idSistemaInformatico.length === 0 ||
    idSistemaInformatico.length > ID_SISTEMA_MAX_LENGTH
  ) {
    throw new AppError("sif.reservation_invalid", {
      reason: `idSistemaInformatico is not a string of 1 to ${String(ID_SISTEMA_MAX_LENGTH)} characters`,
    });
  }
  if (
    typeof numeroInstalacion !== "number" ||
    !Number.isInteger(numeroInstalacion) ||
    numeroInstalacion < 1
  ) {
    throw new AppError("sif.reservation_invalid", {
      reason: "numeroInstalacion is not a positive integer",
    });
  }
  return { nif, idSistemaInformatico, numeroInstalacion };
}

/**
 * The fiscal module's provisioning contribution. `seed` registers the node as a SIF — for an
 * existing node that means a FRESH installation number and a new chain (a reimaged box); it never
 * resumes anyone's. `standby.reserve` runs on the PRIMARY (the sole allocator per NIF) and
 * `standby.establish` writes the reserved, dormant SIF on the mirror.
 */
export const FISCAL_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "register the node as a Veri*Factu SIF and start its chain",
    async run(tx, node) {
      const sif = await registerSif(tx, {
        nodeId: node.nodeId,
        nif: await obligadoNif(tx),
        idSistemaInformatico: WAITRON_ID_SISTEMA,
      });
      return `SIF ${sif.id} (installation ${sif.numeroInstalacion})`;
    },
  },
  standby: {
    async reserve(tx, primary): Promise<StandbyReservation> {
      const primarySif = await currentSif(tx, primary.nodeId);
      const bases = await liveSeriesBases(tx, primary);
      const numeroInstalacion = await reserveInstallationNumber(tx, {
        nif: primarySif.nif,
        idSistemaInformatico: primarySif.idSistemaInformatico,
      });
      const state: ReservedSifState = {
        nif: primarySif.nif,
        idSistemaInformatico: primarySif.idSistemaInformatico,
        numeroInstalacion,
      };
      return { state, series: deriveReservedSeriesCodes(bases, numeroInstalacion) };
    },
    async establish(tx, standby, state) {
      const reserved = parseReservedState(state);
      await writeReservedSif(tx, {
        nodeId: standby.nodeId,
        nif: reserved.nif,
        idSistemaInformatico: reserved.idSistemaInformatico,
        numeroInstalacion: reserved.numeroInstalacion,
      });
    },
  },
};
