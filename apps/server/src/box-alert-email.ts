import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { KeyRing } from "@waitron/credentials";
import {
  cancelMail,
  enqueueMail,
  incidents,
  MAIL_LIFETIME_MS,
  newId,
  outgoingMail,
  readVenue,
  withTransaction,
  type Database,
} from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { formatBytes, formatDuration } from "@waitron/shared";
import type { BackupOutcomeHolder } from "./alert-sources.js";
import type { DiskFullState } from "./disk-full-state.js";
import { resolveEmailDeliveryIn, type EmailDelivery } from "./email-delivery.js";
import { fillTemplate } from "./fill-template.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import {
  BACKUP_DELETED_EMAIL_WORDS,
  BACKUP_REFUSED_EMAIL_WORDS,
  BOX_EMAIL_WORDS,
  CLOCK_CORRECTED_EMAIL_WORDS,
} from "./i18n/box-emails.js";
import type { Logger } from "./logger.js";
import { receiptDateTimeNumeric, receiptDay } from "./receipt-dates.js";
import {
  readManagerEmailRecipients,
  type ManagerEmailRecipient,
} from "./manager-email-recipients.js";
import type { StaffNoticesRead } from "./staff-notices.js";
import type { TextEmailOutcome, TextEmailSender } from "./text-email.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

export type BoxEmailCode = keyof typeof BOX_EMAIL_WORDS;

/** The codes the duty reads from the stop and the warning. */
export const STORAGE_EMAIL_CODES = ["storage.space_low", "storage.disk_full"] as const;

export function isBoxEmailCode(code: string): code is BoxEmailCode {
  return Object.hasOwn(BOX_EMAIL_WORDS, code);
}

/** The alerts the duty emails while they stay open, read from the incidents table; a
 * `clock.corrected` one is emailed even once handled, see `startBoxEmailDuty`'s `remember`. */
export const INCIDENT_EMAIL_CODES = ["backup.archives_deleted", "clock.corrected"] as const;

export type IncidentEmailCode = (typeof INCIDENT_EMAIL_CODES)[number];

export interface EmailedIncident {
  readonly id: string;
  readonly code: IncidentEmailCode;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Emailed once for each unbroken string of backup runs whose `runStopped` names
 * `backup.staging_space_low` that one of its checks sees. */
export const BACKUP_REFUSED_EMAIL_CODE = "backup.run_stopped";

export type BoxAlertCode = BoxEmailCode | IncidentEmailCode | typeof BACKUP_REFUSED_EMAIL_CODE;
type EmailCode = BoxAlertCode;
export const boxAlertMailKey = (episodeId: string, personId: string) =>
  `alert:${episodeId}:${personId}`;

/** Each time placeholder and the param holding the offset it is written in. */
const TIME_PLACEHOLDERS = {
  clockAt: "offsetMinutes",
  before: "beforeOffsetMinutes",
  after: "afterOffsetMinutes",
} as const;

/** A code's subject and text, with the slots only that code fills in `values`. */
function wordsFor(
  code: EmailCode,
  language: "en" | "es",
  params?: Readonly<Record<string, unknown>>,
): { subject: string; text: string; values?: Record<string, string> } {
  if (code === "backup.archives_deleted") {
    const words = BACKUP_DELETED_EMAIL_WORDS[language];
    const count = params?.["count"];
    const day = (name: string) => {
      const value = params?.[name];
      return typeof value === "string"
        ? receiptDay(value, language === "es" ? "es-ES" : "en-GB")
        : "";
    };
    const template =
      params?.["severalDays"] === true ? words.severalDays : count === 1 ? words.one : words.text;
    return {
      subject: words.subject,
      text: template,
      values: { count: String(count), date: day("date"), lastDate: day("lastDate") },
    };
  }
  if (code === BACKUP_REFUSED_EMAIL_CODE) {
    const words = BACKUP_REFUSED_EMAIL_WORDS[language];
    return {
      subject: words.subject,
      text: words.text,
      values: {
        needed: formatBytes(params?.["neededBytes"], language),
        available: formatBytes(params?.["availableBytes"], language),
      },
    };
  }
  if (code === "clock.corrected") {
    const words = CLOCK_CORRECTED_EMAIL_WORDS[language];
    const direction = params?.["direction"];
    const step = fillTemplate(
      direction === "forward" ? words.forward : direction === "back" ? words.back : words.moved,
      { duration: formatDuration(params?.["stepMs"], language === "es" ? "es-ES" : "en-GB") },
    );
    const name = params?.["person"];
    const person = typeof name === "string" ? name : "—";
    const source = params?.["source"];
    let subject: string = words.subject;
    let text: string = words.admin;
    const values: Record<string, string> = { step, person };
    if (params?.["unverified"] === true) {
      subject = words.unverifiedSubject;
      text = words.unverified;
    } else if (source === "staff") {
      const device = params?.["device"];
      values["till"] =
        typeof device === "string" ? fillTemplate(words.namedTill, { device }) : words.unnamedTill;
      text = words.staff;
    } else if (source === "setup") {
      values["person"] = typeof name === "string" ? fillTemplate(words.setupPerson, { name }) : "";
      text = words.setup;
    }
    return { subject, text, values };
  }
  return BOX_EMAIL_WORDS[code][language];
}

export function boxEmailMessage(
  code: EmailCode,
  language: "en" | "es",
  venue: string,
  params?: Readonly<Record<string, unknown>>,
): { subject: string; text: string } {
  const words = wordsFor(code, language, params);
  const values: Record<string, string> = { venue, ...words.values };
  for (const [name, offsetName] of Object.entries(TIME_PLACEHOLDERS)) {
    const at = params?.[name];
    const offset = params?.[offsetName];
    if (typeof at === "string" && typeof offset === "number")
      values[name] = receiptDateTimeNumeric(at, "en-GB", offset);
  }
  return { subject: fillTemplate(words.subject, values), text: fillTemplate(words.text, values) };
}

/** The open alerts of `INCIDENT_EMAIL_CODES`, oldest first, read in one write-lock turn with no
 * change-log drain. */
export async function readOpenEmailedIncidents(db: Database): Promise<EmailedIncident[]> {
  return db.withWriteLock(async () => {
    const rows = await db
      .select({ id: incidents.id, code: incidents.code, params: incidents.params })
      .from(incidents)
      .where(
        and(inArray(incidents.code, [...INCIDENT_EMAIL_CODES]), isNull(incidents.acknowledgedAt)),
      )
      .orderBy(asc(incidents.detectedAt), asc(incidents.id));
    return rows.map((row) => ({ ...row, code: row.code as IncidentEmailCode }));
  });
}

export const BOX_EMAIL_CHECK_MS = 60_000;

export interface BoxEmailContext {
  readonly venue: string;
  readonly recipients: readonly ManagerEmailRecipient[];
  readonly delivery: EmailDelivery;
}

/** Read in one write-lock turn with no change-log drain, so the reads answer on a full disk with a
 * change waiting. */
export async function readBoxEmailContext(
  db: Database,
  deps: {
    ring: KeyRing;
    practiceMode: boolean;
    captureOnly?: boolean;
    venueLanguage: "en" | "es";
  },
): Promise<BoxEmailContext> {
  return db.withWriteLock(async () => {
    return {
      venue: (await readVenue(db)).name,
      recipients: await readManagerEmailRecipients(db, deps.venueLanguage),
      delivery: await resolveEmailDeliveryIn(db, deps.ring, deps.practiceMode, deps.captureOnly),
    };
  });
}

interface Episode {
  readonly id: string;
  readonly incidentId?: string;
  readonly queuedFor: Set<string>;
  readonly code: EmailCode;
  /** The module that gave the notice; absent for the disk's episodes and the alerts'. */
  readonly owner?: string;
  /** Set for an open alert's episode, which lasts while the alert stays open. */
  readonly incident?: true;
  readonly untilSent?: true;
  /** The params of the notice that began the episode, kept for its whole length. */
  readonly params?: Readonly<Record<string, unknown>>;
  readonly sentTo: Set<string>;
  readonly said: Set<string>;
  readonly logged: Map<string, Set<TextEmailOutcome>>;
}

function recipientKey(recipient: ManagerEmailRecipient): string {
  return recipient.email.trim().toLowerCase();
}

/** Checks every `intervalMs`, the first one `intervalMs` after start, each next one armed after the
 * last finished. `stop` resolves once a database read in flight has finished; nothing is read or
 * queued after it. `remember` begins an alert's episode with no read, for an alert that may be
 * handled before the next check reads it: the box's own clock step, whose next step marks it
 * handled. A restart before the next check queues it loses its email; the alert stays in the bell. */
export function startBoxEmailDuty(deps: {
  db: Database;
  now: () => Date;
  disk: Pick<DiskFullState, "since">;
  space: Pick<FreeSpaceState, "current">;
  /** The enabled modules' notices, read in turns. */
  moduleNotices: () => Promise<StaffNoticesRead>;
  emailedIncidents: () => Promise<readonly EmailedIncident[]>;
  /** The backup run's memory of its last stop. */
  backupStopped: () => BackupOutcomeHolder["runStopped"];
  context: () => Promise<BoxEmailContext>;
  send: TextEmailSender;
  isPrimary: () => boolean;
  intervalMs: number;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => Promise<void>; remember: (incident: EmailedIncident) => void } {
  const timer = deps.timer ?? unrefTimer;
  let episodes = new Map<string, Episode>();
  let cleanedUp = false;
  /** The refusal episode's `runStopped.since`; a different one is a new refusal. */
  let refusedSince: string | undefined;
  let stopped = false;
  let reading: Promise<unknown> | null = null;

  /** Every read goes through here, so `stop` can wait for the one in flight. */
  async function read<T>(start: () => Promise<T>): Promise<T> {
    const pending = start();
    reading = pending;
    try {
      return await pending;
    } finally {
      reading = null;
    }
  }

  function begin(
    key: string,
    code: EmailCode,
    owner?: string,
    params?: Readonly<Record<string, unknown>>,
    incident?: true,
  ): Episode {
    let episode = episodes.get(key);
    if (episode === undefined) {
      episode = {
        id: incident
          ? key
          : code === BACKUP_REFUSED_EMAIL_CODE
            ? `${code}:${deps.backupStopped()!.since}`
            : newId(),
        ...(incident ? { incidentId: key.slice("incident:".length) } : {}),
        queuedFor: new Set(),
        code,
        ...(owner === undefined ? {} : { owner }),
        ...(incident === undefined ? {} : { incident }),
        ...(incident && code === "clock.corrected" ? { untilSent: true as const } : {}),
        ...(params === undefined ? {} : { params }),
        sentTo: new Set(),
        said: new Set(),
        logged: new Map(),
      };
      episodes.set(key, episode);
    }
    return episode;
  }

  function sayOnce(episode: Episode, event: string): void {
    if (episode.said.has(event)) return;
    episode.said.add(event);
    deps.log("warn", event, { code: episode.code });
  }

  async function deliver(episode: Episode, ctx: BoxEmailContext): Promise<void> {
    if (ctx.recipients.length === 0) {
      sayOnce(episode, "box_email.no_recipients");
      return;
    }
    const pending = ctx.recipients.filter((r) => {
      const key = recipientKey(r);
      return !episode.sentTo.has(key);
    });
    if (pending.length === 0) return;
    if (ctx.delivery.mode === "unconfigured") {
      sayOnce(episode, "box_email.not_configured");
      return;
    }
    for (const recipient of pending) {
      if (stopped) return;
      let outcome: TextEmailOutcome;
      try {
        outcome = await deps.send({
          smtp: ctx.delivery.smtp,
          recipient: recipient.email,
          ...boxEmailMessage(episode.code, recipient.language, ctx.venue, episode.params),
        });
      } catch {
        outcome = "unknown";
      }
      const key = recipientKey(recipient);
      if (outcome === "sent") {
        episode.sentTo.add(key);
        deps.log("info", "box_email.sent", { code: episode.code });
        continue;
      }
      const logged = episode.logged.get(key) ?? new Set<TextEmailOutcome>();
      episode.logged.set(key, logged);
      if (logged.has(outcome)) continue;
      logged.add(outcome);
      deps.log("warn", "box_email.send_failed", { code: episode.code, outcome });
    }
  }

  async function check(): Promise<void> {
    const beforeCheck = episodes;
    const beforeRefusal = refusedSince;
    try {
      if (stopped || !deps.isPrimary()) return;
      const full = deps.disk.since() !== null;
      const low = deps.space.current().lowSince !== null;
      if (full) {
        const episode = begin("storage.disk_full", "storage.disk_full");
        const ctx = await read(deps.context);
        if (!stopped) await deliver(episode, ctx);
        return;
      }
      const previous = episodes;
      episodes = new Map(episodes);
      const due: { episode: Episode; key?: string; toldAlready?: ReadonlySet<string> }[] = [];
      if (!low) {
        episodes.delete("storage.disk_full");
        episodes.delete("storage.space_low");
      } else {
        due.push({
          episode: begin("storage.space_low", "storage.space_low"),
          toldAlready: episodes.get("storage.disk_full")?.sentTo,
        });
      }
      const stoppedRun = deps.backupStopped();
      const refusal = stoppedRun?.code === "backup.staging_space_low" ? stoppedRun : undefined;
      if (refusal?.since !== refusedSince) episodes.delete(BACKUP_REFUSED_EMAIL_CODE);
      refusedSince = refusal?.since;
      if (refusal) {
        due.push({
          episode: begin(BACKUP_REFUSED_EMAIL_CODE, BACKUP_REFUSED_EMAIL_CODE, undefined, {
            ...refusal.sizes,
          }),
        });
      }
      const notices = await read(deps.moduleNotices);
      if (stopped) return;
      const moduleSeen = new Set<string>();
      for (const notice of notices.notices) {
        if (!isBoxEmailCode(notice.code)) continue;
        if ((STORAGE_EMAIL_CODES as readonly string[]).includes(notice.code)) continue;
        const key = `module:${notice.owner}:${notice.key}`;
        begin(key, notice.code, notice.owner, notice.params);
        moduleSeen.add(key);
      }
      const open = await read(deps.emailedIncidents);
      if (stopped) return;
      const incidentSeen = new Set<string>();
      for (const incident of open) {
        const key = `incident:${incident.id}`;
        begin(key, incident.code, undefined, incident.params, true);
        incidentSeen.add(key);
      }
      for (const [key, episode] of episodes) {
        if (episode.incident) {
          // A handled alert is never open again, so its episode ends for good.
          if (incidentSeen.has(key)) due.push({ episode });
          else if (episode.untilSent && episode.queuedFor.size === 0) due.push({ episode, key });
          else episodes.delete(key);
          continue;
        }
        if (episode.owner === undefined) continue;
        // While an owner's check fails, its episodes neither start nor end.
        if (moduleSeen.has(key) || notices.unavailable.includes(episode.owner)) {
          due.push({ episode });
        } else {
          episodes.delete(key);
        }
      }
      const ended = [...previous]
        .filter(
          ([key, episode]) =>
            episode.incidentId === undefined &&
            key !== "storage.disk_full" &&
            episodes.get(key) !== episode,
        )
        .map(([, episode]) => episode);
      const ctx = due.length === 0 ? undefined : await read(deps.context);
      if (stopped) {
        episodes = previous;
        return;
      }
      const queued: { episode: Episode; personId: string }[] = [];
      const additions: { episode: Episode; personId: string }[] = [];
      const suppressed: { episode: Episode; personId: string }[] = [];
      const dropped: string[] = [];
      for (const { episode, key, toldAlready } of due) {
        if (ctx!.recipients.length === 0) sayOnce(episode, "box_email.no_recipients");
        else if (ctx!.delivery.mode === "unconfigured")
          sayOnce(episode, "box_email.not_configured");
        else
          for (const recipient of ctx!.recipients) {
            if (
              toldAlready?.has(recipientKey(recipient)) &&
              episode.queuedFor.has(recipient.personId)
            )
              suppressed.push({ episode, personId: recipient.personId });
            if (
              !episode.queuedFor.has(recipient.personId) &&
              !toldAlready?.has(recipientKey(recipient))
            )
              additions.push({ episode, personId: recipient.personId });
          }
        if (key !== undefined) dropped.push(key);
      }
      if (
        !cleanedUp ||
        ended.some((episode) => episode.queuedFor.size !== 0) ||
        additions.length !== 0 ||
        suppressed.length !== 0
      ) {
        await read(() =>
          withTransaction(deps.db, async (tx) => {
            if (stopped || !deps.isPrimary()) return;
            const now = deps.now();
            if (!cleanedUp) {
              const leftovers = await tx
                .select({ key: outgoingMail.dedupeKey })
                .from(outgoingMail)
                .where(
                  and(
                    eq(outgoingMail.kind, "box_alert"),
                    isNull(outgoingMail.subjectId),
                    inArray(outgoingMail.status, ["pending", "rejected"]),
                    isNull(outgoingMail.finishedAt),
                  ),
                );
              for (const row of leftovers) await cancelMail(tx, row.key, now);
            }
            for (const episode of ended)
              for (const personId of episode.queuedFor)
                await cancelMail(tx, boxAlertMailKey(episode.id, personId), now);
            for (const { episode, personId } of suppressed)
              await cancelMail(tx, boxAlertMailKey(episode.id, personId), now);
            for (const pair of additions) {
              const { episode, personId } = pair;
              await enqueueMail(tx, {
                kind: "box_alert",
                dedupeKey: boxAlertMailKey(episode.id, personId),
                subjectId: episode.incidentId ?? null,
                personId,
                params: {
                  code: episode.code,
                  wording: episode.incidentId ? null : JSON.stringify(episode.params ?? null),
                },
                now,
                notAfter: new Date(now.getTime() + MAIL_LIFETIME_MS.box_alert),
              });
              queued.push(pair);
            }
          }),
        );
        if (stopped || !deps.isPrimary()) {
          episodes = previous;
          return;
        }
        cleanedUp = true;
      }
      for (const { episode, personId } of suppressed) episode.queuedFor.delete(personId);
      for (const { episode, personId } of queued) episode.queuedFor.add(personId);
      for (const key of dropped) episodes.delete(key);
    } catch (error) {
      episodes = beforeCheck;
      refusedSince = beforeRefusal;
      deps.log("warn", "box_email.check_failed", { errorCode: codeOf(error) });
    } finally {
      if (!stopped) armed = timer(deps.intervalMs, () => void check());
    }
  }

  let armed = timer(deps.intervalMs, () => void check());

  return {
    stop: async () => {
      stopped = true;
      armed.cancel();
      await reading?.catch(() => undefined);
    },
    remember: (incident) => {
      if (incident.code !== "clock.corrected") return;
      begin(`incident:${incident.id}`, incident.code, undefined, incident.params, true);
    },
  };
}
