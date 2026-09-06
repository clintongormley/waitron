// The public surface of @waitron/fiscal-verifactu. Re-exports only.
export { VerifactuBackend } from "./backend.js";
export type { VerifactuBackendOptions } from "./backend.js";
export { FISCAL_MIGRATIONS } from "./migrations.js";
export { FISCAL_ENROLMENT } from "./enrolment.js";
export { FISCAL_VOCABULARY } from "./vocabulary.js";
export { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
export { FISCAL_SLOT } from "./slot.js";
// The AEAT transport moved into the regime (fiscal-none slice). `CertKind`/`isCertKind` are exported
// so `apps/server/src/aeat-credential.ts` can still reach them until Task 5 moves that file here too.
export { isCertKind } from "./aeat-transport.js";
export type { CertKind } from "./aeat-transport.js";
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
export type {
  Entorno,
  RegistroRow,
  RegistroRowContext,
  RegistroRowInsert,
} from "./registro-row.js";
export { verifyChain } from "./verify.js";

export {
  FISCAL_RESTORE,
  installationFloor,
  raiseInstallationFloor,
  restoreFiscal,
} from "./restore.js";
export { liveSeriesBases, MAX_BASE_CODE_LENGTH, stripOwnSuffixes } from "./reserved-series.js";
