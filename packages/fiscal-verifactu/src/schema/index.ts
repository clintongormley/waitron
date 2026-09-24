// drizzle-kit emits a CREATE TABLE for every table exported here, so names are listed explicitly —
// never `export *`, and never a core table (a duplicate CREATE TABLE would fail against a database
// core already created). `schema-ownership.test.ts` enforces it.
export { acks } from "./acks.js";
export { cadenas } from "./cadenas.js";
export { envioFlujo } from "./envio-flujo.js";
export { envios } from "./envios.js";
export { registrosFacturacion } from "./registros.js";
export { contadoresInstalacion, registroSif } from "./sif.js";
