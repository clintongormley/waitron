// The factory never reads a trigger, so `registros_facturacion`'s append-only `RAISE(ABORT)` pair
// is outside this suite; its guards are `../inmutabilidad.test.ts` and
// `scripts/append-only-triggers.test.ts`.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { FISCAL_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "fiscal",
  // Core, because the set's foreign keys point at core's tables and no other set's.
  prerequisites: [CORE_MIGRATIONS],
  subject: FISCAL_MIGRATIONS,
  declarations: barrel,
  // `registros_facturacion.source` is the one closed vocabulary; every other closed list here is a
  // plain `check(...)` constraint.
  declaresClosedVocabularies: true,
});
