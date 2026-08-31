// The public surface of @waitron/diagnostics — a browser-safe, zero-dependency client logging
// library. Re-exports only; excluded from coverage in vitest.config.ts.
export { createDiagnosticsLog } from "./log.js";
export type { DiagnosticsLog, TrailEvent, ClientLogLevel, TrailField } from "./log.js";
