// Every check constraint in `drizzle/` is written with a `CONSTRAINT <name>` clause, so
// `checksInDdl`'s blindness to an anonymous check reaches nothing here.
// The factory's blind spot for what an index EXPRESSION says reaches this set:
// `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq` and
// `persons_tenant_pending_email_uq` are each over a folded-key expression, so a declaration and a
// migration that disagree about how a key is folded pass here. Each index's name, uniqueness,
// filter and the position of its expression among its parts are still compared.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { IDENTITY_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "identity",
  // `sessions.device_id` points at core's `devices`. No migration in this set creates a trigger.
  prerequisites: [CORE_MIGRATIONS],
  subject: IDENTITY_MIGRATIONS,
  declarations: barrel,
  // True: `persons.role` and `persons.status` carry the `enumText`/`enumCheck` pair, through
  // `enumType`.
  declaresClosedVocabularies: true,
});
