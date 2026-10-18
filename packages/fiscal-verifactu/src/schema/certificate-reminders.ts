import { check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, newId, table, ts } from "@waitron/db";
import { fiscalCertificateInstalls } from "./certificate-installs.js";

export const reminderStage = enumType(["warning", "urgent", "expired"]);
export const reminderStatus = enumType(["claimed", "sent", "failed", "unknown"]);

/** One row per expiry email a node sent, or tried to send, about its own certificate. */
export const fiscalCertificateReminders = table(
  "fiscal_certificate_reminders",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id").notNull(),
    installId: id("install_id")
      .notNull()
      .references(() => fiscalCertificateInstalls.id),
    stage: reminderStage("stage").notNull(),
    // No foreign key, as on the install's `person_id`. No email address is stored.
    personId: id("person_id").notNull(),
    status: reminderStatus("status").notNull(),
    claimedAt: ts("claimed_at").notNull(),
    reportedAt: ts("reported_at"),
  },
  (t) => [
    uniqueIndex("fiscal_certificate_reminders_uq").on(t.installId, t.stage, t.personId),
    check("fiscal_certificate_reminders_stage_ck", enumCheck(t.stage)),
    check("fiscal_certificate_reminders_status_ck", enumCheck(t.status)),
  ],
);
