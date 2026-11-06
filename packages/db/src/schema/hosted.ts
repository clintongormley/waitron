// Tables a module's own migration set creates, defined here so that set and core share one source.
// `./index.ts` must not import this file: core's generator would claim these tables.
export * from "./credentials/index.js";
export * from "./media/index.js";
export * from "./handover/index.js";
export * from "./identity/index.js";
