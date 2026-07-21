// The Drizzle snapshot is built from THIS file's exports. Every name below is written out
// explicitly — never `export *`, and never a core table — because this list is the thing that
// decides what `drizzle-kit generate` emits a CREATE TABLE for.
//
// The schema files above `import` core tables to declare foreign keys. They must NEVER re-export
// them: a re-export pulls the core table into this package's snapshot and generates a duplicate
// CREATE TABLE, which then fails at apply time against a database where core already created it.
// `schema-ownership.test.ts` enforces this, because a comment does not survive contact with a
// future contributor.
export { cadenas } from "./cadenas.js";
export { envios } from "./envios.js";
export { registrosFacturacion } from "./registros.js";
export { contadoresInstalacion, registroSif } from "./sif.js";
