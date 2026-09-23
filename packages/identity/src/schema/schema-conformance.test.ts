// The IDENTITY migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the identity set in particular.
//
// Three facts the factory cannot state for a set it has not seen. Every check constraint in
// `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. The one `unique()` in this package's
// declarations, in `webauthn.ts`, is given a name, so the unnamed-constraint refusal reaches
// nothing either. And the factory's blind spot for what an index EXPRESSION says does reach this
// set: `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq` and
// `persons_tenant_pending_email_uq` are each over a folded-key expression, which
// `drizzle/0001_person_case_fold.sql` rewrote, so a declaration and a migration that disagree about
// how a key is folded pass here. Each index's name, uniqueness and filter are still compared.
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { IDENTITY_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "identity",
  // No prerequisites: every foreign key in `drizzle/` points at this set's own `persons`, and no
  // migration creates a trigger, so nothing it builds depends on core.
  subject: IDENTITY_MIGRATIONS,
  declarations: barrel,
  // True: `persons.role` and `persons.status` carry the `enumCheck` pair.
  declaresClosedVocabularies: true,
});
