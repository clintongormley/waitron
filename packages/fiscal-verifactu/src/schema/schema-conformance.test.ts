// The FISCAL migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the fiscal set in particular.
//
// Three facts the factory cannot state for a set it has not seen. Every check constraint in
// `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. No declaration carries a `unique()` — the
// four unique indexes are `uniqueIndex(...)` with a name — so the unnamed-constraint refusal
// reaches nothing either. And the factory never reads a trigger, so the `RAISE(ABORT)` pair
// `registros_facturacion` gets from its `appendOnly()` declaration is outside this suite; its
// guards are `../inmutabilidad.test.ts` and `scripts/append-only-triggers.test.ts`.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { FISCAL_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "fiscal",
  // Core, because the set's foreign keys point at core's `nodes`, `tills` and `sales` and at no
  // other set's table, so this is the database those keys resolve in. Not because the migration
  // needs it: with an empty list the set still builds and all nine cases still pass, measured
  // 2026-09-23 — this engine creates a table whose parent does not exist yet (CLAUDE.md §3).
  prerequisites: [CORE_MIGRATIONS],
  subject: FISCAL_MIGRATIONS,
  declarations: barrel,
  // False: no column in `src/schema/` is declared with the `enumText`/`enumCheck` pair; the
  // closed lists here (`acks.state`, `envios.estado`, `registros_facturacion.tipo_registro` and
  // others) are plain `check(...)` constraints, which the suite compares by name and body.
  declaresClosedVocabularies: false,
});
