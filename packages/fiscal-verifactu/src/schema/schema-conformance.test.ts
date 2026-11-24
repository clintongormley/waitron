// The factory never reads a trigger, so `verifactu_records`'s append-only `RAISE(ABORT)` pair
// is outside this suite; its guards are `../inmutabilidad.test.ts` and
// `scripts/append-only-triggers.test.ts`.
import { expect, it } from "vitest";
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
  // `verifactu_records.source` is the closed vocabulary; every
  // other closed list here is a plain `check(...)` constraint.
  declaresClosedVocabularies: true,
});

it("keeps the ID sent to AEAT as RefExterna random", () => {
  expect(barrel.verifactuRecords.id.defaultFn?.()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
