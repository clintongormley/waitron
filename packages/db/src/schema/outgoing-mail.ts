import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  bigCount,
  count,
  enumCheck,
  enumText,
  id,
  json,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { persons } from "./identity/persons.js";

export const outgoingMailKinds = [
  "invoice",
  "attendance_question",
  "certificate_reminder",
  "box_alert",
  "account_action",
  "role_membership_changed",
  "email_changed",
] as const;
export const outgoingMailStatuses = [
  "pending",
  "sending",
  "sent",
  "rejected",
  "unknown",
  "expired",
  "cancelled",
] as const;
export const outgoingMailFailureCodes = [
  "email.test_host_not_found",
  "email.test_connection_refused",
  "email.test_starttls_refused",
  "email.test_tls_refused",
  "email.test_certificate_untrusted",
  "email.test_login_refused",
  "email.test_login_required",
  "email.test_timeout",
  "email.test_refused",
  "mail.compose_failed",
  "mail.claim_failed",
  "mail.claim_abandoned",
] as const;
export type OutgoingMailKind = (typeof outgoingMailKinds)[number];
export type OutgoingMailStatus = (typeof outgoingMailStatuses)[number];
export type OutgoingMailFailureCode = (typeof outgoingMailFailureCodes)[number];
export const outgoingMail = table(
  "outgoing_mail",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    seq: bigCount("seq").notNull(),
    kind: enumText("kind", outgoingMailKinds).notNull(),
    dedupeKey: label("dedupe_key").notNull(),
    // A subject can belong to a switchable module, so core cannot declare its foreign key.
    subjectId: id("subject_id"),
    personId: id("person_id").references(() => persons.id, { onDelete: "restrict" }),
    requestedBy: id("requested_by").references(() => persons.id, { onDelete: "restrict" }),
    recipient: label("recipient"),
    params: json<Record<string, string | number | boolean | null>>("params").notNull().default({}),
    status: enumText("status", outgoingMailStatuses).notNull().default("pending"),
    attempts: count("attempts").notNull().default(0),
    nextAttemptAt: tsString("next_attempt_at").notNull(),
    notAfter: tsString("not_after").notNull(),
    queuedAt: tsString("queued_at").notNull().$defaultFn(nowIso),
    claimToken: id("claim_token"),
    claimedAt: tsString("claimed_at"),
    finishedAt: tsString("finished_at"),
    failureCode: enumText("failure_code", outgoingMailFailureCodes),
  },
  (t) => [
    uniqueIndex("outgoing_mail_key_uq").on(t.dedupeKey),
    uniqueIndex("outgoing_mail_seq_uq").on(t.seq),
    index("outgoing_mail_due_idx").on(t.status, t.nextAttemptAt, t.queuedAt, t.seq),
    check("outgoing_mail_kind_ck", enumCheck(t.kind)),
    check("outgoing_mail_status_ck", enumCheck(t.status)),
    check("outgoing_mail_failure_ck", enumCheck(t.failureCode)),
    check("outgoing_mail_attempts_ck", sql`${t.attempts} >= 0`),
    check("outgoing_mail_not_after_ck", sql`${t.notAfter} > ${t.queuedAt}`),
    check("outgoing_mail_claim_ck", sql`(${t.claimToken} is null) = (${t.claimedAt} is null)`),
    check(
      "outgoing_mail_sending_ck",
      sql`${t.status} <> 'sending' or (${t.claimToken} is not null and ${t.recipient} is not null)`,
    ),
    check(
      "outgoing_mail_finished_ck",
      sql`${t.status} = 'rejected' or (${t.status} in ('pending', 'sending') and ${t.finishedAt} is null) or (${t.status} in ('sent', 'unknown', 'expired', 'cancelled') and ${t.finishedAt} is not null)`,
    ),
    check("outgoing_mail_person_ck", sql`${t.personId} is not null or ${t.kind} = 'invoice'`),
  ],
);
export type OutgoingMail = typeof outgoingMail.$inferSelect;
