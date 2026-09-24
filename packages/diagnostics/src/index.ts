export { createDiagnosticsLog } from "./log.js";
export type { DiagnosticsLog, TrailEvent, ClientLogLevel, TrailField } from "./log.js";
export { installErrorCapture } from "./error-capture.js";
export type { ErrorTarget } from "./error-capture.js";
export { createInstrumentedFetch, maskPath } from "./instrument-fetch.js";
