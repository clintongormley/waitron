// Tables another module's own migration set creates. Defined in `@waitron/workforce`; that set
// generates from its folder's barrel.
// `./index.ts` must not import this file: workforce's generator would claim these tables.
export * from "./staffing/index.js";
