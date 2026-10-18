import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, label, newId, table, ts } from "@waitron/db";

export const certificateSource = enumType(["setup", "dashboard"]);
export const certificateKind = enumType(["sello", "representante"]);

/** One row per AEAT certificate installed on a node. Declared `appendOnly()` in
 * `../classification.ts`. */
export const fiscalCertificateInstalls = table(
  "fiscal_certificate_installs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // No foreign key: `nodes` is a state table, which a `local` one may not join (CLAUDE.md §3).
    // Nothing in the database checks the node exists; the writer passes its own node's id.
    nodeId: id("node_id").notNull(),
    installedAt: ts("installed_at").notNull(),
    source: certificateSource("source").notNull(),
    // No foreign key: `persons` is a state table, which a `local` one may not join (CLAUDE.md §3).
    // Nothing in the database checks the person exists; the writer takes the signed-in person.
    // Null for a setup install.
    personId: id("person_id"),
    kind: certificateKind("kind").notNull(),
    fingerprint: label("fingerprint").notNull(),
    organisation: label("organisation"),
    taxId: label("tax_id"),
    issuer: label("issuer"),
    validFrom: ts("valid_from").notNull(),
    validUntil: ts("valid_until").notNull(),
    checkedEndpoint: label("checked_endpoint"),
    checkedAt: ts("checked_at"),
  },
  (t) => [
    index("fiscal_certificate_installs_node_idx").on(t.nodeId, t.installedAt),
    check("fiscal_certificate_installs_source_ck", enumCheck(t.source)),
    check("fiscal_certificate_installs_kind_ck", enumCheck(t.kind)),
    check(
      "fiscal_certificate_installs_dashboard_ck",
      sql`${t.source} = 'setup' or (${t.personId} is not null and ${t.checkedAt} is not null and ${t.checkedEndpoint} is not null)`,
    ),
  ],
);
