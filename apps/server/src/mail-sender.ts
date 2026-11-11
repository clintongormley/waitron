import { publishState } from "./live-publish.js";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  outgoingMail,
  withTransaction,
  type Database,
  type Transaction,
  type OutgoingMail,
  type OutgoingMailKind,
  type OutgoingMailFailureCode,
} from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import type { SendMailOptions } from "nodemailer";
import type { EmailDelivery, MailDeliveryRule } from "./email-delivery.js";
import { sendSmtpMessage, type SmtpConnection, type SmtpSendOutcome } from "./smtp-send.js";
import type { SmtpTestCode } from "./smtp-failure.js";
import type { Logger } from "./logger.js";
import type { LiveEvents } from "./live-api.js";
import { realSleep, runLoop } from "./loop.js";
import { createLoopWaker } from "./loop-wake.js";

export interface ClaimedMail {
  id: string;
  kind: OutgoingMailKind;
  dedupeKey: string;
  subjectId: string | null;
  personId: string | null;
  requestedBy: string | null;
  params: Record<string, string | number | boolean | null>;
  attempts: number;
  queuedAt: string;
  notAfter: string;
}
export interface MailMessage {
  subject: string;
  text: string;
  html?: string;
  attachments?: SendMailOptions["attachments"];
}
export type MailSettlement =
  | { status: "sent" }
  | { status: "rejected"; failureCode: OutgoingMailFailureCode; serverRefused: boolean }
  | { status: "unknown"; failureCode: OutgoingMailFailureCode }
  | { status: "expired" };
export interface MailKindOwner<Prepared = unknown> {
  readonly kind: OutgoingMailKind;
  readonly deliveryRule: MailDeliveryRule;
  readonly retryDelaysMs: readonly number[];
  readonly longestWaitMs: number;
  /** A released claim may run again; its writes must be safe to repeat. */
  claim(
    tx: Transaction,
    mail: ClaimedMail,
    now: Date,
  ): Promise<{ recipient: string; prepared: Prepared } | { later: Date } | null>;
  compose(prepared: Prepared, mail: ClaimedMail): Promise<MailMessage>;
  /** A throw rolls back queue and owner writes together and propagates, including at start. */
  settle(
    tx: Transaction,
    mail: ClaimedMail,
    outcome: MailSettlement,
    now: Date,
    prepared?: Prepared,
  ): Promise<void>;
}
export type MailTransport = (
  smtp: SmtpConnection,
  message: Omit<SendMailOptions, "from">,
) => Promise<SmtpSendOutcome>;
export interface MailSenderDeps {
  bus?: LiveEvents;
  db: Database;
  owners: readonly MailKindOwner[];
  now: () => Date;
  isPrimary: () => boolean;
  signal: AbortSignal;
  resolveDelivery: (tx: Transaction, rule: MailDeliveryRule) => Promise<EmailDelivery>;
  send?: MailTransport;
  beforeClaim?: () => Promise<void>;
  log: Logger;
}
export type MailPassResult =
  | { processed: false; emailUnconfigured?: true }
  | { processed: true; mailId: string | null; subjectId: string | null };
export const MAIL_CLAIM_LEASE_MS = 60000;
type SmtpCodes = Extract<OutgoingMailFailureCode, `email.${string}`>;
const smtpCodeAgreement: [SmtpTestCode] extends [SmtpCodes]
  ? [SmtpCodes] extends [SmtpTestCode]
    ? true
    : never
  : never = true;
void smtpCodeAgreement;

const waiting = (row: OutgoingMail) =>
  (row.status === "pending" || row.status === "rejected") && row.finishedAt === null;
const lapsed = (row: OutgoingMail, now: number) =>
  row.status === "sending" &&
  (Date.parse(row.claimedAt!) <= now - MAIL_CLAIM_LEASE_MS ||
    Date.parse(row.claimedAt!) > now + MAIL_CLAIM_LEASE_MS);
const due = (row: OutgoingMail, owner: MailKindOwner, now: number) =>
  waiting(row) &&
  (Date.parse(row.nextAttemptAt) <= now ||
    Date.parse(row.nextAttemptAt) > now + owner.longestWaitMs);
function liveRows(tx: Transaction, owners: readonly MailKindOwner[]) {
  return tx
    .select()
    .from(outgoingMail)
    .where(
      and(
        inArray(
          outgoingMail.kind,
          owners.map((o) => o.kind),
        ),
        isNull(outgoingMail.finishedAt),
      ),
    )
    .orderBy(asc(outgoingMail.nextAttemptAt), asc(outgoingMail.queuedAt), asc(outgoingMail.seq));
}
const resultFor = (mail: ClaimedMail): MailPassResult => ({
  processed: true,
  mailId: mail.id,
  subjectId: mail.subjectId,
});
function retryPatch(
  mail: ClaimedMail,
  owner: MailKindOwner,
  now: Date,
  failureCode: OutgoingMailFailureCode,
) {
  const delay = owner.retryDelaysMs[mail.attempts - 1];
  return {
    status: "rejected" as const,
    failureCode,
    ...(delay === undefined
      ? { finishedAt: now.toISOString() }
      : {
          finishedAt: null,
          nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
          claimToken: null,
          claimedAt: null,
          recipient: null,
        }),
  };
}
export async function abandonMailClaims(
  tx: Transaction,
  owners: readonly MailKindOwner[],
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(outgoingMail)
    .set({ status: "unknown", failureCode: "mail.claim_abandoned", finishedAt: now.toISOString() })
    .where(
      and(
        inArray(
          outgoingMail.kind,
          owners.map((o) => o.kind),
        ),
        eq(outgoingMail.status, "sending"),
      ),
    )
    .returning();
  for (const row of rows)
    await owners
      .find((o) => o.kind === row.kind)!
      .settle(tx, row, { status: "unknown", failureCode: "mail.claim_abandoned" }, now);
  return rows.length;
}
export async function runMailPass(deps: MailSenderDeps): Promise<MailPassResult> {
  const allowed = () => !deps.signal.aborted && deps.isPrimary();
  if (!allowed()) return { processed: false };
  const owners = new Map(deps.owners.map((o) => [o.kind, o]));
  const firstNow = deps.now().getTime();
  const first = await liveRows(deps.db, deps.owners);
  if (
    !first.some(
      (r) =>
        (waiting(r) && Date.parse(r.notAfter) <= firstNow) ||
        lapsed(r, firstNow) ||
        due(r, owners.get(r.kind)!, firstNow),
    )
  )
    return { processed: false };
  await deps.beforeClaim?.();
  let failed: OutgoingMail | undefined;
  let claimed:
    | {
        mail: OutgoingMail;
        owner: MailKindOwner;
        prepared: unknown;
        delivery: Exclude<EmailDelivery, { mode: "unconfigured" }>;
      }
    | undefined;
  let result: MailPassResult;
  try {
    // The claim commits before SMTP, so an external wait never holds the venue write lock.
    result = await withTransaction(deps.db, async (tx) => {
      if (!allowed()) return { processed: false } as MailPassResult;
      const now = deps.now();
      const stamp = now.toISOString();
      let changed = false;
      let expired = 0;
      const rows = await liveRows(tx, deps.owners);
      for (const row of rows) {
        const outcome: MailSettlement | undefined =
          waiting(row) && Date.parse(row.notAfter) <= now.getTime() && expired < 20
            ? { status: "expired" }
            : lapsed(row, now.getTime())
              ? { status: "unknown", failureCode: "mail.claim_abandoned" }
              : undefined;
        if (!outcome) continue;
        if (outcome.status === "expired") expired++;
        await tx
          .update(outgoingMail)
          .set({
            status: outcome.status,
            finishedAt: stamp,
            failureCode: outcome.status === "unknown" ? outcome.failureCode : null,
          })
          .where(eq(outgoingMail.id, row.id));
        await owners.get(row.kind)!.settle(tx, row, outcome, now);
        changed = true;
        row.finishedAt = stamp;
      }
      const deliveries = new Map<MailDeliveryRule, EmailDelivery>();
      for (const owner of deps.owners)
        if (!deliveries.has(owner.deliveryRule))
          deliveries.set(owner.deliveryRule, await deps.resolveDelivery(tx, owner.deliveryRule));
      let unconfigured = false;
      for (const row of rows) {
        const owner = owners.get(row.kind)!;
        if (!due(row, owner, now.getTime()) || Date.parse(row.notAfter) <= now.getTime()) continue;
        const delivery = deliveries.get(owner.deliveryRule)!;
        if (delivery.mode === "unconfigured") {
          unconfigured = true;
          continue;
        }
        const mail = { ...row, attempts: row.attempts + 1 };
        let claim;
        try {
          claim = await owner.claim(tx, mail, now);
        } catch (error) {
          failed = mail;
          throw error;
        }
        if (claim === null) {
          await tx
            .update(outgoingMail)
            .set({ status: "cancelled", finishedAt: stamp })
            .where(eq(outgoingMail.id, row.id));
          return resultFor(row);
        }
        if ("later" in claim) {
          await tx
            .update(outgoingMail)
            .set({
              nextAttemptAt: new Date(
                Math.min(claim.later.getTime(), now.getTime() + owner.longestWaitMs),
              ).toISOString(),
            })
            .where(and(eq(outgoingMail.id, row.id), eq(outgoingMail.status, row.status)));
          return resultFor(row);
        }
        const [saved] = await tx
          .update(outgoingMail)
          .set({
            status: "sending",
            recipient: claim.recipient,
            claimToken: randomUUID(),
            claimedAt: stamp,
            attempts: mail.attempts,
          })
          .where(and(eq(outgoingMail.id, row.id), eq(outgoingMail.status, row.status)))
          .returning();
        if (saved === undefined) return resultFor(row);
        claimed = { mail: saved, owner, prepared: claim.prepared, delivery };
        return resultFor(row);
      }
      return changed
        ? { processed: true, mailId: null, subjectId: null }
        : unconfigured
          ? { processed: false, emailUnconfigured: true }
          : { processed: false };
    });
  } catch (error) {
    if (failed === undefined) throw error;
    const mail = failed;
    const owner = owners.get(mail.kind)!;
    // The owner’s writes rolled back; a fresh transaction retains only the failed attempt’s back-off.
    await withTransaction(deps.db, (tx) =>
      tx
        .update(outgoingMail)
        .set({
          ...retryPatch(mail, owner, deps.now(), "mail.claim_failed"),
          attempts: mail.attempts,
        })
        .where(
          and(
            eq(outgoingMail.id, mail.id),
            eq(outgoingMail.status, mail.status),
            isNull(outgoingMail.finishedAt),
          ),
        ),
    );
    deps.log("error", "mail.send_failed", {
      kind: mail.kind,
      mailId: mail.id,
      errorCode: "mail.claim_failed",
    });
    return resultFor(mail);
  }
  if (claimed === undefined) return result;
  const { mail, owner, prepared, delivery } = claimed;
  let outcome: Exclude<MailSettlement, { status: "expired" }>;
  let message: MailMessage | undefined;
  try {
    message = await owner.compose(prepared, mail);
  } catch {
    outcome = { status: "rejected", failureCode: "mail.compose_failed", serverRefused: false };
  }
  if (!allowed()) {
    await withTransaction(deps.db, (tx) =>
      tx
        .update(outgoingMail)
        .set({
          status: "pending",
          claimToken: null,
          claimedAt: null,
          recipient: null,
          attempts: mail.attempts - 1,
        })
        .where(
          and(
            eq(outgoingMail.id, mail.id),
            eq(outgoingMail.status, "sending"),
            eq(outgoingMail.claimToken, mail.claimToken!),
          ),
        ),
    );
    return result;
  }
  if (message !== undefined) {
    let sent: SmtpSendOutcome;
    try {
      sent = await (deps.send ?? sendSmtpMessage)(delivery.smtp, {
        ...message,
        to: mail.recipient!,
      });
    } catch {
      sent = { status: "unknown", reason: "email.test_refused" };
    }
    outcome =
      sent.status === "sent"
        ? sent
        : sent.status === "rejected"
          ? { status: "rejected", failureCode: sent.reason, serverRefused: sent.serverRefused }
          : { status: "unknown", failureCode: sent.reason };
  }
  const settled = outcome!;
  if (settled.status === "sent" && delivery.mode === "local_capture" && deps.bus)
    publishState(deps.bus, "email_inbox", deps.log);
  await withTransaction(deps.db, async (tx) => {
    const now = deps.now();
    const [saved] = await tx
      .update(outgoingMail)
      .set(
        settled.status === "rejected"
          ? retryPatch(mail, owner, now, settled.failureCode)
          : {
              status: settled.status,
              finishedAt: now.toISOString(),
              failureCode: settled.status === "unknown" ? settled.failureCode : null,
            },
      )
      .where(
        and(
          eq(outgoingMail.id, mail.id),
          eq(outgoingMail.status, "sending"),
          eq(outgoingMail.claimToken, mail.claimToken!),
        ),
      )
      .returning({ id: outgoingMail.id });
    if (saved) await owner.settle(tx, mail, settled, now, prepared);
  });
  if (settled.status !== "sent")
    deps.log("error", "mail.send_failed", {
      kind: mail.kind,
      mailId: mail.id,
      errorCode: settled.failureCode,
    });
  return result;
}
export async function runMailLoop(
  deps: MailSenderDeps & {
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    minTickMs?: number;
    maxTickMs?: number;
  },
): Promise<void> {
  let waitingForSetup = false;
  const unavailable = new Set<MailDeliveryRule>();
  const resolveDelivery: MailSenderDeps["resolveDelivery"] = async (tx, rule) => {
    try {
      const delivery = await deps.resolveDelivery(tx, rule);
      unavailable.delete(rule);
      return delivery;
    } catch (error) {
      if (!unavailable.has(rule))
        deps.log("error", "mail.delivery_unavailable", { rule, errorCode: codeOf(error) });
      unavailable.add(rule);
      return { mode: "unconfigured" };
    }
  };
  await runLoop({
    ...deps,
    minTickMs: deps.minTickMs ?? 500,
    maxTickMs: deps.maxTickMs ?? 60000,
    sleep: deps.sleep ?? realSleep,
    log: (level, event, fields) => deps.log(level, `mail.${event}`, fields),
    pass: async () => {
      const result = await runMailPass({ ...deps, resolveDelivery });
      if (!result.processed && result.emailUnconfigured) {
        if (!waitingForSetup) deps.log("info", "mail.waiting_for_email_setup");
        waitingForSetup = true;
        return { duties: [], nextDueAt: null };
      }
      if (result.processed && result.mailId !== null) waitingForSetup = false;
      if (result.processed) return { duties: [], nextDueAt: deps.now() };
      const rows = await liveRows(deps.db, deps.owners);
      const times = rows.flatMap((r) =>
        r.status === "sending"
          ? [Date.parse(r.claimedAt!) + MAIL_CLAIM_LEASE_MS]
          : [Date.parse(r.nextAttemptAt), Date.parse(r.notAfter)],
      );
      return { duties: [], nextDueAt: times.length ? new Date(Math.min(...times)) : null };
    },
  });
}
export async function startMailSender(
  deps: MailSenderDeps & { bus?: LiveEvents; maxTickMs?: number },
): Promise<void> {
  const kinds = new Set<OutgoingMailKind>();
  for (const owner of deps.owners) {
    if (kinds.has(owner.kind)) throw new Error("Duplicate mail owner");
    kinds.add(owner.kind);
    if (owner.retryDelaysMs.some((ms) => ms > owner.longestWaitMs))
      throw new Error("Mail longest wait is below a retry delay");
  }
  const waker = createLoopWaker({ minTickMs: 500 });
  const unsubscribe = deps.bus?.subscribe((event) => {
    if (event.kind === "change" && event.change.resources.some((r) => r.type === "outgoing_mail"))
      waker.wake();
  });
  try {
    await runMailLoop({ ...deps, sleep: waker.sleep });
  } finally {
    unsubscribe?.();
  }
}
