export { VerifactuBackend } from "./backend.js";
export type { VerifactuBackendOptions } from "./backend.js";
export { FISCAL_ALERTS } from "./alerts.js";
export { FISCAL_MIGRATIONS } from "./migrations.js";
export { FISCAL_VOCABULARY } from "./vocabulary.js";
export { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
export { FISCAL_SLOT } from "./slot.js";
export { isCertKind } from "./aeat-transport.js";
export type { CertKind } from "./aeat-transport.js";
export {
  parseAeatCert,
  sealAeatSecret,
  validateAeatCert,
  type AeatCert,
} from "./provisioning-secret.js";
export {
  cadenas,
  contadoresInstalacion,
  envios,
  registroSif,
  registrosFacturacion,
} from "./schema/index.js";
export { currentSif, esPrimerRegistro, registerSif } from "./registro-sif.js";
export type { RegisterSifParams, SifRegistration } from "./registro-sif.js";
export { DEFAULT_SKIP_RETRY_MS, drain } from "./drain.js";
export type { DrainDeps } from "./drain.js";
export { appendToChain, readChainHead } from "./chain.js";
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
export { FISCAL_CLASSIFICATION } from "./classification.js";
