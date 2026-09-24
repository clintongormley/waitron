export { ANOS_CONSERVACION, TITULARES_ACCESO, exportTimeRecord } from "./registro-jornada.js";
export type { LineaJornada, RegistroDeJornada, TitularAcceso } from "./registro-jornada.js";
export { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
export { WORKFORCE_ES_VOCABULARY } from "./vocabulary.js";
export { convenioConfig, overtimeModel } from "./schema/convenio-config.js";
export { resolveWorkTimeRuleset } from "./convenio.js";

export { WORKFORCE_ES_CLASSIFICATION } from "./classification.js";
export { WORKFORCE_ES_CONFIGURATION_TRANSFER } from "./configuration-transfer.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
import "./errors.js";
