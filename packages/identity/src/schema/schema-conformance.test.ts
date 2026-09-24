// Every check constraint in `drizzle/` is written with a `CONSTRAINT <name>` clause, so
// `checksInDdl`'s blindness to an anonymous check reaches nothing here.
// The factory's blind spot for what an index EXPRESSION says reaches this set:
// `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq` and
// `persons_tenant_pending_email_uq` are each over a folded-key expression, so a declaration and a
// migration that disagree about how a key is folded pass here. Each index's name, uniqueness,
// filter and the position of its expression among its parts are still compared.
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { IDENTITY_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "identity",
  // No prerequisites: every foreign key in `drizzle/` points at this set's own `persons`, and no
  // migration creates a trigger. The package's other database suites apply core first, and the
  // ones that seed need it: `seedTenant` writes core's `tenants`, and `test/fixtures.ts`'s
  // `seedTill` writes core's `locations` and `tills`.
  subject: IDENTITY_MIGRATIONS,
  declarations: barrel,
  // True: `persons.role` and `persons.status` carry the `enumText`/`enumCheck` pair, through
  // `enumType`.
  declaresClosedVocabularies: true,
});
