// The public surface of @waitron/workforce-es — the Spain module for the registro de jornada and the
// convenio_config surface. Re-exports only.
export { ANOS_CONSERVACION, TITULARES_ACCESO, exportTimeRecord } from "./registro-jornada.js";
export type { LineaJornada, RegistroDeJornada, TitularAcceso } from "./registro-jornada.js";
export { WORKFORCE_ES_MIGRATIONS } from "./migrations.js";
export { convenioConfig, overtimeModel } from "./schema/convenio-config.js";
export { resolveWorkTimeRuleset } from "./convenio.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
