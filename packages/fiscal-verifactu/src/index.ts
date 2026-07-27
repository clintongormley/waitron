// The public surface of @waitron/fiscal-verifactu. Re-exports only.
export { VerifactuBackend } from "./backend.js";
export type { VerifactuBackendOptions } from "./backend.js";
export { FISCAL_MIGRATIONS } from "./migrations.js";
export {
  cadenas,
  contadoresInstalacion,
  envios,
  registroSif,
  registrosFacturacion,
} from "./schema/index.js";
export { currentSif, esPrimerRegistro, registerSif } from "./registro-sif.js";
export type { RegisterSifParams, SifRegistration } from "./registro-sif.js";
// The drainer itself, not only `VerifactuBackend.drain`. The `apps/*` host calls this directly:
// constructing a backend to reach it would demand a `TrustedClock` and a `db` handle the drainer
// never touches.
export { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
export type { DrainDeps } from "./drain.js";
export { appendToChain, isUniqueViolation, lockChainHead } from "./chain.js";
export type { ChainHead, PendingRegistro } from "./chain.js";
export { fromRegistroRow, pointerTo, toRegistroRow } from "./registro-row.js";
export type { RegistroRow, RegistroRowContext, RegistroRowInsert } from "./registro-row.js";
export { verifyChain } from "./verify.js";
